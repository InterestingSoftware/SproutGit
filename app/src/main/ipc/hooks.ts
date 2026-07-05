/**
 * Hook CRUD + execution IPC handlers.
 *
 * Hooks are shell scripts that run at lifecycle points (worktree create/delete/switch).
 * They execute in a PTY terminal session visible in the renderer's terminal tab.
 *
 * Both local and repo hooks are stored the same way — a JSON file of
 * HookFileDefinitions (see ../hooks-file.ts) — just in different files with
 * different write/trust policies:
 *  - local: `<workspacePath>/.sproutgit/local-hooks.json`, app-writable, always trusted.
 *  - repo:  `<worktreePath>/sproutgit.hooks.json`, git-tracked, read-only from
 *    the app, each hook gated by per-hook trust (../hooks-trust.ts) since it
 *    arrives via `git checkout`.
 */
import { existsSync } from 'node:fs';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '@sproutgit/types';
import type {
  WorkspaceHookTrigger,
  WorkspaceHookShell,
  HookProgressEvent,
  WorktreeSwitchHookSource,
  WorkspaceHook,
  HookListResult,
  HookUpsertInput,
  HookFileDefinition,
} from '@sproutgit/types';
import { canonicalize } from '@sproutgit/paths';
import { openWorkspaceDb, eq, type ConfigDb } from '@sproutgit/database';
import { worktreeMetadata, hookDefinitions, hookDependencies } from '@sproutgit/database/schema/workspace';
import { listWorktrees } from '@sproutgit/git/worktrees';
import { join, basename, normalize } from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { manager, sessionWindows, registerHookExitHandler } from './terminal.js';
import {
  readHooksFile,
  writeLocalHooksFile,
  toWorkspaceHook,
  hashHookDefinition,
  localHooksFilePath,
  repoHooksFilePath,
  parseHookId,
} from '../hooks-file.js';
import { isHookTrusted, trustHook } from '../hooks-trust.js';
import { log } from '../telemetry.js';

/** Tracks hook IDs that have already fired once this session (for switchOncePerSession). */
const firedOnceHookIds = new Set<string>();

const execFileAsync = promisify(execFile);

/**
 * Resolves a shell enum value to its full executable path.
 * On Windows, Electron's process PATH may not include the PowerShell install
 * directory, so we use `where` to find the real path — same as detectShells().
 */
async function resolveShellToPath(shell: WorkspaceHookShell): Promise<string> {
  if (process.platform === 'win32') {
    const cmd = shell === 'pwsh' ? 'pwsh' : shell === 'powershell' ? 'powershell' : null;
    if (cmd) {
      try {
        const { stdout } = await execFileAsync('where', [cmd]);
        const paths = stdout.trim().split('\n').map(p => p.trim()).filter(Boolean);
        // Prefer real installations over WindowsApps stubs — those stubs can
        // launch a new visible terminal window instead of running in the PTY.
        const real = paths.find(p => !p.toLowerCase().includes('windowsapps')) ?? paths[0];
        if (real) return real;
      } catch { /* fall through to bare name */ }
    }
  }
  return shell;
}

function getWorkspaceDb(workspacePath: string) {
  const dbPath = join(workspacePath, '.sproutgit', 'state.db');
  return openWorkspaceDb(dbPath);
}

// ── Local hook storage ───────────────────────────────────────────────────

/**
 * One-time migration: older builds stored local hooks in the workspace DB
 * (`hookDefinitions`/`hookDependencies`). If `local-hooks.json` doesn't
 * exist yet, convert any legacy rows into it once so existing hooks aren't
 * lost when the app switches to file-based storage. A no-op once the file
 * exists (including an empty one written by a workspace that never had
 * legacy hooks), so this never re-queries the DB on every read.
 */
