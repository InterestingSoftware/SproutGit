import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { listWorktrees, getWorktreeStatus, getWorkingDiff } from '@sproutgit/git';
import type { HookUpsertInput } from '@sproutgit/types';
import type { McpServerContext } from './context.js';

const HOOK_TRIGGERS = [
  'before_worktree_create',
  'after_worktree_create',
  'before_worktree_remove',
  'after_worktree_remove',
  'before_worktree_switch',
  'after_worktree_switch',
  'manual',
] as const;
const HOOK_EXECUTION_TARGETS = ['workspace', 'trigger_worktree', 'initiating_worktree'] as const;
const HOOK_SHELLS = ['bash', 'zsh', 'pwsh', 'powershell'] as const;
const HOOK_SCOPES = ['worktree', 'workspace'] as const;

/** Shared shape for create/update_local_hook — matches HookUpsertInput field-for-field (see hooks-file.ts's validateHook, the source of truth this mirrors). */
const hookFieldSchemas = {
  name: z.string().min(1).describe('Unique name for this local hook.'),
  scope: z.enum(HOOK_SCOPES).describe('Whether the hook is scoped to a single worktree or the whole workspace.'),
  trigger: z.enum(HOOK_TRIGGERS).describe('Lifecycle event that runs this hook.'),
  executionTarget: z.enum(HOOK_EXECUTION_TARGETS).describe('Which worktree the hook executes in.'),
  shell: z.enum(HOOK_SHELLS).describe('Shell used to run the script.'),
  script: z.string().min(1).describe('Shell script to execute.'),
  enabled: z.boolean().describe('Whether the hook is eligible to run.'),
  critical: z.boolean().describe('Whether a failure should be treated as blocking.'),
  switchOncePerSession: z.boolean().describe('For switch triggers: only fire once per app session per worktree.'),
  switchRunOnCreate: z.boolean().describe('For switch triggers: also fire when the worktree was just created.'),
  switchRunOnDelete: z.boolean().describe('For switch triggers: also fire when switching away during worktree deletion.'),
  keepOpenOnCompletion: z.boolean().describe('Keep the terminal tab open after the script finishes.'),
  timeoutSeconds: z.number().int().positive().describe('Kill the hook if it runs longer than this.'),
  dependsOn: z.array(z.string()).describe('Names of other local hooks this one depends on (informational; must reference existing local hooks).'),
};

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Message returned by the mutating tools while the permission gate is closed. */
export const MUTATING_TOOLS_DISABLED_MESSAGE =
  'Mutating MCP tools are disabled for this workspace. This is a temporary default — ' +
  'there is no Settings UI yet to enable them. See SproutGit docs/agent-instructions.md for status.';

// ── Handler implementations ─────────────────────────────────────────────────
// Exported standalone so they can be unit tested directly, without going
// through the MCP SDK's registration/RPC machinery. `registerTools()` below
// is the only thing that wires them up to a real McpServer.

export async function listWorktreesHandler(context: McpServerContext): Promise<CallToolResult> {
  const result = await listWorktrees(context.gitRepoPath, context.managedWorktreesPath);
  return textResult(result.worktrees);
}

export async function getWorkspaceInfoHandler(context: McpServerContext): Promise<CallToolResult> {
  const result = await listWorktrees(context.gitRepoPath, context.managedWorktreesPath);
  return textResult({
    workspacePath: context.workspacePath,
    gitRepoPath: context.gitRepoPath,
    managedWorktreesPath: context.managedWorktreesPath,
    worktreeCount: result.worktrees.length,
  });
}

/**
 * Only ever operate against a path this workspace itself reported via
 * list_worktrees — never an arbitrary path handed in by the calling agent,
 * mirroring the IPC rule that file paths must be validated as within the
 * workspace before touching the filesystem. Returns an error result if
 * `worktreePath` isn't one of them, otherwise `undefined`.
 */
async function assertKnownWorktree(context: McpServerContext, worktreePath: string): Promise<CallToolResult | undefined> {
  const { worktrees } = await listWorktrees(context.gitRepoPath, context.managedWorktreesPath);
  if (!worktrees.some(w => w.path === worktreePath)) {
    return errorResult(`"${worktreePath}" is not a known worktree of this workspace. Call list_worktrees first.`);
  }
  return undefined;
}

