import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getWorktreeStatus } from '../staging.js';

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  createdDirs.push(dir);
  return dir;
}

function createRepoWithOneTrackedFile(dir: string): void {
  mkdirSync(dir, { recursive: true });
  execSync('git init -b main', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@sproutgit.test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "SproutGit Test"', { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "initial commit"', { cwd: dir, stdio: 'ignore' });
}

describe('getWorktreeStatus', () => {
  // Regression: `git status --porcelain=v1` prefixes an unstaged-only entry
  // with a literal leading space (" M path"). Porcelain status/index codes
  // are column-positional, so if that first line's leading space is ever
  // trimmed off, every column shifts — the file misreports as staged and its
  // path loses its first character. This only shows up on the very first
  // status line (a whole-blob `.trim()` doesn't touch interior lines), which
  // is also the common case of "exactly one file changed".
  it('reports a single unstaged modification as unstaged, with the full path intact', async () => {
    const repoPath = tempDir('sg-status-single-unstaged-');
    createRepoWithOneTrackedFile(repoPath);
    writeFileSync(join(repoPath, 'a.ts'), 'export const a = 2;\n');

    const { files } = await getWorktreeStatus(repoPath);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: 'a.ts',
      staged: false,
      indexStatus: ' ',
      workTreeStatus: 'M',
    });
  });

  it('reports a single staged addition as staged', async () => {
    const repoPath = tempDir('sg-status-single-staged-');
    createRepoWithOneTrackedFile(repoPath);
    writeFileSync(join(repoPath, 'b.ts'), 'export const b = 1;\n');
    execSync('git add b.ts', { cwd: repoPath, stdio: 'ignore' });

    const { files } = await getWorktreeStatus(repoPath);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: 'b.ts',
      staged: true,
      indexStatus: 'A',
    });
  });

  it('reports both an unstaged and a staged file together, each with the correct path', async () => {
    const repoPath = tempDir('sg-status-mixed-');
    createRepoWithOneTrackedFile(repoPath);
    writeFileSync(join(repoPath, 'a.ts'), 'export const a = 3;\n');
    writeFileSync(join(repoPath, 'c.ts'), 'export const c = 1;\n');
    execSync('git add c.ts', { cwd: repoPath, stdio: 'ignore' });

    const { files } = await getWorktreeStatus(repoPath);
    const byPath = Object.fromEntries(files.map(f => [f.path, f]));

    expect(byPath['a.ts']).toMatchObject({ staged: false, workTreeStatus: 'M' });
    expect(byPath['c.ts']).toMatchObject({ staged: true, indexStatus: 'A' });
  });
});