function migrateLegacyLocalHooksIfNeeded(workspacePath: string): void {
  if (existsSync(localHooksFilePath(workspacePath))) return;

  const db = getWorkspaceDb(workspacePath);
  let rows: (typeof hookDefinitions.$inferSelect)[];
  let deps: (typeof hookDependencies.$inferSelect)[];
  try {
    rows = db.select().from(hookDefinitions).all();
    deps = db.select().from(hookDependencies).all();
  } finally {
    db.close();
  }

  const nameById = new Map(rows.map(r => [r.id, r.name]));
  const dependsOnByHookId = new Map<string, string[]>();
  for (const dep of deps) {
    if (!dependsOnByHookId.has(dep.hookId)) dependsOnByHookId.set(dep.hookId, []);
    dependsOnByHookId.get(dep.hookId)!.push(dep.dependsOnId);
  }

  const converted: HookFileDefinition[] = rows.map(r => ({
    name: r.name,
    scope: r.scope,
    trigger: r.trigger,
    executionTarget: r.executionTarget,
    shell: r.shell,
    script: r.script,
    enabled: r.enabled,
    critical: r.critical,
    switchOncePerSession: r.switchOncePerSession,
    switchRunOnCreate: r.switchRunOnCreate,
    switchRunOnDelete: r.switchRunOnDelete,
    keepOpenOnCompletion: r.keepOpenOnCompletion,
    timeoutSeconds: r.timeoutSeconds,
    dependsOn: (dependsOnByHookId.get(r.id) ?? []).map(id => nameById.get(id)).filter((n): n is string => !!n),
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  }));

  // The old DB schema keyed hooks by UUID, so unlike the new file format it
  // never enforced unique names — disambiguate rather than silently
  // dropping/merging a hook (this is a rare, best-effort compatibility path).
  const seen = new Map<string, number>();
  for (const hook of converted) {
    const count = seen.get(hook.name) ?? 0;
    if (count > 0) {
      log.warn(`[hooks] migrating legacy hook with duplicate name "${hook.name}" — renaming to disambiguate`);
      hook.name = `${hook.name} (${count + 1})`;
    }
    seen.set(hook.name, count + 1);
  }

  writeLocalHooksFile(workspacePath, converted);
}

function readLocalHookDefs(workspacePath: string): HookFileDefinition[] {
  migrateLegacyLocalHooksIfNeeded(workspacePath);
  const { hooks, error } = readHooksFile(localHooksFilePath(workspacePath));
  if (error) log.warn(`[hooks] failed to parse ${localHooksFilePath(workspacePath)}: ${error}`);
  return hooks;
}

// ── Merged read path (local + repo) ──────────────────────────────────────

export function getEffectiveHooks(workspacePath: string, worktreePath: string | null, configDb: ConfigDb): HookListResult {
  const localHooks = readLocalHookDefs(workspacePath).map(d => toWorkspaceHook(d, 'local', true));

  if (!worktreePath) return { hooks: localHooks, repoFileError: null };

  const { hooks: repoDefs, error: repoFileError } = readHooksFile(repoHooksFilePath(worktreePath));
  const repoHooks = repoDefs.map(d => toWorkspaceHook(d, 'repo', isHookTrusted(configDb, worktreePath, hashHookDefinition(d))));

  return { hooks: [...localHooks, ...repoHooks], repoFileError };
}

/** Enabled, trusted hooks for `worktreePath` matching `trigger` — the set that's actually eligible to execute. */
function getEffectiveHooksForTrigger(workspacePath: string, worktreePath: string, configDb: ConfigDb, trigger: WorkspaceHookTrigger): WorkspaceHook[] {
  return getEffectiveHooks(workspacePath, worktreePath, configDb).hooks.filter(h => h.trigger === trigger && h.enabled && h.trusted);
}

// ── Execution ─────────────────────────────────────────────────────────────

interface RunHookArgs {
  workspacePath: string;
  hookId: string;
  worktreePath: string;
  trigger: WorkspaceHookTrigger;
  initiatingWorktreePath?: string | null;
}

async function runHook(args: RunHookArgs, win: BrowserWindow, configDb: ConfigDb): Promise<void> {
  const { hooks } = getEffectiveHooks(args.workspacePath, args.worktreePath, configDb);
  const hook = hooks.find(h => h.id === args.hookId);
  if (!hook || !hook.enabled || !hook.trusted) return;
  await runResolvedHook(hook, args, win);
}