export async function getWorktreeStatusHandler(
  context: McpServerContext,
  args: { worktreePath: string },
): Promise<CallToolResult> {
  const knownError = await assertKnownWorktree(context, args.worktreePath);
  if (knownError) return knownError;
  const status = await getWorktreeStatus(args.worktreePath);
  return textResult(status);
}

export async function getWorktreeDiffHandler(
  context: McpServerContext,
  args: { worktreePath: string; filePath?: string | undefined },
): Promise<CallToolResult> {
  const knownError = await assertKnownWorktree(context, args.worktreePath);
  if (knownError) return knownError;
  const diff = await getWorkingDiff(args.worktreePath, args.filePath ?? null);
  return textResult(diff);
}

export async function reportSessionDoneHandler(
  context: McpServerContext,
  args: { worktreePath: string; summary?: string | undefined },
): Promise<CallToolResult> {
  const knownError = await assertKnownWorktree(context, args.worktreePath);
  if (knownError) return knownError;
  await context.reportSessionDone({ worktreePath: args.worktreePath, summary: args.summary ?? null });
  return textResult({ acknowledged: true, worktreePath: args.worktreePath });
}

export async function createWorktreeHandler(
  context: McpServerContext,
  args: { newBranch: string; fromRef: string },
): Promise<CallToolResult> {
  if (!context.mutatingToolsEnabled()) return errorResult(MUTATING_TOOLS_DISABLED_MESSAGE);
  try {
    const result = await context.createWorktree({ fromRef: args.fromRef, newBranch: args.newBranch });
    return textResult(result);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

export async function removeWorktreeHandler(
  context: McpServerContext,
  args: { worktreePath: string; deleteBranch: boolean; branchName?: string | undefined },
): Promise<CallToolResult> {
  if (!context.mutatingToolsEnabled()) return errorResult(MUTATING_TOOLS_DISABLED_MESSAGE);
  if (args.deleteBranch && !args.branchName) {
    return errorResult('branchName is required when deleteBranch is true.');
  }
  try {
    // context.removeWorktree validates worktreePath against the repo's
    // actual registered worktrees (canonicalized) and throws if it isn't
    // one — see app/src/main/worktree-lifecycle.ts.
    await context.removeWorktree({ worktreePath: args.worktreePath, deleteBranch: args.deleteBranch, branchName: args.branchName ?? null });
    return textResult({ removed: args.worktreePath, deleteBranch: args.deleteBranch, branchName: args.branchName ?? null });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

// ── Hooks ────────────────────────────────────────────────────────────────
// Read tools (list_hooks, list_hook_runs) always run. Write/run tools
// (create/update/delete/toggle_local_hook, run_hook) check
// mutatingToolsEnabled() first, same gate as create_worktree/remove_worktree
// — hook writes configure future arbitrary command execution and running a
// hook executes a command right now, so both get the same treatment as the
// worktree mutating tools.
//
// HARD SECURITY BOUNDARY: there is no trust tool anywhere in this file, and
// none of the handlers below can grant or bypass hook trust
// (app/src/main/hooks-trust.ts). Repo hooks (sproutgit.hooks.json) are
// read-only here — create/update/delete/toggle all operate on local hooks
// only (context.*LocalHook, backed by app/src/main/hooks-file.ts's
// local-hooks.json). run_hook refuses to run an untrusted repo hook,
// exactly like the Run Hook dialog.

export async function listHooksHandler(
  context: McpServerContext,
  args: { worktreePath?: string | undefined },
): Promise<CallToolResult> {
  return textResult(context.listHooks(args.worktreePath ?? null));
}

export async function listHookRunsHandler(
  context: McpServerContext,
  args: { worktreePath: string; limit?: number | undefined },
): Promise<CallToolResult> {
  return textResult(context.listHookRuns(args.worktreePath, args.limit));
}

export async function createLocalHookHandler(
  context: McpServerContext,
  args: HookUpsertInput,
): Promise<CallToolResult> {
  if (!context.mutatingToolsEnabled()) return errorResult(MUTATING_TOOLS_DISABLED_MESSAGE);
  try {
    context.createLocalHook(args);
    return textResult({ created: args.name });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

export async function updateLocalHookHandler(
  context: McpServerContext,
  args: { id: string } & Partial<HookUpsertInput>,
): Promise<CallToolResult> {
  if (!context.mutatingToolsEnabled()) return errorResult(MUTATING_TOOLS_DISABLED_MESSAGE);
  const { id, ...rest } = args;
  try {
    context.updateLocalHook(id, rest);
    return textResult({ updated: id });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

export async function deleteLocalHookHandler(
  context: McpServerContext,
  args: { id: string },
): Promise<CallToolResult> {
  if (!context.mutatingToolsEnabled()) return errorResult(MUTATING_TOOLS_DISABLED_MESSAGE);
  context.deleteLocalHook(args.id);
  return textResult({ deleted: args.id });
}

export async function toggleLocalHookHandler(
  context: McpServerContext,
  args: { id: string; enabled: boolean },
): Promise<CallToolResult> {
  if (!context.mutatingToolsEnabled()) return errorResult(MUTATING_TOOLS_DISABLED_MESSAGE);
  context.toggleLocalHook(args.id, args.enabled);
  return textResult({ id: args.id, enabled: args.enabled });
}

export async function runHookHandler(
  context: McpServerContext,
  args: { hookId: string; worktreePath: string; initiatingWorktreePath?: string | undefined },
): Promise<CallToolResult> {
  if (!context.mutatingToolsEnabled()) return errorResult(MUTATING_TOOLS_DISABLED_MESSAGE);
  // `not_run` (disabled/untrusted/unknown hookId) is a normal, structured
  // outcome an agent branches on via `status` — not an RPC-level failure —
  // so it's returned the same way as `success`/`timed_out`/`error`, all of
  // which are equally legitimate results of "the tool call itself worked."
  const result = await context.runHook({
    hookId: args.hookId,
    worktreePath: args.worktreePath,
    initiatingWorktreePath: args.initiatingWorktreePath ?? null,
  });
  return textResult(result);
}

/**
 * Registers the full MCP tool set against `server`, scoped to a single
 * workspace via `context`. Read-only tools (`list_worktrees`,
 * `get_worktree_status`, `get_worktree_diff`, `get_workspace_info`) and the
 * purely informational `report_session_done` always run; the mutating
 * tools (`create_worktree`, `remove_worktree`) check
 * `context.mutatingToolsEnabled()` first and refuse otherwise.
 */
export function registerTools(server: McpServer, context: McpServerContext): void {
  server.registerTool(
    'list_worktrees',
    {
      title: 'List worktrees',
      description: 'Lists every git worktree in this workspace, including branch, HEAD, and whether it is externally managed.',
    },
    () => listWorktreesHandler(context),
  );

  server.registerTool(
    'get_workspace_info',
    {
      title: 'Get workspace info',
      description: 'Returns the workspace root path, git repo path, managed worktrees path, and worktree count.',
    },
    () => getWorkspaceInfoHandler(context),
  );

  server.registerTool(
    'get_worktree_status',
    {
      title: 'Get worktree status',
      description: 'Returns the working-tree status (staged/unstaged/untracked files) for one worktree in this workspace.',
      inputSchema: {
        worktreePath: z.string().describe('Absolute path of the worktree, as returned by list_worktrees.'),
      },
    },
    args => getWorktreeStatusHandler(context, args),
  );

  server.registerTool(
    'get_worktree_diff',
    {
      title: 'Get worktree diff',
      description: 'Returns the unified diff of a worktree\'s current working tree (staged + unstaged changes) against HEAD, optionally scoped to one file.',
      inputSchema: {
        worktreePath: z.string().describe('Absolute path of the worktree, as returned by list_worktrees.'),
        filePath: z.string().optional().describe('Restrict the diff to this file, relative to the worktree root. Omit for the full diff.'),
      },
    },
    args => getWorktreeDiffHandler(context, args),
  );

  server.registerTool(
    'report_session_done',
    {
      title: 'Report session done',
      description: 'Tells SproutGit that the calling agent has finished a session of work in a worktree, so the app can surface it to the user (e.g. a toast).',
      inputSchema: {
        worktreePath: z.string().describe('Absolute path of the worktree the session ran in, as returned by list_worktrees.'),
        summary: z.string().optional().describe('Optional free-text summary of what the session did.'),
      },
    },
    args => reportSessionDoneHandler(context, args),
  );

  server.registerTool(
    'create_worktree',
    {
      title: 'Create worktree',
      description: 'Creates a new managed worktree branching from a ref. Disabled by default pending a permission-gate setting.',
      inputSchema: {
        newBranch: z.string().min(1).describe('Name of the new branch to create.'),
        fromRef: z.string().min(1).default('HEAD').describe('Ref to branch from, e.g. "main" or "HEAD".'),
      },
    },
    args => createWorktreeHandler(context, args),
  );

  server.registerTool(
    'remove_worktree',
    {
      title: 'Remove worktree',
      description: 'Removes a managed worktree, optionally deleting its branch. Disabled by default pending a permission-gate setting.',
      inputSchema: {
        worktreePath: z.string().describe('Absolute path of the worktree to remove, as returned by list_worktrees.'),
        deleteBranch: z.boolean().default(false).describe('Also delete the worktree\'s branch. Requires branchName.'),
        branchName: z.string().optional().describe('Branch name to delete; required when deleteBranch is true.'),
      },
    },
    args => removeWorktreeHandler(context, args),
  );

  server.registerTool(
    'list_hooks',
    {
      title: 'List hooks',
      description: 'Lists effective lifecycle hooks (local + repo merged) for a worktree, with source (local/repo), trigger, enabled, and trusted state. Pass no worktreePath to see only workspace-level local hooks. Read-only — never exposes a way to grant hook trust.',
      inputSchema: {
        worktreePath: z.string().optional().describe('Absolute path of the worktree, as returned by list_worktrees. Omit to see only local hooks with no worktree in view.'),
      },
    },
    args => listHooksHandler(context, args),
  );

  server.registerTool(
    'list_hook_runs',
    {
      title: 'List hook runs',
      description: 'Reads the hook-run audit log for a worktree, most recent first — use this to diagnose why a worktree is broken (e.g. a failed post-create hook).',
      inputSchema: {
        worktreePath: z.string().describe('Absolute path of the worktree, as returned by list_worktrees.'),
        limit: z.number().int().positive().max(500).optional().describe('Max rows to return (default 50).'),
      },
    },
    args => listHookRunsHandler(context, args),
  );

  server.registerTool(
    'create_local_hook',
    {
      title: 'Create local hook',
      description: 'Creates a new local hook in .sproutgit/local-hooks.json (this machine only — never a repo-tracked sproutgit.hooks.json). Disabled by default pending a permission-gate setting, same as create_worktree.',
      inputSchema: hookFieldSchemas,
    },
    args => createLocalHookHandler(context, args as HookUpsertInput),
  );

  server.registerTool(
    'update_local_hook',
    {
      title: 'Update local hook',
      description: 'Updates an existing local hook by id (format "local:<name>"). Only local hooks can be updated — repo hooks are read-only through MCP. Disabled by default pending a permission-gate setting.',
      inputSchema: {
        id: z.string().describe('Hook id, e.g. "local:my-hook" as returned by list_hooks.'),
        ...Object.fromEntries(Object.entries(hookFieldSchemas).map(([k, v]) => [k, v.optional()])),
      },
    },
    args => updateLocalHookHandler(context, args as { id: string } & Partial<HookUpsertInput>),
  );

  server.registerTool(
    'delete_local_hook',
    {
      title: 'Delete local hook',
      description: 'Deletes a local hook by id (format "local:<name>"). Only local hooks can be deleted — repo hooks are read-only through MCP. Disabled by default pending a permission-gate setting.',
      inputSchema: {
        id: z.string().describe('Hook id, e.g. "local:my-hook" as returned by list_hooks.'),
      },
    },
    args => deleteLocalHookHandler(context, args),
  );

  server.registerTool(
    'toggle_local_hook',
    {
      title: 'Toggle local hook',
      description: 'Enables or disables a local hook by id (format "local:<name>"). Only local hooks can be toggled — repo hooks are read-only through MCP. Disabled by default pending a permission-gate setting.',
      inputSchema: {
        id: z.string().describe('Hook id, e.g. "local:my-hook" as returned by list_hooks.'),
        enabled: z.boolean(),
      },
    },
    args => toggleLocalHookHandler(context, args),
  );

  server.registerTool(
    'run_hook',
    {
      title: 'Run hook',
      description: 'Triggers a hook run for a worktree through the same execution path as the Run Hook dialog, and returns the result. Refuses to run a disabled or untrusted hook — trust can only ever be granted from the app UI, never through MCP. Disabled by default pending a permission-gate setting.',
      inputSchema: {
        hookId: z.string().describe('Hook id, e.g. "local:my-hook" or "repo:my-hook", as returned by list_hooks.'),
        worktreePath: z.string().describe('Absolute path of the worktree to run the hook against.'),
        initiatingWorktreePath: z.string().optional().describe('Worktree the caller was "in" when starting this, if any — recorded as SPROUTGIT_INITIATING_WORKTREE.'),
      },
    },
    args => runHookHandler(context, args),
  );
}
