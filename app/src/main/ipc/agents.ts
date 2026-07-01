/**
 * Coding-agent IPC handlers.
 *
 * An "agent" is just a configured command (Claude Code, Kiro, Cursor, Codex,
 * Gemini, or anything custom) launched as a PTY session in a worktree, the
 * same way hooks are launched — it shows up as a normal terminal tab.
 */
import { ipcMain, type BrowserWindow } from 'electron';
import { IPC } from '@sproutgit/types';
import type { AgentRoster } from '@sproutgit/types';
import { openWorkspaceDb, eq, getAgentRoster, saveAgentRoster, type ConfigDb } from '@sproutgit/database';
import { worktreeMetadata } from '@sproutgit/database/schema/workspace';
import { join, basename } from 'path';
import { manager, sessionWindows } from './terminal.js';

function getWorkspaceDb(workspacePath: string) {
  const dbPath = join(workspacePath, '.sproutgit', 'state.db');
  return openWorkspaceDb(dbPath);
}

export function registerAgentHandlers(configDb: ConfigDb, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.AGENT_LIST, () => getAgentRoster(configDb));

  ipcMain.handle(IPC.AGENT_SAVE, (_e, roster: AgentRoster) => {
    saveAgentRoster(configDb, roster);
  });

  ipcMain.handle(IPC.AGENT_LAUNCH, (_e, args: {
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
    };

    // The agent binary is spawned directly (not through a shell), so its
    // failure-to-launch (e.g. command not installed) surfaces as a normal
    // PTY exit — no special-casing needed here.
    const id = manager.spawn({
      cwd: args.worktreePath,
      shell: agent.command,
      args: agent.args,
      env,
      label: agent.name,
      agentId: agent.id,
    });

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