async function runResolvedHook(hook: WorkspaceHook, args: RunHookArgs, win: BrowserWindow): Promise<void> {
  const db = getWorkspaceDb(args.workspacePath);

  // Look up worktree metadata for branch / source ref
  let wtMeta = db
    .select()
    .from(worktreeMetadata)
    .where(eq(worktreeMetadata.worktreePath, args.worktreePath))
    .get();

  if (!wtMeta) {
    // First time we've seen this worktree — likely one registered by an
    // external tool (e.g. Claude Code) rather than created through the app.
    // Lazily record its provenance so hook env vars aren't empty; branch
    // comes from git itself, sourceRef is unknown since we didn't create it.
    try {
      const rootRepoPath = join(args.workspacePath, '.sproutgit', 'root');
      const { worktrees } = await listWorktrees(rootRepoPath);
      // canonicalize() resolves symlinks (e.g. macOS's /var vs /private/var)
      // so a worktree under a symlinked temp dir still matches here.
      const targetCanonical = canonicalize(args.worktreePath);
      const registered = worktrees.find(w => canonicalize(w.path) === targetCanonical);
      if (registered) {
        const now = new Date();
        db.insert(worktreeMetadata)
          .values({
            worktreePath: args.worktreePath,
            branch: registered.branch ?? '',
            sourceRef: '',
            rootRepoPath,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .run();
        wtMeta = db
          .select()
          .from(worktreeMetadata)
          .where(eq(worktreeMetadata.worktreePath, args.worktreePath))
          .get();
      }
    } catch { /* best-effort — hooks still run with empty branch/sourceRef */ }
  }
  db.close();

  const osName = process.platform === 'darwin' ? 'macos'
    : process.platform === 'win32' ? 'windows'
    : 'linux';

  const env: Record<string, string> = {
    // Workspace
    SPROUTGIT_WORKSPACE: args.workspacePath,
    SPROUTGIT_WORKSPACE_NAME: basename(args.workspacePath),
    SPROUTGIT_ROOT_PATH: join(args.workspacePath, '.sproutgit', 'root'),
    SPROUTGIT_WORKTREES_PATH: join(args.workspacePath, '.sproutgit', 'worktrees'),
    // Worktree
    SPROUTGIT_WORKTREE: args.worktreePath,
    SPROUTGIT_WORKTREE_NAME: basename(args.worktreePath),
    SPROUTGIT_WORKTREE_BRANCH: wtMeta?.branch ?? '',
    SPROUTGIT_SOURCE_REF: wtMeta?.sourceRef ?? '',
    // Trigger
    SPROUTGIT_TRIGGER: args.trigger,
    SPROUTGIT_INITIATING_WORKTREE: args.initiatingWorktreePath ?? '',
    // Hook
    SPROUTGIT_HOOK_ID: hook.id,
    SPROUTGIT_HOOK_NAME: hook.name,
    SPROUTGIT_HOOK_SCOPE: hook.scope,
    SPROUTGIT_HOOK_SHELL: hook.shell,
    SPROUTGIT_HOOK_CRITICAL: String(hook.critical),
    SPROUTGIT_HOOK_TIMEOUT_SECONDS: String(hook.timeoutSeconds),
    // System
    SPROUTGIT_OS: osName,
  };

  const startEvent: HookProgressEvent = {
    trigger: args.trigger,
    hookId: hook.id,
    hookName: hook.name,
    keepOpenOnCompletion: hook.keepOpenOnCompletion ?? false,
    phase: 'start',
    status: 'running',
    stdoutSnippet: null,
    stderrSnippet: null,
    errorMessage: null,
  };
  win.webContents.send(IPC.EVENT_HOOK_PROGRESS, startEvent);

  const cwd = normalize(args.worktreePath);
  const hookShell = hook.shell as WorkspaceHookShell;
  // Resolve the shell enum to a full binary path so node-pty can find it
  // even when Electron's PATH doesn't include the shell's install directory.
  const shellBin = await resolveShellToPath(hookShell);

  return new Promise<void>(resolve => {
    let id: string;
    try {
      id = manager.spawn({
        cwd,
        shell: shellBin,
        env,
        label: hook.name,
      });
    } catch (spawnErr) {
      const errorMessage = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
      const endEvent: HookProgressEvent = {
        trigger: args.trigger,
        hookId: hook.id,
        hookName: hook.name,
        keepOpenOnCompletion: hook.keepOpenOnCompletion ?? false,
        phase: 'end',
        status: 'error',
        stdoutSnippet: null,
        stderrSnippet: null,
        errorMessage: `Failed to launch shell (${String(hookShell)}): ${errorMessage}`,
      };
      win.webContents.send(IPC.EVENT_HOOK_PROGRESS, endEvent);
      resolve();
      return;
    }

    sessionWindows.set(id, win);

    win.webContents.send(IPC.EVENT_HOOK_TERMINAL_LAUNCH, {
      terminalId: id,
      hookId: hook.id,
      hookName: hook.name,
      cwd,
      keepOpenOnCompletion: hook.keepOpenOnCompletion ?? false,
    });

    // Feed the hook script directly into the PTY's stdin line by line.
    // This runs commands in the visible terminal as if the user typed them,
    // avoids any temp-file execution-policy issues, and keeps everything
    // inside the in-app terminal pane.
    const scriptLines = hook.script.split('\n').map(l => l.trimEnd());
    for (const line of scriptLines) {
      manager.write(id, line + '\r');
    }
    // Close the shell after the last command so the PTY exits and we receive
    // the final exit code via onExit — unless keepOpen is requested.
    if (!hook.keepOpenOnCompletion) {
      const exitCmd = hookShell === 'pwsh' || hookShell === 'powershell'
        ? 'exit $LASTEXITCODE'
        : 'exit $?';
      manager.write(id, exitCmd + '\r');
    }

    let timedOut = false;
    // Don't apply a timeout when keepOpenOnCompletion is set — the hook
    // intentionally keeps the terminal open for manual inspection.
    const timeoutHandle = (hook.timeoutSeconds && !hook.keepOpenOnCompletion)
      ? setTimeout(() => {
          timedOut = true;
          manager.close(id);
        }, hook.timeoutSeconds * 1000)
      : null;

    registerHookExitHandler(id, exitCode => {
      if (timeoutHandle) clearTimeout(timeoutHandle);

      const success = !timedOut && exitCode === 0;
      const endEvent: HookProgressEvent = {
        trigger: args.trigger,
        hookId: hook.id,
        hookName: hook.name,
        keepOpenOnCompletion: hook.keepOpenOnCompletion ?? false,
        phase: 'end',
        status: timedOut ? 'timed_out' : success ? 'success' : 'error',
        stdoutSnippet: null,
        stderrSnippet: null,
        errorMessage: timedOut ? 'Hook timed out' : exitCode !== 0 ? `Exited with code ${String(exitCode)}` : null,
      };
      win.webContents.send(IPC.EVENT_HOOK_PROGRESS, endEvent);
      resolve();
    });
  });
}

export interface RunTriggerHooksArgs {
  workspacePath: string;
  trigger: WorkspaceHookTrigger;
  worktreePath: string;
  initiatingWorktreePath?: string | null;
  source?: WorktreeSwitchHookSource;
}

/**
 * Runs every enabled, trusted hook registered for `args.trigger`, in the
 * worktree context `args.worktreePath` describes. Exported standalone
 * (rather than only reachable via the HOOK_RUN_TRIGGER IPC handler below)
 * so other main-process code — specifically worktree-lifecycle.ts, which
 * both the renderer's worktree:create/worktree:delete IPC calls and the MCP
 * create_worktree/remove_worktree tools go through — can trigger the exact
 * same hook run without a client-side IPC round-trip.
 */
export async function runTriggerHooks(args: RunTriggerHooksArgs, win: BrowserWindow, configDb: ConfigDb): Promise<void> {
  const hooks = getEffectiveHooksForTrigger(args.workspacePath, args.worktreePath, configDb, args.trigger);

  const isSwitchTrigger =
    args.trigger === 'after_worktree_switch' ||
    args.trigger === 'before_worktree_switch';

  for (const hook of hooks) {
    // Apply switch-specific source flags — only when a source is known.
    // Use === false (not !) to treat NULL as "allow" for backward compatibility.
    if (isSwitchTrigger && args.source !== undefined) {
      if (args.source === 'create' && hook.switchRunOnCreate === false) continue;
      if (args.source === 'delete' && hook.switchRunOnDelete === false) continue;
    }

    // switchOncePerSession applies to ALL switch hooks regardless of source.
    // Mark as fired BEFORE awaiting runHook — keepOpen hooks never resolve
    // their PTY exit promise, so adding after the await would never execute.
    if (isSwitchTrigger && hook.switchOncePerSession) {
      const onceKey = `${hook.id}:${args.worktreePath}`;
      if (firedOnceHookIds.has(onceKey)) continue;
      firedOnceHookIds.add(onceKey);
    }

    await runResolvedHook(hook, {
      workspacePath: args.workspacePath,
      hookId: hook.id,
      worktreePath: args.worktreePath,
      trigger: args.trigger,
      initiatingWorktreePath: args.initiatingWorktreePath ?? null,
    }, win);
  }

  // After running all hooks: if a worktree is being removed, clear its
  // "once per session" records so recreation at the same path fires fresh.
  if (args.trigger === 'before_worktree_remove') {
    for (const key of firedOnceHookIds) {
      if (key.endsWith(`:${args.worktreePath}`)) firedOnceHookIds.delete(key);
    }
  }
}

export function registerHookHandlers(configDb: ConfigDb): void {
  ipcMain.handle(IPC.HOOK_RUN, async (_e, args: RunHookArgs) => {
    const win = BrowserWindow.fromWebContents(_e.sender);
    if (!win) return;
    await runHook(args, win, configDb);
  });

  ipcMain.handle(IPC.HOOK_LIST, (_e, args: { workspacePath: string; worktreePath: string | null }): HookListResult => {
    return getEffectiveHooks(args.workspacePath, args.worktreePath, configDb);
  });

  ipcMain.handle(IPC.HOOK_CREATE, (_e, args: { workspacePath: string } & HookUpsertInput) => {
    const localDefs = readLocalHookDefs(args.workspacePath);
    if (localDefs.some(h => h.name === args.name)) {
      throw new Error(`A local hook named "${args.name}" already exists.`);
    }
    const now = Date.now();
    localDefs.push({
      name: args.name,
      scope: args.scope,
      trigger: args.trigger,
      executionTarget: args.executionTarget,
      shell: args.shell,
      script: args.script,
      enabled: args.enabled,
      critical: args.critical,
      switchOncePerSession: args.switchOncePerSession,
      switchRunOnCreate: args.switchRunOnCreate,
      switchRunOnDelete: args.switchRunOnDelete,
      keepOpenOnCompletion: args.keepOpenOnCompletion,
      timeoutSeconds: args.timeoutSeconds,
      dependsOn: args.dependsOn,
      createdAt: now,
      updatedAt: now,
    });
    writeLocalHooksFile(args.workspacePath, localDefs);
  });

  ipcMain.handle(IPC.HOOK_UPDATE, (_e, args: { workspacePath: string; id: string } & Partial<HookUpsertInput>) => {
    const parsed = parseHookId(args.id);
    if (!parsed || parsed.source !== 'local') return; // repo hooks: edit sproutgit.hooks.json + commit instead
    const localDefs = readLocalHookDefs(args.workspacePath);
    const index = localDefs.findIndex(h => h.name === parsed.name);
    if (index === -1) return;

    const current = localDefs[index]!;
    const newName = args.name ?? current.name;
    if (newName !== current.name && localDefs.some((h, i) => i !== index && h.name === newName)) {
      throw new Error(`A local hook named "${newName}" already exists.`);
    }

    localDefs[index] = {
      ...current,
      name: newName,
      scope: args.scope ?? current.scope,
      trigger: args.trigger ?? current.trigger,
      executionTarget: args.executionTarget ?? current.executionTarget,
      shell: args.shell ?? current.shell,
      script: args.script ?? current.script,
      enabled: args.enabled ?? current.enabled,
      critical: args.critical ?? current.critical,
      switchOncePerSession: args.switchOncePerSession ?? current.switchOncePerSession,
      switchRunOnCreate: args.switchRunOnCreate ?? current.switchRunOnCreate,
      switchRunOnDelete: args.switchRunOnDelete ?? current.switchRunOnDelete,
      keepOpenOnCompletion: args.keepOpenOnCompletion ?? current.keepOpenOnCompletion,
      timeoutSeconds: args.timeoutSeconds ?? current.timeoutSeconds,
      dependsOn: args.dependsOn ?? current.dependsOn,
      updatedAt: Date.now(),
    };

    // Rename cascade — the app fully owns this file, so keep other local
    // hooks' dependsOn references consistent rather than letting them go stale.
    if (newName !== current.name) {
      for (const [i, h] of localDefs.entries()) {
        if (i === index) continue;
        if (h.dependsOn?.includes(current.name)) {
          h.dependsOn = h.dependsOn.map(d => d === current.name ? newName : d);
        }
      }
    }

    writeLocalHooksFile(args.workspacePath, localDefs);
  });

  ipcMain.handle(IPC.HOOK_DELETE, (_e, args: { workspacePath: string; id: string }) => {
    const parsed = parseHookId(args.id);
    if (!parsed || parsed.source !== 'local') return;
    const remaining = readLocalHookDefs(args.workspacePath).filter(h => h.name !== parsed.name);
    for (const h of remaining) {
      if (h.dependsOn?.includes(parsed.name)) {
        h.dependsOn = h.dependsOn.filter(d => d !== parsed.name);
      }
    }
    writeLocalHooksFile(args.workspacePath, remaining);
  });

  ipcMain.handle(IPC.HOOK_TOGGLE, (_e, args: {
    workspacePath: string;
    id: string;
    enabled: boolean;
  }) => {
    const parsed = parseHookId(args.id);
    // Repo hooks aren't stored in a file the app writes — their `enabled`
    // flag comes from sproutgit.hooks.json itself, so there's nothing to toggle here.
    if (!parsed || parsed.source !== 'local') return;
    const localDefs = readLocalHookDefs(args.workspacePath);
    const hook = localDefs.find(h => h.name === parsed.name);
    if (!hook) return;
    hook.enabled = args.enabled;
    hook.updatedAt = Date.now();
    writeLocalHooksFile(args.workspacePath, localDefs);
  });

  ipcMain.handle(IPC.HOOK_TRUST, (_e, args: { worktreePath: string; hookId: string }) => {
    const parsed = parseHookId(args.hookId);
    if (!parsed || parsed.source !== 'repo') return;
    const { hooks: repoDefs } = readHooksFile(repoHooksFilePath(args.worktreePath));
    const def = repoDefs.find(h => h.name === parsed.name);
    if (!def) return;
    trustHook(configDb, args.worktreePath, hashHookDefinition(def));
  });

  ipcMain.handle(IPC.HOOK_RUN_SWITCH, async (_e, args: {
    workspacePath: string;
    targetWorktreePath: string;
    initiatingWorktreePath?: string | null;
    source?: WorktreeSwitchHookSource;
  }) => {
    const win = BrowserWindow.fromWebContents(_e.sender);
    if (!win) return;

    const source = args.source ?? 'manual';
    const hooks = getEffectiveHooksForTrigger(args.workspacePath, args.targetWorktreePath, configDb, 'before_worktree_switch');

    for (const hook of hooks) {
      // Honour switchRunOnCreate / switchRunOnDelete flags.
      // Use === false (not !) to treat NULL as "allow" for backward compatibility
      // with hooks created before these columns existed.
      if (source === 'create' && hook.switchRunOnCreate === false) continue;
      if (source === 'delete' && hook.switchRunOnDelete === false) continue;
      // Honour switchOncePerSession: skip if already fired this session for this worktree.
      // Keyed by hookId:worktreePath so delete+recreate at the same path resets the flag.
      const onceKey = `${hook.id}:${args.targetWorktreePath}`;
      if (hook.switchOncePerSession && firedOnceHookIds.has(onceKey)) continue;
      // Mark as fired BEFORE awaiting runHook — keepOpen hooks never resolve their
      // PTY exit promise, so adding to the set after the await would never execute.
      if (hook.switchOncePerSession) firedOnceHookIds.add(onceKey);

      await runResolvedHook(hook, {
        workspacePath: args.workspacePath,
        hookId: hook.id,
        worktreePath: args.targetWorktreePath,
        trigger: 'before_worktree_switch',
        initiatingWorktreePath: args.initiatingWorktreePath ?? null,
      }, win);
    }
  });

  ipcMain.handle(IPC.HOOK_RUN_CREATE, async (_e, args: {
    workspacePath: string;
    newWorktreePath: string;
    initiatingWorktreePath?: string | null;
  }) => {
    const win = BrowserWindow.fromWebContents(_e.sender);
    if (!win) return;

    const hooks = getEffectiveHooksForTrigger(args.workspacePath, args.newWorktreePath, configDb, 'after_worktree_create');
    for (const hook of hooks) {
      await runResolvedHook(hook, {
        workspacePath: args.workspacePath,
        hookId: hook.id,
        worktreePath: args.newWorktreePath,
        trigger: 'after_worktree_create',
        initiatingWorktreePath: args.initiatingWorktreePath ?? null,
      }, win);
    }
  });

  ipcMain.handle(IPC.HOOK_RUN_TRIGGER, async (_e, args: RunTriggerHooksArgs) => {
    const win = BrowserWindow.fromWebContents(_e.sender);
    if (!win) return;
    await runTriggerHooks(args, win, configDb);
  });
}
