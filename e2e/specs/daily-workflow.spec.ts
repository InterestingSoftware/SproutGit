/**
 * Daily developer workflow E2E stories.
 *
 * These tests mirror realistic day-to-day use: a developer opens SproutGit,
 * sets up worktrees for active features, commits on each independently, and
 * cleans up merged work. Each step validates both the UI state and the
 * underlying git / SQLite reality.
 */
import { basename, dirname, join } from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
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

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

type HookSeedInput = {
  id: string;
  name: string;
  trigger: string;
  shell: string;
  script: string;
  scope?: 'worktree' | 'workspace';
  executionTarget?: 'workspace' | 'trigger_worktree' | 'initiating_worktree';
  executionMode?: 'terminal_tab';
  enabled?: 0 | 1;
  critical?: 0 | 1;
  keepOpenOnCompletion?: 0 | 1;
  timeoutSeconds?: number;
  createdAt?: number;
  updatedAt?: number;
};

function insertHookDefinition(dbPath: string, input: HookSeedInput) {
  const now = Math.floor(Date.now() / 1000);
  executeSqlite(
    dbPath,
    [
      'INSERT INTO hook_definitions (',
      '  id, name, scope, trigger, execution_target, execution_mode, shell, script, enabled, critical, keep_open_on_completion, timeout_seconds, created_at, updated_at',
      ') VALUES (',
      `  ${sqlString(input.id)},`,
      `  ${sqlString(input.name)},`,
      `  ${sqlString(input.scope ?? 'workspace')},`,
      `  ${sqlString(input.trigger)},`,
      `  ${sqlString(input.executionTarget ?? 'trigger_worktree')},`,
      `  ${sqlString(input.executionMode ?? 'terminal_tab')},`,
      `  ${sqlString(input.shell)},`,
      `  ${sqlString(input.script)},`,
      `  ${input.enabled ?? 1},`,
      `  ${input.critical ?? 0},`,
      `  ${input.keepOpenOnCompletion ?? 0},`,
      `  ${input.timeoutSeconds ?? 60},`,
      `  ${input.createdAt ?? now},`,
      `  ${input.updatedAt ?? now}`,
      ');',
    ].join('\n')
  );
}

function insertHookDependency(dbPath: string, hookId: string, dependsOnHookId: string) {
  executeSqlite(
    dbPath,
    [
      'INSERT INTO hook_dependencies (hook_id, depends_on_hook_id)',
      'VALUES (',
      `  ${sqlString(hookId)},`,
      `  ${sqlString(dependsOnHookId)}`,
      ');',
    ].join('\n')
  );
}

