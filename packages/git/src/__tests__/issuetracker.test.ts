import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readIssueTrackerFile } from '../issuetracker.js';

function initTestRepo(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sg-issuetracker-test-')));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('readIssueTrackerFile', () => {
  let repoPath: string;

  beforeAll(() => {
    repoPath = initTestRepo();
  });

  afterAll(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it('returns an empty array when no .issuetracker file exists', async () => {
    const patterns = await readIssueTrackerFile(repoPath);
    expect(patterns).toEqual([]);
  });

  it('parses a single pattern', async () => {
    writeFileSync(
      join(repoPath, '.issuetracker'),
      '[issuetracker "Jira"]\n    regex = "ABCD-(\\\\d+)"\n    url = "https://my-company.atlassian.net/browse/ABCD-$1"\n',
    );
    const patterns = await readIssueTrackerFile(repoPath);
    expect(patterns).toEqual([
      { label: 'Jira', regex: 'ABCD-(\\d+)', url: 'https://my-company.atlassian.net/browse/ABCD-$1' },
    ]);
  });

  it('parses multiple patterns', async () => {
    writeFileSync(
      join(repoPath, '.issuetracker'),
      [
        '[issuetracker "Jira"]',
        '    regex = "ABCD-(\\\\d+)"',
        '    url = "https://my-company.atlassian.net/browse/ABCD-$1"',
        '[issuetracker "GitHub"]',
        '    regex = "#(\\\\d+)"',
        '    url = "https://github.com/org/repo/issues/$1"',
        '',
      ].join('\n'),
    );
    const patterns = await readIssueTrackerFile(repoPath);
    expect(patterns).toHaveLength(2);
    expect(patterns.map(p => p.label).sort()).toEqual(['GitHub', 'Jira']);
  });

  it('ignores a section missing regex or url', async () => {
    writeFileSync(
      join(repoPath, '.issuetracker'),
      '[issuetracker "Incomplete"]\n    regex = "ABCD-(\\\\d+)"\n',
    );
    const patterns = await readIssueTrackerFile(repoPath);
    expect(patterns).toEqual([]);
  });
});
