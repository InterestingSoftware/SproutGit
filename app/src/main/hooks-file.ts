/**
 * Reads, validates, and (for the local file only) writes the JSON hook
 * files that back both hook sources:
 *  - local:  `<workspacePath>/.sproutgit/local-hooks.json` — app-writable,
 *    not tracked by git, always trusted.
 *  - repo:   `<worktreePath>/sproutgit.hooks.json` — tracked by git,
 *    read-only from the app (edit + commit to change it), each hook gated
 *    by per-hook trust (see hooks-trust.ts) since it arrives via checkout.
 *
 * Both files share the exact same schema/parser — only the path, write
 * policy, and trust policy differ. That's the "native" differentiation:
 * which file a hook was read from, not a bolted-on flag.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  HookExecutionTarget,
  HookFileDefinition,
  HooksFile,
  HookSource,
  WorkspaceHook,
  WorkspaceHookScope,
  WorkspaceHookShell,
  WorkspaceHookTrigger,
} from '@sproutgit/types';

export const REPO_HOOKS_FILENAME = 'sproutgit.hooks.json';
export const LOCAL_HOOKS_RELATIVE_PATH = ['.sproutgit', 'local-hooks.json'];

export function repoHooksFilePath(worktreePath: string): string {
  return join(worktreePath, REPO_HOOKS_FILENAME);
}

export function localHooksFilePath(workspacePath: string): string {
  return join(workspacePath, ...LOCAL_HOOKS_RELATIVE_PATH);
}

/** Synthesizes the id used to reference a hook throughout the app (list, run, dependencies). */
export function makeHookId(source: HookSource, name: string): string {
  return `${source}:${name}`;
}

export function parseHookId(id: string): { source: HookSource; name: string } | null {
  if (id.startsWith('local:')) return { source: 'local', name: id.slice('local:'.length) };
  if (id.startsWith('repo:')) return { source: 'repo', name: id.slice('repo:'.length) };
  return null;
}

export function isRepoHookId(id: string): boolean {
  return id.startsWith('repo:');
}

const VALID_TRIGGERS: WorkspaceHookTrigger[] = [
  'before_worktree_create',
  'after_worktree_create',
  'before_worktree_remove',
  'after_worktree_remove',
  'before_worktree_switch',
  'after_worktree_switch',
  'manual',
];

const VALID_EXECUTION_TARGETS: HookExecutionTarget[] = ['workspace', 'trigger_worktree', 'initiating_worktree'];

const VALID_SHELLS: WorkspaceHookShell[] = ['bash', 'zsh', 'pwsh', 'powershell'];

const VALID_SCOPES: WorkspaceHookScope[] = ['worktree', 'workspace'];

function validateHook(raw: unknown, index: number): HookFileDefinition {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`hooks[${index}] must be an object`);
  }
  const h = raw as Record<string, unknown>;
  if (typeof h.name !== 'string' || h.name.trim() === '') {
    throw new Error(`hooks[${index}].name must be a non-empty string`);
  }
  if (h.scope !== undefined && !VALID_SCOPES.includes(h.scope as WorkspaceHookScope)) {
    throw new Error(`hooks[${index}] ("${h.name}").scope must be one of ${VALID_SCOPES.join(', ')}`);
  }
  if (typeof h.trigger !== 'string' || !VALID_TRIGGERS.includes(h.trigger as WorkspaceHookTrigger)) {
    throw new Error(`hooks[${index}] ("${h.name}").trigger must be one of ${VALID_TRIGGERS.join(', ')}`);
  }
  if (typeof h.executionTarget !== 'string' || !VALID_EXECUTION_TARGETS.includes(h.executionTarget as HookExecutionTarget)) {
    throw new Error(`hooks[${index}] ("${h.name}").executionTarget must be one of ${VALID_EXECUTION_TARGETS.join(', ')}`);
  }
  if (typeof h.shell !== 'string' || !VALID_SHELLS.includes(h.shell as WorkspaceHookShell)) {
    throw new Error(`hooks[${index}] ("${h.name}").shell must be one of ${VALID_SHELLS.join(', ')}`);
  }
  if (typeof h.script !== 'string' || h.script.trim() === '') {
    throw new Error(`hooks[${index}] ("${h.name}").script must be a non-empty string`);
  }
  if (h.dependsOn !== undefined && (!Array.isArray(h.dependsOn) || !h.dependsOn.every(d => typeof d === 'string'))) {
    throw new Error(`hooks[${index}] ("${h.name}").dependsOn must be an array of strings`);
  }

  return {
    name: h.name,
    scope: (h.scope as WorkspaceHookScope | undefined) ?? 'worktree',
    trigger: h.trigger as WorkspaceHookTrigger,
    executionTarget: h.executionTarget as HookExecutionTarget,
    shell: h.shell as WorkspaceHookShell,
    script: h.script,
    enabled: typeof h.enabled === 'boolean' ? h.enabled : true,
    critical: typeof h.critical === 'boolean' ? h.critical : false,
    switchOncePerSession: typeof h.switchOncePerSession === 'boolean' ? h.switchOncePerSession : false,
    switchRunOnCreate: typeof h.switchRunOnCreate === 'boolean' ? h.switchRunOnCreate : true,
    switchRunOnDelete: typeof h.switchRunOnDelete === 'boolean' ? h.switchRunOnDelete : false,
    keepOpenOnCompletion: typeof h.keepOpenOnCompletion === 'boolean' ? h.keepOpenOnCompletion : false,
    timeoutSeconds: typeof h.timeoutSeconds === 'number' ? h.timeoutSeconds : 300,
    dependsOn: (h.dependsOn as string[] | undefined) ?? [],
    // Only include these keys when a real number is present — under
    // exactOptionalPropertyTypes, assigning `undefined` to an optional
    // field is a type error even though omitting the key is fine.
    ...(typeof h.createdAt === 'number' ? { createdAt: h.createdAt } : {}),
    ...(typeof h.updatedAt === 'number' ? { updatedAt: h.updatedAt } : {}),
  };
}

