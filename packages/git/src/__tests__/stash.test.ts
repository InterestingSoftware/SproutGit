import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStash, listStashes, applyStash, popStash, dropStash } from '../stash.js';

function initTestRepo(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sg-stash-test-')));

  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@sproutgit.test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "SproutGit Test"', { cwd: dir, stdio: 'ignore' });

  writeFileSync(join(dir, 'README.md'), '# Test Repo\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "initial commit"', { cwd: dir, stdio: 'ignore' });

  return dir;
}

describe('stash', () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = initTestRepo();
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it('lists no stashes in a clean repo', async () => {
    const result = await listStashes(repoPath);
    expect(result.stashes).toEqual([]);
  });

  it('creates a stash with a custom message and lists it', async () => {
    writeFileSync(join(repoPath, 'README.md'), '# Test Repo\nmodified\n');

    await createStash(repoPath, 'my stash message');

    const result = await listStashes(repoPath);
    expect(result.stashes).toHaveLength(1);
    expect(result.stashes[0]?.ref).toBe('stash@{0}');
    expect(result.stashes[0]?.message).toContain('my stash message');
  });

  it('creates a stash without a message using the default WIP message', async () => {
    writeFileSync(join(repoPath, 'README.md'), '# Test Repo\nmodified\n');

    await createStash(repoPath);

    const result = await listStashes(repoPath);
    expect(result.stashes).toHaveLength(1);
    expect(result.stashes[0]?.message).toContain('WIP on');
  });

  it('leaves the working tree clean after stashing', async () => {
    writeFileSync(join(repoPath, 'README.md'), '# Test Repo\nmodified\n');
    await createStash(repoPath, 'clears working tree');

    const status = execSync('git status --porcelain', { cwd: repoPath }).toString();
    expect(status.trim()).toBe('');
  });

  it('applies a stash without removing it', async () => {
    writeFileSync(join(repoPath, 'README.md'), '# Test Repo\napplied\n');
    await createStash(repoPath, 'to apply');

    await applyStash(repoPath, 'stash@{0}');

    const content = execSync('cat README.md', { cwd: repoPath }).toString();
    expect(content).toContain('applied');

    const result = await listStashes(repoPath);
    expect(result.stashes).toHaveLength(1);
  });

  it('pops a stash, applying it and removing it from the list', async () => {
    writeFileSync(join(repoPath, 'README.md'), '# Test Repo\npopped\n');
    await createStash(repoPath, 'to pop');

    await popStash(repoPath, 'stash@{0}');

    const content = execSync('cat README.md', { cwd: repoPath }).toString();
    expect(content).toContain('popped');

    const result = await listStashes(repoPath);
    expect(result.stashes).toEqual([]);
  });

  it('drops a stash without applying it', async () => {
    writeFileSync(join(repoPath, 'README.md'), '# Test Repo\ndropped\n');
    await createStash(repoPath, 'to drop');

    await dropStash(repoPath, 'stash@{0}');

    const result = await listStashes(repoPath);
    expect(result.stashes).toEqual([]);

    const content = execSync('cat README.md', { cwd: repoPath }).toString();
    expect(content).not.toContain('dropped');
  });

  it('includes untracked files in the stash (not just tracked modifications)', async () => {
    writeFileSync(join(repoPath, 'untracked.txt'), 'new file\n');

    await createStash(repoPath, 'untracked file');

    const status = execSync('git status --porcelain', { cwd: repoPath }).toString();
    expect(status.trim()).toBe('');

    const result = await listStashes(repoPath);
    expect(result.stashes).toHaveLength(1);

    await popStash(repoPath, 'stash@{0}');
    const content = execSync('cat untracked.txt', { cwd: repoPath }).toString();
    expect(content).toBe('new file\n');
  });

  it('lists multiple stashes newest first, matching stash@{N} refs', async () => {
    writeFileSync(join(repoPath, 'README.md'), '# Test Repo\nfirst\n');
    await createStash(repoPath, 'first stash');

    writeFileSync(join(repoPath, 'README.md'), '# Test Repo\nsecond\n');
    await createStash(repoPath, 'second stash');

    const result = await listStashes(repoPath);
    expect(result.stashes).toHaveLength(2);
    expect(result.stashes[0]?.ref).toBe('stash@{0}');
    expect(result.stashes[0]?.message).toContain('second stash');
    expect(result.stashes[1]?.ref).toBe('stash@{1}');
    expect(result.stashes[1]?.message).toContain('first stash');
  });
});
