import { describe, it, expect, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getWorktreeStatus, stageHunk, unstageHunk } from '../staging.js';
import { getUnstagedFileDiff, getStagedDiff } from '../diff.js';

/** Creates a test repo with `initialContent` committed as file.txt. */
function initTestRepo(initialContent: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sg-git-hunk-test-')));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@sproutgit.test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "SproutGit Test"', { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'file.txt'), initialContent);
  execSync('git add file.txt', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "initial commit"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function readIndexedFile(dir: string): string {
  return execSync('git show :file.txt', { cwd: dir }).toString();
}

// 30 lines so two single-line edits far enough apart (line 2 and line 25) land
// in separate hunks under the default --unified=3 context.
const THIRTY_LINES = Array.from({ length: 30 }, (_, i) => String(i + 1));

describe('stageHunk / unstageHunk', () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = initTestRepo(THIRTY_LINES.join('\n') + '\n');
    return () => rmSync(repoPath, { recursive: true, force: true });
  });

  it('stages only the requested hunk, leaving the other one unstaged', async () => {
    const modified = [...THIRTY_LINES];
    modified[1] = 'TWO';
    modified[24] = 'TWENTYFIVE';
    writeFileSync(join(repoPath, 'file.txt'), modified.join('\n') + '\n');

    const raw = await getUnstagedFileDiff(repoPath, 'file.txt');
    expect(raw.match(/^@@/gm) ?? []).toHaveLength(2);

    await stageHunk(repoPath, 'file.txt', 0);

    const status = await getWorktreeStatus(repoPath);
    const entry = status.files.find(f => f.path === 'file.txt');
    expect(entry?.indexStatus).not.toBe(' '); // something staged
    expect(entry?.workTreeStatus).not.toBe(' '); // still something unstaged

    const stagedDiff = await getStagedDiff(repoPath, 'file.txt');
    expect(stagedDiff).toContain('+TWO');
    expect(stagedDiff).not.toContain('+TWENTYFIVE');

    const remainingUnstaged = await getUnstagedFileDiff(repoPath, 'file.txt');
    expect(remainingUnstaged).toContain('+TWENTYFIVE');
    expect(remainingUnstaged).not.toContain('+TWO');
  });

  it('stages only the selected lines within a hunk', async () => {
    // Two single-line edits close enough to land in one hunk, but far enough
    // apart (surrounded by unchanged context) that git emits them as
    // independent del/add pairs rather than a merged del-block/add-block —
    // i.e. hunk.lines is [ctx..., del(two), add(TWO), ctx..., del(six), add(SIX), ctx...].
    const original = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    const localRepo = initTestRepo(original.join('\n') + '\n');
    try {
      const modified = [...original];
      modified[1] = 'TWO';
      modified[5] = 'SIX';
      writeFileSync(join(localRepo, 'file.txt'), modified.join('\n') + '\n');

      const raw = await getUnstagedFileDiff(localRepo, 'file.txt');
      expect(raw.match(/^@@/gm) ?? []).toHaveLength(1); // single hunk containing both edits
      const allLines = raw.split('\n').filter(l => l !== '');
      const bodyLines = allLines.slice(allLines.findIndex(l => l.startsWith('@@')) + 1);
      expect(bodyLines).toEqual([
        ' one', '-two', '+TWO', ' three', ' four', ' five', '-six', '+SIX', ' seven', ' eight', ' nine',
      ]);
      // Indices into hunk.lines: 0=one(ctx) 1=two(del) 2=TWO(add) 3=three(ctx) 4=four(ctx) 5=five(ctx) 6=six(del) 7=SIX(add) ...
      await stageHunk(localRepo, 'file.txt', 0, [1, 2]);

      const stagedDiff = await getStagedDiff(localRepo, 'file.txt');
      expect(stagedDiff).toContain('+TWO');
      expect(stagedDiff).not.toContain('+SIX');

      const remaining = await getUnstagedFileDiff(localRepo, 'file.txt');
      expect(remaining).toContain('+SIX');
      expect(remaining).not.toContain('+TWO');

      // The index should now read "TWO" in place of "two", with "six" untouched.
      const indexed = readIndexedFile(localRepo);
      expect(indexed).toContain('TWO');
      expect(indexed).toContain('\nsix\n');
    } finally {
      rmSync(localRepo, { recursive: true, force: true });
    }
  });

  it('unstages only the requested hunk, leaving the other one staged', async () => {
    const modified = [...THIRTY_LINES];
    modified[1] = 'TWO';
    modified[24] = 'TWENTYFIVE';
    writeFileSync(join(repoPath, 'file.txt'), modified.join('\n') + '\n');
    execSync('git add file.txt', { cwd: repoPath, stdio: 'ignore' });

    const stagedRaw = await getStagedDiff(repoPath, 'file.txt');
    expect(stagedRaw.match(/^@@/gm) ?? []).toHaveLength(2);

    await unstageHunk(repoPath, 'file.txt', 0);

    const stagedAfter = await getStagedDiff(repoPath, 'file.txt');
    expect(stagedAfter).not.toContain('+TWO');
    expect(stagedAfter).toContain('+TWENTYFIVE');

    const unstagedAfter = await getUnstagedFileDiff(repoPath, 'file.txt');
    expect(unstagedAfter).toContain('+TWO');
    expect(unstagedAfter).not.toContain('+TWENTYFIVE');
  });

  it('round-trips a file with no trailing newline', async () => {
    const noNewlineRepo = initTestRepo('one\ntwo');
    try {
      writeFileSync(join(noNewlineRepo, 'file.txt'), 'one\nTWO');
      await stageHunk(noNewlineRepo, 'file.txt', 0);
      const content = readIndexedFile(noNewlineRepo);
      expect(content).toBe('one\nTWO');
    } finally {
      rmSync(noNewlineRepo, { recursive: true, force: true });
    }
  });

  it('leaves the working tree file content untouched after staging a hunk', async () => {
    const modified = [...THIRTY_LINES];
    modified[1] = 'TWO';
    modified[24] = 'TWENTYFIVE';
    const modifiedContent = modified.join('\n') + '\n';
    writeFileSync(join(repoPath, 'file.txt'), modifiedContent);

    await stageHunk(repoPath, 'file.txt', 0);

    // Working tree content must be untouched by a --cached apply.
    const workingContent = execSync('cat file.txt', { cwd: repoPath }).toString();
    expect(workingContent).toBe(modifiedContent);
  });
});
