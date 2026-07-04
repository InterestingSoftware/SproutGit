/**
 * Real (non `--version`) "Test" handlers for the settings rows: editor,
 * diff tool, merge tool, shell, and commit message generator. (The AI agent
 * test lives in agents.ts alongside AGENT_LAUNCH since it shares agent-config
 * resolution logic.)
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IPC } from '@sproutgit/types';
import type { CommitMessageGeneratorSettings } from '@sproutgit/types';
import { handle } from './handle.js';
import {
  resolveCommandPath,
  splitCommand,
  spawnAndConfirmLaunch,
  truncate,
  okResult,
  errResult,
} from './tool-test-helpers.js';

const execFileAsync = promisify(execFile);

/** Substitutes $LOCAL / $REMOTE / $MERGED / $BASE tokens the same way Git does for diff/merge tool commands. */
function substituteDiffMergeVars(args: string[], vars: Record<string, string>): string[] {
  return args.map(a => a.replace(/\$(LOCAL|REMOTE|MERGED|BASE)\b/g, (m, name: string) => vars[name] ?? m));
}

export function registerToolTestHandlers(): void {
  // ── Editor ──────────────────────────────────────────────────────────────
  handle(IPC.TOOLTEST_EDITOR, async (_e, configuredEditor: string) => {
    const { bin, args } = splitCommand(configuredEditor);
    if (!bin) return errResult('', 'No editor configured.');

    const resolved = await resolveCommandPath(bin);
    if (!resolved) return errResult(bin, `Command not found on PATH: ${bin}`);

    return withTmp('sg-test-editor-', async dir => {
      const scratchFile = join(dir, 'sproutgit-editor-test.txt');
      writeFileSync(scratchFile, 'SproutGit editor test scratch file.\n', 'utf8');
      const fullArgs = [...args, scratchFile];
      const resolvedCommand = `${resolved} ${fullArgs.join(' ')}`;
      const result = await spawnAndConfirmLaunch({ bin: resolved, args: fullArgs, cwd: dir });
      if (!result.ok) return errResult(resolvedCommand, result.error ?? 'Launch failed', truncate(result.stderr));
      return okResult(resolvedCommand, `Editor launched successfully${result.pid ? ` (pid ${result.pid})` : ''} against ${scratchFile}.`);
    });
  });

  // ── Diff tool ───────────────────────────────────────────────────────────
  handle(IPC.TOOLTEST_DIFF_TOOL, async (_e, configuredDiffCommand: string) => {
    const { bin, args } = splitCommand(configuredDiffCommand);
    if (!bin) return errResult('', 'No diff tool configured.');

    const resolved = await resolveCommandPath(bin);
    if (!resolved) return errResult(bin, `Command not found on PATH: ${bin}`);

    return withTmp('sg-test-difftool-', async dir => {
      const localFile = join(dir, 'local.txt');
      const remoteFile = join(dir, 'remote.txt');
      writeFileSync(localFile, 'line one\nline two (local)\n', 'utf8');
      writeFileSync(remoteFile, 'line one\nline two (remote)\n', 'utf8');
      const substituted = substituteDiffMergeVars(args.length > 0 ? args : ['$LOCAL', '$REMOTE'], { LOCAL: localFile, REMOTE: remoteFile, MERGED: '', BASE: '' });
      const resolvedCommand = `${resolved} ${substituted.join(' ')}`;
      const result = await spawnAndConfirmLaunch({ bin: resolved, args: substituted, cwd: dir });
      if (!result.ok) return errResult(resolvedCommand, result.error ?? 'Launch failed', truncate(result.stderr));
      return okResult(resolvedCommand, `Diff tool launched successfully${result.pid ? ` (pid ${result.pid})` : ''} against two scratch files.`);
    });
  });

  // ── Merge tool ──────────────────────────────────────────────────────────
  handle(IPC.TOOLTEST_MERGE_TOOL, async (_e, configuredMergeCommand: string) => {
    const { bin, args } = splitCommand(configuredMergeCommand);
    if (!bin) return errResult('', 'No merge tool configured.');

    const resolved = await resolveCommandPath(bin);
    if (!resolved) return errResult(bin, `Command not found on PATH: ${bin}`);

    return withTmp('sg-test-mergetool-', async dir => {
      const localFile = join(dir, 'local.txt');
      const remoteFile = join(dir, 'remote.txt');
      const baseFile = join(dir, 'base.txt');
      const mergedFile = join(dir, 'merged.txt');
      writeFileSync(baseFile, 'line one\nline two\n', 'utf8');
      writeFileSync(localFile, 'line one\nline two (local edit)\n', 'utf8');
      writeFileSync(remoteFile, 'line one\nline two (remote edit)\n', 'utf8');
      writeFileSync(mergedFile, 'line one\n<<<<<<< local\nline two (local edit)\n=======\nline two (remote edit)\n>>>>>>> remote\n', 'utf8');
      const substituted = substituteDiffMergeVars(args.length > 0 ? args : ['$MERGED'], { LOCAL: localFile, REMOTE: remoteFile, MERGED: mergedFile, BASE: baseFile });
      const resolvedCommand = `${resolved} ${substituted.join(' ')}`;
      const result = await spawnAndConfirmLaunch({ bin: resolved, args: substituted, cwd: dir });
      if (!result.ok) return errResult(resolvedCommand, result.error ?? 'Launch failed', truncate(result.stderr));
      return okResult(resolvedCommand, `Merge tool launched successfully${result.pid ? ` (pid ${result.pid})` : ''} against a 3-way merge scratch scenario.`);
    });
  });

  // ── Shell ───────────────────────────────────────────────────────────────
  handle(IPC.TOOLTEST_SHELL, async (_e, shellPath: string) => {
    if (!shellPath.trim()) return errResult('', 'No shell configured.');
    const resolved = await resolveCommandPath(shellPath) ?? shellPath;
    const isWindows = process.platform === 'win32';
    const base = resolved.split(/[\\/]/).pop()?.toLowerCase() ?? '';
    const args = isWindows && /powershell|pwsh/.test(base)
      ? ['-NoProfile', '-Command', 'Write-Output ok']
      : isWindows && base === 'cmd.exe'
        ? ['/c', 'echo ok']
        : ['-c', 'echo ok'];
    const resolvedCommand = `${resolved} ${args.join(' ')}`;
    try {
      const { stdout, stderr } = await execFileAsync(resolved, args, { timeout: 8000 });
      if (!stdout.includes('ok')) return errResult(resolvedCommand, 'Shell did not echo expected output.', truncate(stdout + stderr));
      return okResult(resolvedCommand, `Shell executed successfully: ${truncate(stdout, 200)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errResult(resolvedCommand, message);
    }
  });

  // ── Commit message generator ─────────────────────────────────────────────
  handle(IPC.TOOLTEST_COMMIT_MESSAGE_GENERATOR, async (_e, settings: CommitMessageGeneratorSettings) => {
    const command = typeof settings?.command === 'string' ? settings.command.trim() : '';
    const rawArgs = Array.isArray(settings?.args) ? settings.args.filter((a): a is string => typeof a === 'string') : [];
    if (!command) return errResult('', 'No commit message generator configured.');

    const resolved = await resolveCommandPath(command);
    if (!resolved) return errResult(command, `Command not found on PATH: ${command}`);

    return withTmp('sg-test-commitmsg-', async dir => {
      // Build a tiny real git repo, stage a trivial file diff, and run the
      // real generator command end-to-end against it — same code path
      // (execFile + stdin diff) as the production commitmsg:generate handler.
      const git = (gitArgs: string[]) => execFileAsync('git', gitArgs, { cwd: dir });
      try {
        await git(['init', '-q']);
        await git(['config', 'user.email', 'test@sproutgit.local']);
        await git(['config', 'user.name', 'SproutGit Test']);
        writeFileSync(join(dir, 'README.md'), '# Hello\n', 'utf8');
        await git(['add', 'README.md']);
        await git(['commit', '-q', '-m', 'initial commit']);
        writeFileSync(join(dir, 'README.md'), '# Hello\n\nAdded a line for the test.\n', 'utf8');
        await git(['add', 'README.md']);
      } catch (err) {
        return errResult(resolved, `Failed to set up scratch git repo: ${err instanceof Error ? err.message : String(err)}`);
      }

      const { stdout: diff } = await execFileAsync('git', ['diff', '--cached'], { cwd: dir });
      const substitutedArgs = rawArgs.map(a => a.replace(/\$\{?SPROUTGIT_RECENT_COMMITS\}?/g, 'initial commit'));
      const resolvedCommand = `${resolved} ${substitutedArgs.join(' ')}`;

      return new Promise(resolve => {
        let child: ReturnType<typeof import('node:child_process').execFile>;
        try {
          child = execFile(
            resolved,
            substitutedArgs,
            { cwd: dir, timeout: 20_000, maxBuffer: 10 * 1024 * 1024 },
            (error, stdout, stderr) => {
              if (error) {
                resolve(errResult(resolvedCommand, error.killed ? 'Generator timed out after 20s.' : (stderr.trim() || error.message), truncate(stdout + stderr)));
                return;
              }
              const message = stdout.trim();
              if (!message) {
                resolve(errResult(resolvedCommand, 'Generator produced no output.', truncate(stderr)));
                return;
              }
              resolve(okResult(resolvedCommand, `Generated message: "${truncate(message, 200)}"`));
            },
          );
        } catch (err) {
          resolve(errResult(resolvedCommand, err instanceof Error ? err.message : String(err)));
          return;
        }
        child.stdin?.on('error', () => { /* surfaced via callback */ });
        child.stdin?.write(diff);
        child.stdin?.end();
      });
    });
  });
}

async function withTmp<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
