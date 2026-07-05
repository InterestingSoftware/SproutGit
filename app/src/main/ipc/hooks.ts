/**
 * Hook execution IPC handlers.
 *
 * Hooks are shell scripts that run at lifecycle points (worktree create/delete/switch).
 * They execute in a PTY terminal session visible in the renderer's terminal tab.
 */
import { ipcMain, type BrowserWindow } from 'electron';
import { IPC } from '@sproutgit/types';
import type { WorkspaceHookTrigger, WorkspaceHookShell, HookProgressEvent, WorktreeSwitchHookSource } from '@sproutgit/types';
import { canonicalize } from '@sproutgit/paths';
import { openWorkspaceDb, eq } from '@sproutgit/database';
import { hookDefinitions, worktreeMetadata } from '@sproutgit/database/schema/workspace';
import { listWorktrees } from '@sproutgit/git/worktrees';
import { join, basename, normalize } from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { manager, sessionWindows, registerHookExitHandler } from './terminal.js';
import { workspaceDbPath } from './workspace.js';

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
  return openWorkspaceDb(workspaceDbPath(workspacePath));
}

interface RunHookArgs {
  workspacePath: string;
  hookId: string;
  worktreePath: string;
  trigger: WorkspaceHookTrigger;
  initiatingWorktreePath?: string | null;
}

async function runHook(args: RunHookArgs, win: BrowserWindow): Promise<void> {
  const db = getWorkspaceDb(args.workspacePath);
  const hook = db
    .select()
    .from(hookDefinitions)
    .where(eq(hookDefinitions.id, args.hookId))
    .get();

  if (!hook || !hook.enabled) { db.close(); return; }

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
 * Runs every enabled hook registered for `args.trigger`, in the worktree
 * context `args.worktreePath` describes. Exported standalone (rather than
 * only reachable via the HOOK_RUN_TRIGGER IPC handler below) so other
 * main-process code — specifically worktree-lifecycle.ts, which both the
 * renderer's worktree:create/worktree:delete IPC calls and the MCP
 * create_worktree/remove_worktree tools go through — can trigger the exact
 * same hook run without a client-side IPC round-trip.
 */
export async function runTriggerHooks(args: RunTriggerHooksArgs, win: BrowserWindow): Promise<void> {
  const db = getWorkspaceDb(args.workspacePath);
  const hooks = db
    .select()
    .from(hookDefinitions)
    .where(eq(hookDefinitions.trigger, args.trigger))
    .all();
  db.close();

  const isSwitchTrigger =
    args.trigger === 'after_worktree_switch' ||
    args.trigger === 'before_worktree_switch';

  for (const hook of hooks) {
    if (!hook.enabled) continue;

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

    await runHook({
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

export function registerHookHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.HOOK_RUN, async (_e, args: RunHookArgs) => {
    const win = getWindow();
    if (!win) return;
    await runHook(args, win);
  });

  ipcMain.handle(IPC.HOOK_TOGGLE, (_e, args: {
    workspacePath: string;
    id: string;
    enabled: boolean;
  }) => {
    const db = getWorkspaceDb(args.workspacePath);
    try {
      db.update(hookDefinitions)
        .set({ enabled: args.enabled, updatedAt: new Date() })
        .where(eq(hookDefinitions.id, args.id))
        .run();
    } finally {
      db.close();
    }
  });

  ipcMain.handle(IPC.HOOK_RUN_SWITCH, async (_e, args: {
    workspacePath: string;
    targetWorktreePath: string;
    initiatingWorktreePath?: string | null;
    source?: WorktreeSwitchHookSource;
  }) => {
    const win = getWindow();
    if (!win) return;

    const source = args.source ?? 'manual';

    const db = getWorkspaceDb(args.workspacePath);
    const hooks = db
      .select()
      .from(hookDefinitions)
      .where(eq(hookDefinitions.trigger, 'before_worktree_switch'))
      .all();
    db.close(); // release before running hooks asynchronously

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

      await runHook({
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
    const win = getWindow();
    if (!win) return;

    const db = getWorkspaceDb(args.workspacePath);
    const hooks = db
      .select()
      .from(hookDefinitions)
      .where(eq(hookDefinitions.trigger, 'after_worktree_create'))
      .all();
    db.close(); // release before running hooks asynchronously

    for (const hook of hooks) {
      if (!hook.enabled) continue;
      await runHook({
        workspacePath: args.workspacePath,
        hookId: hook.id,
        worktreePath: args.newWorktreePath,
        trigger: 'after_worktree_create',
        initiatingWorktreePath: args.initiatingWorktreePath ?? null,
      }, win);
    }
  });

  ipcMain.handle(IPC.HOOK_RUN_TRIGGER, async (_e, args: RunTriggerHooksArgs) => {
    const win = getWindow();
    if (!win) return;
    await runTriggerHooks(args, win);
  });
}
