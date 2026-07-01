/**
 * AI commit-message generation.
 *
 * Runs a user-configured command against the staged diff to produce a commit
 * message. The command is spawned with `execFile` (never through a shell) so
 * there is no string interpolation to sanitise.
 */
import { execFile } from 'node:child_process';
import { basename, join } from 'node:path';
import { IPC } from '@sproutgit/types';
import type { CommitMessageGeneratorSettings, CommitMessageGenerateResult } from '@sproutgit/types';
import { getStagedDiff, getRecentCommitSubjects } from '@sproutgit/git';
import { handle } from './handle.js';
import { log } from '../telemetry.js';

const GENERATE_TIMEOUT_MS = 90_000;
const RECENT_COMMIT_COUNT = 10;

/**
 * Replaces `$SPROUTGIT_*` / `${SPROUTGIT_*}` tokens in a string with the
 * matching value from `env`. This lets preset prompts reference vars like
 * `$SPROUTGIT_RECENT_COMMITS` without needing a shell (args are never
 * shell-parsed, so plain env expansion would otherwise never happen).
 */
function substituteSproutgitVars(input: string, env: Record<string, string>): string {
  return input.replace(/\$\{?(SPROUTGIT_[A-Z_]+)\}?/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(env, name) ? env[name]! : match
  );
}

export function registerCommitMessageGeneratorHandlers(): void {
  handle(IPC.COMMITMSG_GENERATE, async (_e, args: {
    workspacePath: string;
    worktreePath: string;
    settings: CommitMessageGeneratorSettings;
  }): Promise<CommitMessageGenerateResult> => {
    const command = args.settings.command.trim();
    if (!command) {
      return { error: 'No commit message generator configured. Pick a preset or enter a command in Settings.' };
    }

    const diff = await getStagedDiff(args.worktreePath);
    if (!diff.trim()) {
      return { error: 'No staged changes to generate a message for.' };
    }

    const recentSubjects = await getRecentCommitSubjects(args.worktreePath, RECENT_COMMIT_COUNT);

    const osName = process.platform === 'darwin' ? 'macos'
      : process.platform === 'win32' ? 'windows'
      : 'linux';

    const sproutgitEnv: Record<string, string> = {
      SPROUTGIT_WORKSPACE: args.workspacePath,
      SPROUTGIT_WORKSPACE_NAME: basename(args.workspacePath),
      SPROUTGIT_ROOT_PATH: join(args.workspacePath, '.sproutgit', 'root'),
      SPROUTGIT_WORKTREES_PATH: join(args.workspacePath, '.sproutgit', 'worktrees'),
      SPROUTGIT_WORKTREE: args.worktreePath,
      SPROUTGIT_WORKTREE_NAME: basename(args.worktreePath),
      SPROUTGIT_OS: osName,
      SPROUTGIT_RECENT_COMMITS: recentSubjects.join('\n'),
    };

    const substitutedArgs = args.settings.args.map(a => substituteSproutgitVars(a, sproutgitEnv));

    return new Promise<CommitMessageGenerateResult>(resolve => {
      let child: ReturnType<typeof execFile>;
      try {
        child = execFile(
          command,
          substitutedArgs,
          {
            cwd: args.worktreePath,
            env: { ...process.env, ...sproutgitEnv },
            timeout: GENERATE_TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024,
          },
          (error, stdout, stderr) => {
            if (error) {
              log.error('[commitmsg:generate] generator failed', error, stderr);
              if (error.killed) {
                resolve({ error: `Generator timed out after ${GENERATE_TIMEOUT_MS / 1000}s.` });
                return;
              }
              resolve({ error: stderr.trim() || error.message });
              return;
            }
            const message = stdout.trim();
            if (!message) {
              resolve({ error: 'Generator produced no output.' });
              return;
            }
            resolve({ message });
          }
        );
      } catch (spawnErr) {
        log.error('[commitmsg:generate] failed to spawn generator', spawnErr);
        resolve({ error: spawnErr instanceof Error ? spawnErr.message : String(spawnErr) });
        return;
      }
      // A generator that doesn't read stdin (or exits early) can break the
      // pipe; without a listener that 'error' event would crash the process.
      child.stdin?.on('error', () => { /* surfaced via the execFile callback's error/stderr */ });
      child.stdin?.write(diff);
      child.stdin?.end();
    });
  });
}
