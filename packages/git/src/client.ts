import { simpleGit } from 'simple-git';
import type { SimpleGit } from 'simple-git';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type GitInfo } from '@sproutgit/types';
import { trackGitOperation } from './pending-ops.js';

const execFileAsync = promisify(execFile);

const IS_DEV = process.env['NODE_ENV'] === 'development';

/**
 * Returns a `simple-git` instance scoped to a directory with safe options.
 * All operations timeout after 60 s to prevent hanging on network calls.
 * In development, all git commands are logged to the console with timing via
 * the simple-git outputHandler.
 *
 * Wrapped in a Proxy so every method call is tracked via `trackGitOperation`
 * — this is what lets `waitForIdleRepo()` know whether any git command
 * against `cwd` is still running, regardless of which higher-level function
 * (status, commit, diff, worktree list, ...) issued it.
 */
export function gitForPath(cwd: string): SimpleGit {
  const git = simpleGit({
    baseDir: cwd,
    binary: 'git',
    maxConcurrentProcesses: 6,
    // Not `true`: simple-git's `trimmed` option trims the *entire* raw
    // output blob, including the first line's leading character(s) — for
    // `git status --porcelain`, a clean index (` M path`) legitimately
    // starts with a space, so a whole-blob trim silently eats it and shifts
    // every fixed-column parse in parsePorcelainStatus() off by one.
    // Callers that need trimming already do it themselves (trailing-only,
    // see diff.ts/staging.ts), so this is off globally.
    trimmed: false,
    timeout: { block: 60_000 },
  });

  if (IS_DEV) {
    git.outputHandler((cmd, stdout, stderr, args) => {
      const t0 = Date.now();
      const label = `[git] ${args.slice(0, 3).join(' ')}`;
      // eslint-disable-next-line no-console
      const done = () => console.debug(`  ${label} (${Date.now() - t0}ms)`);
      stdout.on('close', done);
      stderr.on('data', (chunk: Buffer) => {
        const msg = chunk.toString().trim();
        // eslint-disable-next-line no-console
        if (msg) console.warn(`  ${label} stderr: ${msg}`);
      });
    });
  }

  return new Proxy(git, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver) as unknown;
      if (typeof original !== 'function') return original;
      return (...args: unknown[]) => {
        const result = (original as (...a: unknown[]) => unknown).apply(target, args);
        return result instanceof Promise ? trackGitOperation(cwd, result) : result;
      };
    },
  }) as SimpleGit;
}

/**
 * Detects whether git is installed and returns its version.
 * Uses `execFile` directly so we can query git outside any repo context.
 */
export async function getGitInfo(): Promise<GitInfo> {
  try {
    const { stdout } = await execFileAsync('git', ['--version'], { timeout: 5_000 });
    const match = /git version (\S+)/.exec(stdout.trim());
    return { installed: true, version: match?.[1] ?? null };
  } catch {
    return { installed: false, version: null };
  }
}