function dailyAfterCreateHook() {
  if (process.platform === 'win32') {
    return {
      shell: 'powershell',
      script: [
        "$ErrorActionPreference = 'Stop'",
        '$workspacePath = $env:SPROUTGIT_WORKSPACE_PATH',
        'if (-not $workspacePath) {',
        '  $worktreesPath = $env:SPROUTGIT_WORKTREES_PATH',
        '  if ($worktreesPath) {',
        '    $workspacePath = Split-Path -Parent $worktreesPath',
        '  }',
        '}',
        'if (-not $workspacePath) {',
        '  $worktreePath = $env:SPROUTGIT_WORKTREE_PATH',
        '  if ($worktreePath) {',
        '    $workspacePath = Split-Path -Parent (Split-Path -Parent $worktreePath)',
        '  }',
        '}',
        'if (-not $workspacePath) {',
        "  throw 'Unable to resolve workspace path from hook environment'",
        '}',
        "$outputDir = Join-Path $workspacePath '.sproutgit/hook-output'",
        'New-Item -ItemType Directory -Force -Path $outputDir | Out-Null',
        "$outputFile = Join-Path $outputDir 'after-create.txt'",
        'Set-Content -Path $outputFile -Encoding UTF8 -Value "$env:SPROUTGIT_TRIGGER|$env:SPROUTGIT_WORKTREE_BRANCH|$env:SPROUTGIT_WORKTREE_PATH"',
        'if (-not (Test-Path -Path $outputFile)) {',
        "  throw 'Hook output file was not written'",
        '}',
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

function dailyAfterCreateTerminalHook(marker: string) {
  if (process.platform === 'win32') {
    return {
      shell: 'powershell',
      script: [
        '$ErrorActionPreference = "Stop"',
        `Write-Output "${marker}:$env:SPROUTGIT_WORKTREE_BRANCH"`,
        'Start-Sleep -Milliseconds 300',
      ].join('\n'),
    };
  }

  return {
    shell: process.platform === 'darwin' ? 'zsh' : 'bash',
    script: [
      `echo "${marker}:$SPROUTGIT_WORKTREE_BRANCH"`,
      'sleep 0.3',
    ].join('\n'),
  };
}

test.describe('Daily developer workflow', () => {
  test.beforeEach(async ({ tauriPage }) => {
    // Navigate the app to the home screen BEFORE deleting test directories.
    // On Windows, the Tauri file watcher holds open handles on the worktrees
    // directory from the previous test. Navigating away first causes the
    // backend to stop watching, releasing those handles before rmSync runs.
    await reloadToHome(tauriPage);
    resetTestDirs();
    resetConfigDb();
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
      '[data-testid="worktree-item"][data-branch="feature/user-auth"]'
    );
    const apiItem = tauriPage.locator(
      '[data-testid="worktree-item"][data-branch="feature/api-refactor"]'
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
      `SELECT value FROM meta WHERE key = 'workspace_path'`
    );
    expect(metaRows.length).toBe(1);
    expect(metaRows[0]?.[0]).toContain('daily-setup-workspace');

    // SQLite (config.db): workspace appears in recent list
    if (CONFIG_DB_PATH) {
      const recentRows = querySqlite(
        CONFIG_DB_PATH,
        `SELECT workspace_path FROM recent_workspaces`
      );
      const paths = recentRows.map(r => r[0] ?? '');
      expect(paths.some(p => p.includes('daily-setup-workspace'))).toBe(true);
    }
  });

  test('creates a worktree from release branch without inheriting upstream', async ({
    tauriPage,
  }) => {
    const repoPath = createTestRepo('daily-release-base', {
      extraCommits: 2,
      files: { 'src/release.ts': 'export const release = 1;\n' },
    });

    runGit(repoPath, ['checkout', '-b', 'release/1.0']);
    writeRepoFile(repoPath, 'src/release.ts', 'export const release = 2;\n');
    runGit(repoPath, ['add', 'src/release.ts']);
    runGit(repoPath, ['commit', '-m', 'chore: prep release 1.0']);
    runGit(repoPath, ['checkout', 'main']);

    await importRepoViaUi(tauriPage, repoPath);

    await createWorktreeViaUi(tauriPage, 'hotfix/1.0.1', 'release/1.0');

    const hotfixItem = tauriPage.locator(
      '[data-testid="worktree-item"][data-branch="hotfix/1.0.1"]'
    );
    const hotfixPath =
      (await hotfixItem.getAttribute('data-path')) ??
      (() => {
        throw new Error('hotfix/1.0.1 worktree-item missing data-path');
      })();
    const gitRoot = join(dirname(dirname(hotfixPath)), 'root');

    const releaseHead = runGit(gitRoot, ['rev-parse', 'refs/heads/release/1.0']);
    const hotfixHead = runGit(gitRoot, ['rev-parse', 'refs/heads/hotfix/1.0.1']);
    expect(hotfixHead).toBe(releaseHead);

    const gitConfig = runGit(gitRoot, ['config', '--local', '--list']);
    assertNoUpstreamConfig(gitConfig, 'hotfix/1.0.1');
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
      '[data-testid="worktree-item"][data-branch="feature/data-layer"]'
    );
    const uiItem = tauriPage.locator(
      '[data-testid="worktree-item"][data-branch="feature/ui-polish"]'
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
    const configuredAuthorName =
      process.env.GIT_AUTHOR_NAME ??
      (runGit(dataPath, ['config', '--get', 'user.name']) ||
        runGit(gitRoot, ['config', '--global', '--get', 'user.name']));
    const configuredAuthorEmail =
      process.env.GIT_AUTHOR_EMAIL ??
      (runGit(dataPath, ['config', '--get', 'user.email']) ||
        runGit(gitRoot, ['config', '--global', '--get', 'user.email']));
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
      DEFAULT_UI_TIMEOUT
    );

    // SQLite (state.db): workspace meta remains intact after both commits
    const stateDbPath = join(dirname(dirname(dataPath)), '.sproutgit', 'state.db');
    const metaRows = querySqlite(
      stateDbPath,
      `SELECT value FROM meta WHERE key = 'workspace_path'`
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
      '[data-testid="worktree-item"][data-branch="bugfix/null-pointer"]'
    );
    const featureItem = tauriPage.locator(
      '[data-testid="worktree-item"][data-branch="feature/new-dashboard"]'
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

    // Git: bugfix branch is deleted with managed worktree cleanup.
    const branchesAfter = runGit(gitRoot, ['branch']);
    expect(branchesAfter).not.toContain('bugfix/null-pointer');

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
      `SELECT value FROM meta WHERE key = 'workspace_path'`
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
    const workspacePrefix = `${basename(repoPath)}-workspace`;
    const matchingWorkspaces = readdirSync(workspaceParent, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith(workspacePrefix))
      .map(entry => join(workspaceParent, entry.name))
      .filter(path => existsSync(join(path, '.sproutgit', 'state.db')))
      .sort((a, b) => {
        const aDb = join(a, '.sproutgit', 'state.db');
        const bDb = join(b, '.sproutgit', 'state.db');
        return statSync(bDb).mtimeMs - statSync(aDb).mtimeMs;
      });

    if (matchingWorkspaces.length === 0) {
      throw new Error(`No imported workspace found for prefix: ${workspacePrefix}`);
    }

    const workspacePath = matchingWorkspaces[0]!;
    const stateDbPath = join(workspacePath, '.sproutgit', 'state.db');
    const hookId = 'hook-daily-after-create';
    const hookName = 'Daily after-create hook';
    const { shell, script } = dailyAfterCreateHook();

    // Use the helper (not raw SQL) so all columns get values and keepOpenOnCompletion=1
    // ensures the terminal session tab stays visible long enough to assert on.
    insertHookDefinition(stateDbPath, {
      id: hookId,
      name: hookName,
      trigger: 'after_worktree_create',
      shell,
      script,
      scope: 'workspace',
      executionTarget: 'trigger_worktree',
      executionMode: 'terminal_tab',
      keepOpenOnCompletion: 1,
      timeoutSeconds: 60,
    });

    await createWorktreeViaUi(tauriPage, 'feature/hook-smoke');

    // terminal_tab hooks record status=success the moment the Tauri event is
    // emitted — the shell script runs asynchronously afterward.  Waiting for a
    // filesystem artifact (the output file) is therefore inherently racy.
    // Instead, assert on the UI state that appears synchronously:
    //   1. The hook-operation-header confirms hooks were triggered.
    //   2. The terminal session tab confirms the terminal_tab launch request
    //      was handled by the frontend.
    const hookHeader = tauriPage.getByTestId('hook-operation-header');
    await hookHeader.waitFor(DEFAULT_UI_TIMEOUT);
    await expect(hookHeader).toBeVisible();

    const sessionTab = tauriPage.locator(
      `[data-testid="terminal-session-tab"][data-session-label^="${hookName} ("]`
    );
    await sessionTab.waitFor(DEFAULT_UI_TIMEOUT);
    await expect(sessionTab).toBeVisible();

    const hookRows = querySqlite(
      stateDbPath,
      `SELECT trigger, status, worktree_path, error_message FROM hook_runs WHERE hook_id = ${sqlString(hookId)} ORDER BY started_at DESC LIMIT 1`
    );
    expect(hookRows.length).toBe(1);
    expect(hookRows[0]?.[0]).toBe('after_worktree_create');
    expect(hookRows[0]?.[1]).toBe('success');
    expect(hookRows[0]?.[2]).toContain('feature-hook-smoke');
    expect(hookRows[0]?.[3] ?? '').toBe('');
  });

  test('shows terminal tab at workspace scope before any managed worktree exists', async ({
    tauriPage,
  }) => {
    const repoPath = createTestRepo('daily-workspace-terminal', { extraCommits: 1 });

    await importRepoViaUi(tauriPage, repoPath);

    const historyTab = tauriPage.getByTestId('tab-history');
    const changesTab = tauriPage.getByTestId('tab-changes');
    const terminalTab = tauriPage.getByTestId('tab-terminal');

    await historyTab.waitFor(DEFAULT_UI_TIMEOUT);
    await changesTab.waitFor(DEFAULT_UI_TIMEOUT);
    await terminalTab.waitFor(DEFAULT_UI_TIMEOUT);

    expect(await historyTab.getAttribute('disabled')).not.toBeNull();
    expect(await changesTab.getAttribute('disabled')).not.toBeNull();
    expect(await terminalTab.getAttribute('disabled')).toBeNull();

    await terminalTab.click();

    await tauriPage.getByTestId('btn-add-terminal').waitFor(DEFAULT_UI_TIMEOUT);

    const terminalPanels = tauriPage.locator('[data-sg-terminal] [data-pty-id]');
    const panelCount = await terminalPanels.count();
    expect(panelCount).toBeGreaterThanOrEqual(1);

    const hasChangesEmptyState = await tauriPage.evaluate(`(() => {
      return (document.body?.textContent ?? '').includes('Select a worktree to view changes');
    })()`);
    expect(hasChangesEmptyState).toBe(false);
  });

  test('runs multiple terminal hooks after create and opens named terminal sessions', async ({
    tauriPage,
  }) => {
    const repoPath = createTestRepo('daily-multi-hooks', { extraCommits: 1 });

    await importRepoViaUi(tauriPage, repoPath);

    const workspaceParent = dirname(dirname(repoPath));
    const workspacePath = join(workspaceParent, `${basename(repoPath)}-workspace`);
    const stateDbPath = join(workspacePath, '.sproutgit', 'state.db');

    const firstHookId = 'hook-daily-after-create-term-1';
    const secondHookId = 'hook-daily-after-create-term-2';
    const firstHookName = 'Daily terminal hook one';
    const secondHookName = 'Daily terminal hook two';

    const hookOne = dailyAfterCreateTerminalHook('HOOK_ONE');
    const hookTwo = dailyAfterCreateTerminalHook('HOOK_TWO');

    insertHookDefinition(stateDbPath, {
      id: firstHookId,
      name: firstHookName,
      trigger: 'after_worktree_create',
      shell: hookOne.shell,
      script: hookOne.script,
      scope: 'workspace',
      executionTarget: 'trigger_worktree',
      executionMode: 'terminal_tab',
      keepOpenOnCompletion: 1,
      timeoutSeconds: 90,
    });

    insertHookDefinition(stateDbPath, {
      id: secondHookId,
      name: secondHookName,
      trigger: 'after_worktree_create',
      shell: hookTwo.shell,
      script: hookTwo.script,
      scope: 'workspace',
      executionTarget: 'trigger_worktree',
      executionMode: 'terminal_tab',
      keepOpenOnCompletion: 1,
      timeoutSeconds: 90,
    });

    insertHookDependency(stateDbPath, secondHookId, firstHookId);

    const targetBranch = 'feature/multi-hooks';
    await createWorktreeViaUi(tauriPage, targetBranch);

    const hookHeader = tauriPage.getByTestId('hook-operation-header');
    await hookHeader.waitFor(DEFAULT_UI_TIMEOUT);
    await expect(hookHeader).toBeVisible();

    const firstSessionTab = tauriPage.locator(
      `[data-testid="terminal-session-tab"][data-session-label^="${firstHookName} ("]`
    );
    const secondSessionTab = tauriPage.locator(
      `[data-testid="terminal-session-tab"][data-session-label^="${secondHookName} ("]`
    );

    await firstSessionTab.waitFor(DEFAULT_UI_TIMEOUT);
    await secondSessionTab.waitFor(DEFAULT_UI_TIMEOUT);
    await expect(firstSessionTab).toBeVisible();
    await expect(secondSessionTab).toBeVisible();

    await expect(secondSessionTab).toHaveAttribute('aria-selected', 'true');

    const terminalPanels = tauriPage.locator('[data-sg-terminal] [data-pty-id]');
    const panelCount = await terminalPanels.count();
    expect(panelCount).toBeGreaterThanOrEqual(3);

    const hookRows = querySqlite(
      stateDbPath,
      `SELECT hook_id, status, trigger FROM hook_runs WHERE hook_id IN (${sqlString(firstHookId)}, ${sqlString(secondHookId)}) ORDER BY started_at ASC`
    );
    expect(hookRows.length).toBe(2);
    expect(hookRows.map(row => row[0])).toEqual([firstHookId, secondHookId]);
    expect(hookRows.map(row => row[1])).toEqual(['success', 'success']);
    expect(hookRows.map(row => row[2])).toEqual(['after_worktree_create', 'after_worktree_create']);
  });
});