function parseHooksFile(raw: string): HookFileDefinition[] {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as HooksFile).hooks)) {
    throw new Error('expected an object with a "hooks" array');
  }
  const file = parsed as HooksFile;
  if (file.version !== 1) {
    throw new Error(`unsupported version ${JSON.stringify(file.version)} — expected 1`);
  }
  const hooks = file.hooks.map((h, i) => validateHook(h, i));

  const names = new Set<string>();
  for (const hook of hooks) {
    if (names.has(hook.name)) throw new Error(`duplicate hook name "${hook.name}"`);
    names.add(hook.name);
  }
  for (const hook of hooks) {
    for (const dep of hook.dependsOn ?? []) {
      if (!names.has(dep)) throw new Error(`hook "${hook.name}" depends on unknown hook "${dep}"`);
    }
  }

  return hooks;
}

/** Converts a validated hook definition into the WorkspaceHook shape the rest of the app (UI, execution) understands. */
export function toWorkspaceHook(def: HookFileDefinition, source: HookSource, trusted: boolean): WorkspaceHook {
  return {
    id: makeHookId(source, def.name),
    name: def.name,
    scope: def.scope ?? 'worktree',
    trigger: def.trigger,
    executionTarget: def.executionTarget,
    executionMode: 'terminal_tab',
    shell: def.shell,
    script: def.script,
    enabled: def.enabled ?? true,
    critical: def.critical ?? false,
    switchOncePerSession: def.switchOncePerSession ?? false,
    switchRunOnCreate: def.switchRunOnCreate ?? true,
    switchRunOnDelete: def.switchRunOnDelete ?? false,
    keepOpenOnCompletion: def.keepOpenOnCompletion ?? false,
    timeoutSeconds: def.timeoutSeconds ?? 300,
    createdAt: def.createdAt ?? 0,
    updatedAt: def.updatedAt ?? 0,
    dependsOn: def.dependsOn ?? [],
    source,
    trusted,
  };
}

/** Computes a stable content hash for one hook definition — used to gate trust per-hook rather than per-file (see hooks-trust.ts). */
export function hashHookDefinition(def: HookFileDefinition): string {
  // Field order is fixed here (not derived from the source file's key
  // order) so the hash only changes when a value actually changes.
  const canonical = JSON.stringify([
    def.name,
    def.scope ?? 'worktree',
    def.trigger,
    def.executionTarget,
    def.shell,
    def.script,
    def.enabled ?? true,
    def.critical ?? false,
    def.switchOncePerSession ?? false,
    def.switchRunOnCreate ?? true,
    def.switchRunOnDelete ?? false,
    def.keepOpenOnCompletion ?? false,
    def.timeoutSeconds ?? 300,
    def.dependsOn ?? [],
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

export type ReadHooksFileResult = {
  hooks: HookFileDefinition[];
  error: string | null;
};

/**
 * Reads and validates a hooks file at `path`. Never throws — parse
 * failures surface as `error` with `hooks: []` so a malformed file disables
 * those hooks rather than crashing hook execution.
 */
export function readHooksFile(path: string): ReadHooksFileResult {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    // A missing file is the normal "no hooks defined" case. Anything else
    // (permissions, a directory in its place, transient I/O) is a real
    // problem — surface it as `error` instead of silently treating it as absent.
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return { hooks: [], error: null };
    }
    return { hooks: [], error: err instanceof Error ? err.message : String(err) };
  }

  try {
    return { hooks: parseHooksFile(raw), error: null };
  } catch (err) {
    return { hooks: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/** Writes the local hooks file atomically (write to a temp file, then rename) so a crash mid-write can't corrupt it. */
export function writeLocalHooksFile(workspacePath: string, hooks: HookFileDefinition[]): void {
  const path = localHooksFilePath(workspacePath);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const file: HooksFile = { version: 1, hooks };
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(file, null, 2) + '\n', 'utf8');
  renameSync(tmpPath, path);
}
