/**
 * Coding-agent IPC handlers.
 *
 * An "agent" is just a configured command (Claude Code, Kiro, Cursor, Codex,
 * Gemini, or anything custom) launched as a PTY session in a worktree, the
 * same way hooks are launched — it shows up as a normal terminal tab.
 */
import type { BrowserWindow } from 'electron';
import { IPC } from '@sproutgit/types';
import type { AgentRoster, IssueTrackerPattern } from '@sproutgit/types';
import { openWorkspaceDb, eq, getAgentRoster, saveAgentRoster, type ConfigDb } from '@sproutgit/database';
import { worktreeMetadata } from '@sproutgit/database/schema/workspace';
import { readIssueTrackerFile } from '@sproutgit/git';
import { join, basename } from 'path';
import { manager, sessionWindows } from './terminal.js';
import { handle } from './handle.js';

function getWorkspaceDb(workspacePath: string) {
  const dbPath = join(workspacePath, '.sproutgit', 'state.db');
  return openWorkspaceDb(dbPath);
}

/**
 * Resolves a stored issue ref back to a URL via the repo's `.issuetracker`
 * patterns. Purely local (reads a file, no network) — agent launch must
 * never block on or fail due to a live provider fetch.
 */
function resolveIssueUrl(issueRef: string, patterns: IssueTrackerPattern[]): string {
  for (const pattern of patterns) {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern.regex);
    } catch {
      continue;
    }
    const match = regex.exec(issueRef);
    if (!match) continue;
    return pattern.url.replace(/\$(\d+)/g, (_, groupIdx: string) => match[Number(groupIdx)] ?? '');
  }
  return '';
}

export function registerAgentHandlers(configDb: ConfigDb, getWindow: () => BrowserWindow | null): void {
  handle(IPC.AGENT_LIST, () => getAgentRoster(configDb));

  handle(IPC.AGENT_SAVE, (_e, roster: AgentRoster) => {
    saveAgentRoster(configDb, roster);
  });

  handle(IPC.AGENT_LAUNCH, async (_e, args: {
    workspacePath: string;
    worktreePath: string;
    agentId?: string;
  }) => {
    const win = getWindow();
    if (!win) throw new Error('No active window to launch the agent in.');

    const roster = getAgentRoster(configDb);
    const agentId = args.agentId ?? roster.defaultAgentId;
    const agent = roster.agents.find(a => a.id === agentId);
    if (!agent) throw new Error(`No configured agent found for id "${String(agentId)}".`);
    if (!agent.command.trim()) {
      throw new Error(`Agent "${agent.name}" has no command configured. Set one in Settings → Coding Agents.`);
    }

    const db = getWorkspaceDb(args.workspacePath);
    const wtMeta = db
      .select()
      .from(worktreeMetadata)
      .where(eq(worktreeMetadata.worktreePath, args.worktreePath))
      .get();
    db.close();

    const osName = process.platform === 'darwin' ? 'macos'
      : process.platform === 'win32' ? 'windows'
      : 'linux';

    const issuePatterns = await readIssueTrackerFile(args.worktreePath);
    const issueRef = wtMeta?.issueRef ?? '';

    const env: Record<string, string> = {
      SPROUTGIT_WORKSPACE: args.workspacePath,
      SPROUTGIT_WORKSPACE_NAME: basename(args.workspacePath),
      SPROUTGIT_ROOT_PATH: join(args.workspacePath, '.sproutgit', 'root'),
      SPROUTGIT_WORKTREES_PATH: join(args.workspacePath, '.sproutgit', 'worktrees'),
      SPROUTGIT_WORKTREE: args.worktreePath,
      SPROUTGIT_WORKTREE_NAME: basename(args.worktreePath),
      SPROUTGIT_WORKTREE_BRANCH: wtMeta?.branch ?? '',
      SPROUTGIT_SOURCE_REF: wtMeta?.sourceRef ?? '',
      SPROUTGIT_OS: osName,
      SPROUTGIT_AGENT: agent.id,
      SPROUTGIT_ISSUE_REF: issueRef,
      SPROUTGIT_ISSUE_URL: issueRef ? resolveIssueUrl(issueRef, issuePatterns) : '',
      SPROUTGIT_ISSUE_TITLE: wtMeta?.issueTitle ?? '',
    };

    // The agent binary is spawned directly (not through a shell). On POSIX,
    // a missing/bad command still surfaces as a normal async PTY exit. On
    // Windows, ConPTY's CreateProcess can fail synchronously instead, so we
    // catch and log here rather than letting an unhandled rejection hide
    // the real cause. resolveShell: false stops TerminalManager from
    // substituting the platform default shell for an unresolvable command,
    // which would otherwise spawn (and mislabel) a plain shell as this agent.
    let id: string;
    try {
      id = manager.spawn({
        cwd: args.worktreePath,
        shell: agent.command,
        args: agent.args,
        resolveShell: false,
        env,
        label: agent.name,
        agentId: agent.id,
      });
    } catch (spawnErr) {
      const message = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
      throw new Error(`Failed to launch agent "${agent.name}" (command: ${JSON.stringify(agent.command)}, args: ${JSON.stringify(agent.args)}): ${message}`, { cause: spawnErr });
    }

    sessionWindows.set(id, win);

    win.webContents.send(IPC.EVENT_AGENT_TERMINAL_LAUNCH, {
      terminalId: id,
      agentId: agent.id,
      agentName: agent.name,
      cwd: args.worktreePath,
    });

    return id;
  });
}
