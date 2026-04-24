/**
 * Daily developer workflow E2E stories.
 *
 * These tests mirror realistic day-to-day use: a developer opens SproutGit,
 * sets up worktrees for active features, commits on each independently, and
 * cleans up merged work. Each step validates both the UI state and the
 * underlying git / SQLite reality.
 */
import { basename, dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { test, expect } from '../fixtures';
import {
  CONFIG_DB_PATH,
  createTestRepo,
  executeSqlite,
  mergeNoFastForward,
  querySqlite,
  resetConfigDb,
  resetTestDirs,
  runGit,
  writeRepoFile,
} from '../helpers/fixtures';
import {
  createWorktreeViaUi,
  DEFAULT_UI_TIMEOUT,
  deleteWorktreeViaUi,
  importRepoViaUi,
  openChangesTab,
  openHistoryTab,
  reloadToHome,
  selectWorktreeViaUi,
  stageAndCommitViaUi,
} from '../helpers/ui';

function assertNoUpstreamConfig(configText: string, branchName: string) {
  expect(configText).not.toContain(`branch.${branchName}.remote=`);
  expect(configText).not.toContain(`branch.${branchName}.merge=`);
}

function parseHeadMeta(repoPath: string) {
  const [commitTs, authorTs, authorName, authorEmail] = runGit(repoPath, [
    'show',
    '-s',
    '--format=%ct%x1f%at%x1f%an%x1f%ae',
    'HEAD',
  ]).split('\x1f');

  return {
    commitTs: Number(commitTs),
    authorTs: Number(authorTs),
    authorName,
    authorEmail,
  };
}

function parseGitDateEnv(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  const unixWithPrefix = trimmed.match(/^@(\d+)(?:\s+[+-]\d{4})?$/);
  if (unixWithPrefix) {
    return Number.parseInt(unixWithPrefix[1], 10);
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

async function waitForFile(filePath: string, timeoutMs = DEFAULT_UI_TIMEOUT) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (existsSync(filePath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  throw new Error(`Timed out waiting for file: ${filePath}`);
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function dailyAfterCreateHook() {
  if (process.platform === 'win32') {
    return {
      shell: 'pwsh',
      script: [
        "$outputDir = Join-Path $env:SPROUTGIT_WORKSPACE_PATH '.sproutgit/hook-output'",
        "New-Item -ItemType Directory -Force -Path $outputDir | Out-Null",
        "$outputFile = Join-Path $outputDir 'after-create.txt'",
        'Set-Content -Path $outputFile -Value "$env:SPROUTGIT_TRIGGER|$env:SPROUTGIT_WORKTREE_BRANCH|$env:SPROUTGIT_WORKTREE_PATH"',
      ].join('\n'),
    };
  }

  return {
    shell: process.platform === 'darwin' ? 'zsh' : 'bash',
    script: [
      'mkdir -p "$SPROUTGIT_WORKSPACE_PATH/.sproutgit/hook-output"',
      'printf "%s\\n" "$SPROUTGIT_TRIGGER|$SPROUTGIT_WORKTREE_BRANCH|$SPROUTGIT_WORKTREE_PATH" > "$SPROUTGIT_WORKSPACE_PATH/.sproutgit/hook-output/after-create.txt"',
    ].join('\n'),
  };
}

test.describe('Daily developer workflow', () => {
  test.beforeEach(async ({ tauriPage }) => {
    resetTestDirs();
    resetConfigDb();
    await reloadToHome(tauriPage);
  });

  // ---------------------------------------------------------------------------
  // Story 1: Morning standup — set up two feature branches as worktrees
  // ---------------------------------------------------------------------------
  test('sets up two feature worktrees from a fresh repo', async ({ tauriPage }) => {
    const repoPath = createTestRepo('daily-setup', {
      extraCommits: 3,
      files: { 'src/index.ts': 'export const version = "1.0.0";\n' },
    });

    await importRepoViaUi(tauriPage, repoPath);

    await createWorktreeViaUi(tauriPage, 'feature/user-auth');
    await createWorktreeViaUi(tauriPage, 'feature/api-refactor');

    // UI: both worktrees appear in the sidebar list
    const authItem = tauriPage.locator(
      '[data-testid="worktree-item"][data-branch="feature/user-auth"]',
    );
    const apiItem = tauriPage.locator(
      '[data-testid="worktree-item"][data-branch="feature/api-refactor"]',
    );
    await expect(authItem).toBeVisible();
    await expect(apiItem).toBeVisible();

    // Resolve the workspace root from the first worktree's data-path attribute.
    const authPath =
      (await authItem.getAttribute('data-path')) ??
      (() => {
        throw new Error('feature/user-auth worktree-item missing data-path');
      })();
    const gitRoot = join(dirname(dirname(authPath)), 'root');

    // Git: both worktrees are registered
    const worktreeList = runGit(gitRoot, ['worktree', 'list', '--porcelain']);
    expect(worktreeList).toContain('feature/user-auth');
    expect(worktreeList).toContain('feature/api-refactor');

    // Git: both branches exist
    const branches = runGit(gitRoot, ['branch']);
    expect(branches).toContain('feature/user-auth');
    expect(branches).toContain('feature/api-refactor');

    // SQLite (state.db): workspace meta is populated
    const stateDbPath = join(dirname(dirname(authPath)), '.sproutgit', 'state.db');
    const metaRows = querySqlite(
      stateDbPath,
      `SELECT value FROM meta WHERE key = 'workspace_path'`,
    );
    expect(metaRows.length).toBe(1);
    expect(metaRows[0]?.[0]).toContain('daily-setup-workspace');

    // SQLite (config.db): workspace appears in recent list
    if (CONFIG_DB_PATH) {
      const recentRows = querySqlite(
        CONFIG_DB_PATH,
        `SELECT workspace_path FROM recent_workspaces`,
      );
      const paths = recentRows.map((r) => r[0] ?? '');
      expect(paths.some((p) => p.includes('daily-setup-workspace'))).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // Story 2: Mid-day crunch — commit changes on each worktree independently
  // ---------------------------------------------------------------------------
  test('commits changes on each worktree without affecting the other', async ({ tauriPage }) => {
    const testStartEpoch = Math.floor(Date.now() / 1000) - 5;
    const repoPath = createTestRepo('daily-commits', {
      extraCommits: 2,
      // Pre-create src/ files so they are tracked by git; modifying them shows
      // individual file paths (" M src/db.ts") rather than an untracked directory ("?? src/").
      files: { 'src/db.ts': '// initial db\n', 'src/theme.ts': '// initial theme\n' },
    });

    await importRepoViaUi(tauriPage, repoPath);

    await createWorktreeViaUi(tauriPage, 'feature/data-layer');
    await createWorktreeViaUi(tauriPage, 'feature/ui-polish');

    const dataItem = tauriPage.locator(
      '[data-testid="worktree-item"][data-branch="feature/data-layer"]',
    );
    const uiItem = tauriPage.locator(
      '[data-testid="worktree-item"][data-branch="feature/ui-polish"]',
    );

    const dataPath =
      (await dataItem.getAttribute('data-path')) ??
      (() => {
        throw new Error('feature/data-layer worktree-item missing data-path');
      })();
    const uiPath =
      (await uiItem.getAttribute('data-path')) ??
      (() => {
        throw new Error('feature/ui-polish worktree-item missing data-path');
      })();
    const gitRoot = join(dirname(dirname(dataPath)), 'root');

    // --- Commit on data-layer ---
    writeRepoFile(dataPath, 'src/db.ts', '// data layer v1\n');

    await selectWorktreeViaUi(tauriPage, 'feature/data-layer');
    await openChangesTab(tauriPage);

    await tauriPage
      .locator('[data-testid="unstaged-file"][data-filepath="src/db.ts"]')
      .waitFor(DEFAULT_UI_TIMEOUT);

    await stageAndCommitViaUi(tauriPage, 'feat: add data layer module');

    // Git: data-layer has the commit, a clean tree, and the commit landed on the right branch.
    const dataHead = runGit(dataPath, ['rev-parse', 'HEAD']);
    const dataLog = runGit(dataPath, ['log', '--oneline', '-1']);
    expect(dataLog).toContain('feat: add data layer module');
    expect(runGit(dataPath, ['status', '--porcelain'])).toBe('');
    expect(runGit(dataPath, ['symbolic-ref', '--short', 'HEAD'])).toBe('feature/data-layer');
    expect(runGit(dataPath, ['rev-parse', 'refs/heads/feature/data-layer'])).toBe(dataHead);

    // --- Commit on ui-polish ---
    writeRepoFile(uiPath, 'src/theme.ts', '// ui theme v1\n');

    await selectWorktreeViaUi(tauriPage, 'feature/ui-polish');
    await openChangesTab(tauriPage);

    await tauriPage
      .locator('[data-testid="unstaged-file"][data-filepath="src/theme.ts"]')
      .waitFor(DEFAULT_UI_TIMEOUT);

    await stageAndCommitViaUi(tauriPage, 'feat: add ui theme module');

    // Git: ui-polish has its own commit, a clean tree, and the commit landed on the right branch.
    const uiHead = runGit(uiPath, ['rev-parse', 'HEAD']);
    const uiLog = runGit(uiPath, ['log', '--oneline', '-1']);
    expect(uiLog).toContain('feat: add ui theme module');
    expect(runGit(uiPath, ['status', '--porcelain'])).toBe('');
    expect(runGit(uiPath, ['symbolic-ref', '--short', 'HEAD'])).toBe('feature/ui-polish');
    expect(runGit(uiPath, ['rev-parse', 'refs/heads/feature/ui-polish'])).toBe(uiHead);

    // Git: the two HEAD commits are different (independent histories)
    expect(dataHead).not.toBe(uiHead);

    // Git config: worktree branches should not inherit a mismatched upstream.
    const gitConfig = runGit(gitRoot, ['config', '--local', '--list']);
    assertNoUpstreamConfig(gitConfig, 'feature/data-layer');
    assertNoUpstreamConfig(gitConfig, 'feature/ui-polish');

    // Commit metadata: author matches the configured git identity and timestamps are recent.
    const dataMeta = parseHeadMeta(dataPath);
    const uiMeta = parseHeadMeta(uiPath);
    const configuredAuthorName = process.env.GIT_AUTHOR_NAME
      ?? (runGit(dataPath, ['config', '--get', 'user.name'])
        || runGit(gitRoot, ['config', '--global', '--get', 'user.name']));
    const configuredAuthorEmail = process.env.GIT_AUTHOR_EMAIL
      ?? (runGit(dataPath, ['config', '--get', 'user.email'])
        || runGit(gitRoot, ['config', '--global', '--get', 'user.email']));
    const inheritedAuthorTs = parseGitDateEnv(process.env.GIT_AUTHOR_DATE);
    expect(dataMeta.authorName).toBe(configuredAuthorName);
    expect(dataMeta.authorEmail).toBe(configuredAuthorEmail);
    expect(uiMeta.authorName).toBe(configuredAuthorName);
    expect(uiMeta.authorEmail).toBe(configuredAuthorEmail);
    expect(dataMeta.commitTs).toBeGreaterThanOrEqual(testStartEpoch);
    expect(uiMeta.commitTs).toBeGreaterThanOrEqual(testStartEpoch);
    if (inheritedAuthorTs !== null) {
      expect(Math.abs(dataMeta.authorTs - inheritedAuthorTs)).toBeLessThanOrEqual(1);
      expect(Math.abs(uiMeta.authorTs - inheritedAuthorTs)).toBeLessThanOrEqual(1);
      expect(dataMeta.commitTs).toBeGreaterThanOrEqual(dataMeta.authorTs);
      expect(uiMeta.commitTs).toBeGreaterThanOrEqual(uiMeta.authorTs);
    } else {
      expect(dataMeta.authorTs).toBeGreaterThanOrEqual(testStartEpoch);
      expect(uiMeta.authorTs).toBeGreaterThanOrEqual(testStartEpoch);
      expect(Math.abs(dataMeta.commitTs - dataMeta.authorTs)).toBeLessThanOrEqual(1);
      expect(Math.abs(uiMeta.commitTs - uiMeta.authorTs)).toBeLessThanOrEqual(1);
    }
    expect(uiMeta.commitTs).toBeGreaterThanOrEqual(dataMeta.commitTs);

    // History tab: ui-polish commit appears in the graph on the active worktree
    await openHistoryTab(tauriPage);
    await tauriPage.waitForFunction(
      `Array.from(document.querySelectorAll('[data-testid="commit-row"]'))
        .some((r) => r.textContent?.includes('feat: add ui theme module'))`,
      DEFAULT_UI_TIMEOUT,
    );

    // SQLite (state.db): workspace meta remains intact after both commits
    const stateDbPath = join(dirname(dirname(dataPath)), '.sproutgit', 'state.db');
    const metaRows = querySqlite(
      stateDbPath,
      `SELECT value FROM meta WHERE key = 'workspace_path'`,
    );
    expect(metaRows.length).toBe(1);
    expect(metaRows[0]?.[0]).toContain('daily-commits-workspace');
  });

  // ---------------------------------------------------------------------------
  // Story 3: End of day — merge a bugfix, delete its worktree, leave feature intact
  // ---------------------------------------------------------------------------
  test('deletes a merged bugfix worktree and leaves the ongoing feature intact', async ({
    tauriPage,
  }) => {
    const repoPath = createTestRepo('daily-cleanup', {
      extraCommits: 2,
      // Pre-create src/ files so they are tracked; modifying src/safe-call.ts shows
      // " M src/safe-call.ts" not "?? src/safe-call.ts" in a new directory.
      files: {
        'src/app.ts': 'export const app = true;\n',
        'src/safe-call.ts': '// TODO: add null-safe wrapper\n',
      },
    });

    await importRepoViaUi(tauriPage, repoPath);

    await createWorktreeViaUi(tauriPage, 'bugfix/null-pointer');
    await createWorktreeViaUi(tauriPage, 'feature/new-dashboard');

    const bugfixItem = tauriPage.locator(
      '[data-testid="worktree-item"][data-branch="bugfix/null-pointer"]',
    );
    const featureItem = tauriPage.locator(
      '[data-testid="worktree-item"][data-branch="feature/new-dashboard"]',
    );

    const bugfixPath =
      (await bugfixItem.getAttribute('data-path')) ??
      (() => {
        throw new Error('bugfix/null-pointer worktree-item missing data-path');
      })();

    const gitRoot = join(dirname(dirname(bugfixPath)), 'root');

    // Commit the "fix" on the bugfix worktree
    writeRepoFile(bugfixPath, 'src/safe-call.ts', '// null-safe wrapper\n');
    await selectWorktreeViaUi(tauriPage, 'bugfix/null-pointer');
    await openChangesTab(tauriPage);

    await tauriPage
      .locator('[data-testid="unstaged-file"][data-filepath="src/safe-call.ts"]')
      .waitFor(DEFAULT_UI_TIMEOUT);

    await stageAndCommitViaUi(tauriPage, 'fix: null-safe call wrapper');

    const bugfixHead = runGit(bugfixPath, ['rev-parse', 'HEAD']);
    const bugfixLog = runGit(bugfixPath, ['log', '--oneline', '-1']);
    expect(bugfixLog).toContain('fix: null-safe call wrapper');
    expect(runGit(bugfixPath, ['status', '--porcelain'])).toBe('');

    // Terminal-side action: merge the bugfix into main from the protected root checkout.
    mergeNoFastForward(gitRoot, 'bugfix/null-pointer', 'merge: null-safe call wrapper', 98);
    const containingBranches = runGit(gitRoot, ['branch', '--contains', bugfixHead]);
    expect(containingBranches).toContain('main');

    // Delete the bugfix worktree via the UI after the external merge is done.
    await deleteWorktreeViaUi(tauriPage, 'bugfix/null-pointer');

    // UI: bugfix item is gone, feature item is still visible
    await expect(bugfixItem).not.toBeVisible();
    await expect(featureItem).toBeVisible();

    // Git: bugfix worktree no longer registered
    const worktreeListAfter = runGit(gitRoot, ['worktree', 'list', '--porcelain']);
    expect(worktreeListAfter).not.toContain('null-pointer');

    // Git: bugfix branch still exists (SproutGit removes the worktree dir and prunes the
    // worktree ref, but does NOT delete the branch — the commit remains reachable).
    const branchesAfter = runGit(gitRoot, ['branch']);
    expect(branchesAfter).toContain('bugfix/null-pointer');

    // Git: feature/new-dashboard worktree and branch still exist
    expect(worktreeListAfter).toContain('feature/new-dashboard');
    expect(branchesAfter).toContain('feature/new-dashboard');

    // Git: the fix commit hash still exists in the repo (reachable from main after a merge)
    // We verify it via git cat-file since the worktree dir was deleted.
    const catFile = runGit(gitRoot, ['cat-file', '-t', bugfixHead]);
    expect(catFile).toBe('commit');

    // SQLite (state.db): meta table still intact after worktree deletion
    const stateDbPath = join(dirname(dirname(bugfixPath)), '.sproutgit', 'state.db');
    const metaRows = querySqlite(
      stateDbPath,
      `SELECT value FROM meta WHERE key = 'workspace_path'`,
    );
    expect(metaRows.length).toBe(1);
    expect(metaRows[0]?.[0]).toContain('daily-cleanup-workspace');
  });

  // ---------------------------------------------------------------------------
  // Story 4: Automation — hooks run during daily worktree creation and persist run history
  // ---------------------------------------------------------------------------
  test('runs an after-create hook and records the run in sqlite', async ({ tauriPage }) => {
    const repoPath = createTestRepo('daily-hooks', { extraCommits: 1 });

    await importRepoViaUi(tauriPage, repoPath);

    const workspaceParent = dirname(dirname(repoPath));
    const workspacePath = join(workspaceParent, `${basename(repoPath)}-workspace`);
    const stateDbPath = join(workspacePath, '.sproutgit', 'state.db');
    const outputPath = join(workspacePath, '.sproutgit', 'hook-output', 'after-create.txt');
    const hookId = 'hook-daily-after-create';
    const now = Math.floor(Date.now() / 1000);
    const { shell, script } = dailyAfterCreateHook();

    executeSqlite(
      stateDbPath,
      [
        'INSERT INTO hook_definitions (',
        '  id, name, scope, trigger, shell, script, enabled, critical, timeout_seconds, created_at, updated_at',
        ') VALUES (',
        `  ${sqlString(hookId)},`,
        `  ${sqlString('Daily after-create hook')},`,
        `  ${sqlString('workspace')},`,
        `  ${sqlString('after_worktree_create')},`,
        `  ${sqlString(shell)},`,
        `  ${sqlString(script)},`,
        '  1,',
        '  0,',
        '  60,',
        `  ${now},`,
        `  ${now}`,
        ');',
      ].join('\n'),
    );

    await createWorktreeViaUi(tauriPage, 'feature/hook-smoke');
    await waitForFile(outputPath);

    const hookOutput = readFileSync(outputPath, 'utf8');
    expect(hookOutput).toContain('after_worktree_create|feature/hook-smoke|');

    const hookRows = querySqlite(
      stateDbPath,
      `SELECT trigger, status, worktree_path, error_message FROM hook_runs WHERE hook_id = ${sqlString(hookId)} ORDER BY started_at DESC LIMIT 1`,
    );
    expect(hookRows.length).toBe(1);
    expect(hookRows[0]?.[0]).toBe('after_worktree_create');
    expect(hookRows[0]?.[1]).toBe('success');
    expect(hookRows[0]?.[2]).toContain('feature-hook-smoke');
    expect(hookRows[0]?.[3] ?? '').toBe('');
  });
});
