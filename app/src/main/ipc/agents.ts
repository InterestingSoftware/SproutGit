/**
 * Coding-agent IPC handlers.
 *
 * There is a single configured AI agent (command + args + invocation mode),
 * same shape as the editor/diff-tool/merge-tool settings rows — not a roster.
 * "Terminal" mode launches it as a PTY session in a worktree, the same way
 * hooks are launched. "Integrated" mode (Claude Code only, for now) is
 * handled separately by chat.ts, which spawns the agent with structured
 * streaming output and renders it in the Chat tab.
 */
import type { BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import { IPC } from '@sproutgit/types';
import type { AgentConfig, IssueTrackerPattern, ToolTestResult } from '@sproutgit/types';
import { openWorkspaceDb, eq, getAgentConfig, saveAgentConfig, type ConfigDb } from '@sproutgit/database';
import { worktreeMetadata } from '@sproutgit/database/schema/workspace';
import { readIssueTrackerFile } from '@sproutgit/git';
import { join, basename } from 'path';
import { manager, sessionWindows } from './terminal.js';
import { handle } from './handle.js';
import { resolveCommandPath, splitCommand, truncate, okResult, errResult } from './tool-test-helpers.js';

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

/**
 * Recognizes commands that support structured streaming output ("Integrated"
 * mode). For now this is specifically Claude Code's CLI — verified via
 * `claude --help`: `-p`/`--print` plus `--output-format stream-json`
 * (with `--verbose`) emits line-delimited JSON on stdout. Any other command
 * (Kiro, Codex, Gemini, custom) only gets Terminal mode.
 */
export function commandSupportsIntegratedMode(command: string): boolean {
  const token = splitCommand(command).bin.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  return token === 'claude' || token === 'claude-code';
}

async function buildAgentEnv(args: { workspacePath: string; worktreePath: string }): Promise<Record<string, string>> {
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

  return {
    SPROUTGIT_WORKSPACE: args.workspacePath,
    SPROUTGIT_WORKSPACE_NAME: basename(args.workspacePath),
    SPROUTGIT_ROOT_PATH: join(args.workspacePath, '.sproutgit', 'root'),
    SPROUTGIT_WORKTREES_PATH: join(args.workspacePath, '.sproutgit', 'worktrees'),
    SPROUTGIT_WORKTREE: args.worktreePath,
    SPROUTGIT_WORKTREE_NAME: basename(args.worktreePath),
    SPROUTGIT_WORKTREE_BRANCH: wtMeta?.branch ?? '',
    SPROUTGIT_SOURCE_REF: wtMeta?.sourceRef ?? '',
    SPROUTGIT_OS: osName,
    // Fixed value now that there's a single configured agent rather than a
    // roster of named agents with distinct ids — kept for scripts/hooks that
    // already key off this var to detect an agent-launched session.
    SPROUTGIT_AGENT: 'agent',
    SPROUTGIT_ISSUE_REF: issueRef,
    SPROUTGIT_ISSUE_URL: issueRef ? resolveIssueUrl(issueRef, issuePatterns) : '',
    SPROUTGIT_ISSUE_TITLE: wtMeta?.issueTitle ?? '',
  };
}

export function registerAgentHandlers(configDb: ConfigDb, getWindow: () => BrowserWindow | null): void {
  handle(IPC.AGENT_GET, () => getAgentConfig(configDb));

  handle(IPC.AGENT_SAVE, (_e, config: AgentConfig) => {
    saveAgentConfig(configDb, config);
  });

  handle(IPC.AGENT_LAUNCH, async (_e, args: {
    workspacePath: string;
    worktreePath: string;
  }) => {
    const win = getWindow();
    if (!win) throw new Error('No active window to launch the agent in.');

    const agent = getAgentConfig(configDb);
    if (!agent.command.trim()) {
      throw new Error('No agent command configured. Set one in Settings → AI Agent.');
    }

    const env = await buildAgentEnv(args);

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
        label: 'AI Agent',
        agentId: 'agent',
      });
    } catch (spawnErr) {
      const message = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
      throw new Error(`Failed to launch agent (command: ${JSON.stringify(agent.command)}, args: ${JSON.stringify(agent.args)}): ${message}`, { cause: spawnErr });
    }

    sessionWindows.set(id, win);

    win.webContents.send(IPC.EVENT_AGENT_TERMINAL_LAUNCH, {
      terminalId: id,
      cwd: args.worktreePath,
    });

    return id;
  });

  // ── Test ──────────────────────────────────────────────────────────────
  // Actually runs the configured agent command with a small fixed real
  // prompt and confirms non-empty, non-error stdout comes back — not just
  // `<cmd> --version`. Only Claude Code's non-interactive prompt flag (-p)
  // is known (same invocation chat.ts's spawnClaudeTurn uses); any other
  // configured command would likely just hang waiting for interactive
  // input on a bare positional prompt, so we confirm the binary resolves
  // and stop there rather than guessing at a flag.
  handle(IPC.AGENT_TEST, async (): Promise<ToolTestResult> => {
    const agent = getAgentConfig(configDb);
    const { bin, args: leadingArgs } = splitCommand(agent.command);
    if (!bin) return errResult('', 'No agent command configured.');

    const resolved = await resolveCommandPath(bin);
    if (!resolved) return errResult(bin, `Command not found on PATH: ${bin}`);

    if (!commandSupportsIntegratedMode(agent.command)) {
      return okResult(resolved, `Found ${resolved}. This command's non-interactive prompt flag isn't known, so a live prompt test wasn't run — only Claude Code supports that right now.`);
    }

    const prompt = 'Reply with only the word OK.';
    const testArgs = [...leadingArgs, ...agent.args, '-p', prompt];
    const resolvedCommand = `${resolved} ${testArgs.join(' ')}`;

    return new Promise(resolve => {
      const child = execFile(
        resolved,
        testArgs,
        { timeout: 15_000, maxBuffer: 5 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            resolve(errResult(resolvedCommand, error.killed ? 'Agent timed out after 15s.' : (stderr.trim() || error.message), truncate(stdout + stderr)));
            return;
          }
          const trimmed = stdout.trim();
          if (!trimmed) {
            resolve(errResult(resolvedCommand, 'Agent produced no output.', truncate(stderr)));
            return;
          }
          resolve(okResult(resolvedCommand, `Agent responded: "${truncate(trimmed, 200)}"`));
        },
      );
      child.stdin?.end();
    });
  });
}
