import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { listWorktrees, getWorktreeStatus } from '@sproutgit/git';
import type { McpServerContext } from './context.js';

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

export async function getWorktreeStatusHandler(
  context: McpServerContext,
  args: { worktreePath: string },
): Promise<CallToolResult> {
  // Only ever run git status against a path this workspace itself reported
  // via list_worktrees — never an arbitrary path handed in by the calling
  // agent, mirroring the IPC rule that file paths must be validated as
  // within the workspace before touching the filesystem.
  const { worktrees } = await listWorktrees(context.gitRepoPath, context.managedWorktreesPath);
  if (!worktrees.some(w => w.path === args.worktreePath)) {
    return errorResult(`"${args.worktreePath}" is not a known worktree of this workspace. Call list_worktrees first.`);
  }
  const status = await getWorktreeStatus(args.worktreePath);
  return textResult(status);
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

/**
 * Registers the full first-cut MCP tool set against `server`, scoped to a
 * single workspace via `context`. Read-only tools (`list_worktrees`,
 * `get_worktree_status`, `get_workspace_info`) always run; the mutating
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
}
