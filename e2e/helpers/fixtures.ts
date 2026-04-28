import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Faker, en } from '@faker-js/faker';

const HERE = dirname(fileURLToPath(import.meta.url));

export const ROOT = resolve(HERE, '../../');
export const TEST_DIR = process.env.SPROUTGIT_E2E_TEST_DIR ?? join(ROOT, 'tmp', 'test');
export const REPOS_DIR = join(TEST_DIR, 'repos');
export const CANARIES_DIR = join(TEST_DIR, 'canaries');
export const CONFIG_DB_PATH = process.env.SPROUTGIT_CONFIG_DB_PATH;

const BASE_GIT_ENV = {
  GIT_AUTHOR_NAME: 'SproutGit Test',
  GIT_AUTHOR_EMAIL: 'test@sproutgit.test',
  GIT_COMMITTER_NAME: 'SproutGit Test',
  GIT_COMMITTER_EMAIL: 'test@sproutgit.test',
  GIT_TERMINAL_PROMPT: '0',
};

// Shared Faker instance — seeded per call to produce deterministic but
// organic-looking commit timestamps spread over the past ~3 months.
const _faker = new Faker({ locale: [en] });

function commitDate(sequence: number): string {
  const SPREAD_DAYS = 90;
  const MAX_SEQ = 42;

  // Linear interpolation: seq 0 = oldest (~90 days ago), higher = more recent.
  const daysAgo = SPREAD_DAYS * (1 - sequence / MAX_SEQ);

  // Seed per-sequence so dates are reproducible across test runs.
  _faker.seed(sequence * 8_675_309);
  const refDate = new Date(Date.now() - daysAgo * 86_400_000);
  // Small jitter: pick a moment within ±6 hours of the reference point.
  const d = _faker.date.between({
    from: new Date(refDate.getTime() - 6 * 3_600_000),
    to: new Date(refDate.getTime() + 6 * 3_600_000),
  });
  // Clamp to typical working hours so commits look human.
  d.setHours(_faker.number.int({ min: 9, max: 18 }), _faker.number.int({ min: 0, max: 59 }), 0, 0);
  return d.toISOString();
}

// Produce a realistic developer name and email for a given sequence number.
// Seeded separately from commitDate so they're independent.
function authorInfo(sequence: number): { name: string; email: string } {
  _faker.seed(sequence * 3_141_592 + 1);
  const firstName = _faker.person.firstName();
  const lastName = _faker.person.lastName();
  const name = `${firstName} ${lastName}`;
  const email = _faker.internet.email({ firstName, lastName }).toLowerCase();
  return { name, email };
}

function gitEnv(sequence: number) {
  const date = commitDate(sequence);
  const { name, email } = authorInfo(sequence);
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
}

export function runGit(cwd: string, args: string[], extraEnv: Record<string, string> = {}) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_COMMON_DIR;

  return execFileSync('git', args, {
    cwd,
    env: { ...env, ...BASE_GIT_ENV, ...extraEnv },
    stdio: 'pipe',
  })
    .toString()
    .trim();
}

export function cleanupTestDirs() {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

export function setupTestDirs() {
  mkdirSync(REPOS_DIR, { recursive: true });
  mkdirSync(CANARIES_DIR, { recursive: true });
}

export function resetTestDirs() {
  cleanupTestDirs();
  setupTestDirs();
}

export function resetConfigDb() {
  if (CONFIG_DB_PATH) {
    rmSync(CONFIG_DB_PATH, { force: true });
    rmSync(`${CONFIG_DB_PATH}-wal`, { force: true });
    rmSync(`${CONFIG_DB_PATH}-shm`, { force: true });
  }
}

export function querySqlite(dbPath: string, sql: string): string[][] {
  const output = execFileSync('sqlite3', ['-separator', '\t', dbPath, sql], {
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
  if (!output) return [];
  return output.split('\n').map(row => row.split('\t'));
}

export function executeSqlite(dbPath: string, sql: string) {
  execFileSync('sqlite3', [dbPath, sql], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

export function commitAll(repoPath: string, message: string, sequence: number) {
  runGit(repoPath, ['add', '--all']);
  runGit(repoPath, ['commit', '-m', message], gitEnv(sequence));
}

export function checkout(repoPath: string, ref: string, create = false) {
  runGit(repoPath, create ? ['checkout', '-b', ref] : ['checkout', ref]);
}

export function mergeNoFastForward(
  repoPath: string,
  ref: string,
  message: string,
  sequence: number
) {
  runGit(repoPath, ['merge', '--no-ff', ref, '-m', message], gitEnv(sequence));
}

export function createAnnotatedTag(
  repoPath: string,
  tag: string,
  message: string,
  sequence: number
) {
  runGit(repoPath, ['tag', '-a', tag, '-m', message], gitEnv(sequence));
}

export function writeRepoFile(repoPath: string, relativePath: string, content: string) {
  const absolutePath = join(repoPath, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
  return absolutePath;
}

export function appendRepoFile(repoPath: string, relativePath: string, line: string) {
  appendFileSync(join(repoPath, relativePath), `${line}\n`);
}

interface CreateTestRepoOptions {
  extraCommits?: number;
  branches?: string[];
  files?: Record<string, string>;
}

export function createTestRepo(name: string, opts: CreateTestRepoOptions = {}) {
  const { extraCommits = 0, branches = [], files = {} } = opts;

  const repoPath = join(REPOS_DIR, name);
  mkdirSync(repoPath, { recursive: true });

  runGit(repoPath, ['init', '-b', 'main']);
  runGit(repoPath, ['config', 'user.email', 'test@sproutgit.test']);
  runGit(repoPath, ['config', 'user.name', 'SproutGit Test']);

  writeRepoFile(repoPath, 'README.md', `# ${name}\n\nGenerated by SproutGit E2E tests.\n`);
  for (const [relativePath, content] of Object.entries(files)) {
    writeRepoFile(repoPath, relativePath, content);
  }
  commitAll(repoPath, 'Initial commit', 0);

  for (let index = 1; index <= extraCommits; index += 1) {
    writeRepoFile(repoPath, `docs/note-${index}.md`, `note ${index}\n`);
    commitAll(repoPath, `Add note ${index}`, index);
  }

  for (const branch of branches) {
    runGit(repoPath, ['branch', branch]);
  }

  return repoPath;
}

export function cloneCanaryRepo(targetPath: string, remoteUrl: string, ref: string | null = null) {
  rmSync(targetPath, { recursive: true, force: true });
  runGit(TEST_DIR, ['clone', '--depth', '1', remoteUrl, targetPath]);
  if (ref) {
    runGit(targetPath, ['fetch', '--depth', '1', 'origin', ref]);
    runGit(targetPath, ['checkout', ref]);
  }
  return targetPath;
}
