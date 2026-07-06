/**
 * Demo GIF spec — drives the real Electron app through the core pitch
 * (create worktrees, launch parallel agent sessions, review a diff, merge)
 * while capturing a numbered sequence of screenshots. The frames are later
 * stitched into a GIF by `scripts/build-demo-gif.sh` (ffmpeg).
 *
 * Agent sessions are simulated: the configured "agent" is a short Node
 * script (see `agentScript()`) that prints a canned, per-worktree transcript
 * based on the `SPROUTGIT_WORKTREE_NAME` env var the app injects when
 * launching an agent — no real coding-agent CLI is required to produce a
 * plausible-looking terminal session.
 *
 * ─── How to run ──────────────────────────────────────────────────────────────
 *   CAPTURE_SCREENSHOTS=1 SCREENSHOT_TARGET=../e2e/test-results/demo-gif-frames \
 *     npx wdio run wdio.conf.ts --spec specs/demo-gif.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { rmWithRetry } from '../helpers.js';
import { captureNamedScreenshot, forceTheme } from '../helpers/screenshots.js';

const UI_TIMEOUT = 20_000;

// ── Git helpers (same pattern as hero-screenshots.spec.ts) ────────────────────

const BASE_GIT_ENV = {
  GIT_AUTHOR_NAME: 'SproutGit Test',
  GIT_AUTHOR_EMAIL: 'test@sproutgit.test',
  GIT_COMMITTER_NAME: 'SproutGit Test',
  GIT_COMMITTER_EMAIL: 'test@sproutgit.test',
  GIT_TERMINAL_PROMPT: '0',
};

function gitEnv(sequence: number) {
  const daysAgo = 20 * (1 - sequence / 10);
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  d.setHours(9 + (sequence % 8), (sequence * 7) % 60, 0, 0);
  const iso = d.toISOString();
  return { ...BASE_GIT_ENV, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso };
}

function runGit(cwd: string, args: string[], env: Record<string, string> = {}) {
  const clean = { ...process.env };
  delete clean['GIT_DIR'];
  delete clean['GIT_WORK_TREE'];
  delete clean['GIT_INDEX_FILE'];
  delete clean['GIT_COMMON_DIR'];
  const result = spawnSync('git', args, {
    cwd,
    env: { ...clean, ...BASE_GIT_ENV, ...env },
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr || result.error?.message || '(no output)'}`);
  }
}

function writeFile(repoPath: string, relativePath: string, content: string) {
  const abs = join(repoPath, relativePath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function commitAll(repoPath: string, message: string, seq: number) {
  runGit(repoPath, ['add', '--all'], gitEnv(seq));
  runGit(repoPath, ['commit', '-m', message], gitEnv(seq));
}

function mergeNoFf(repoPath: string, ref: string, message: string, seq: number) {
  runGit(repoPath, ['merge', '--no-ff', ref, '-m', message], gitEnv(seq));
}

/** A small but non-trivial repo: a couple of base commits plus one already-merged feature. */
function createDemoRepo(): string {
  const repoPath = mkdtempSync(join(tmpdir(), 'sg-demo-repo-'));
  runGit(repoPath, ['init', '-b', 'main']);
  runGit(repoPath, ['config', 'user.email', 'test@sproutgit.test']);
  runGit(repoPath, ['config', 'user.name', 'SproutGit Test']);

  writeFile(repoPath, 'README.md', '# Axiom\n\nA modern TypeScript application framework.\n');
  writeFile(repoPath, 'src/index.ts', 'export { createApp } from "./app";\n');
  writeFile(repoPath, 'src/app.ts', 'export function createApp() { return { version: "0.1.0" }; }\n');
  writeFile(repoPath, 'src/auth/index.ts', 'export { authenticate } from "./jwt";\n');
  writeFile(repoPath, 'src/auth/jwt.ts', 'export function authenticate(token: string) { return !!token; }\n');
  writeFile(repoPath, 'src/ui/dashboard.tsx', 'export function Dashboard() { return <div>Dashboard</div>; }\n');
  writeFile(repoPath, 'src/ui/components/MetricsPanel.tsx', 'export function MetricsPanel() { return <div className="metrics" />; }\n');
  writeFile(repoPath, 'src/notifications/index.ts', 'export function notify(msg: string) { console.log(msg); }\n');
  commitAll(repoPath, 'Initial commit', 0);
  writeFile(repoPath, 'package.json', '{"name":"axiom","version":"0.1.0","private":true}\n');
  commitAll(repoPath, 'Add project scaffolding', 1);

  runGit(repoPath, ['checkout', '-b', 'feature/onboarding']);
  writeFile(repoPath, 'src/onboarding.ts', 'export function onboard() { return "welcome"; }\n');
  commitAll(repoPath, 'feat: add onboarding flow', 2);
  runGit(repoPath, ['checkout', 'main']);
  mergeNoFf(repoPath, 'feature/onboarding', 'Merge feature/onboarding', 3);

  return repoPath;
}

// ── Simulated agent ───────────────────────────────────────────────────────────

const AGENT_TRANSCRIPTS: Record<string, string[]> = {
  'auth-refresh': [
    '> Reading src/auth/jwt.ts',
    '> Legacy token check has no refresh support',
    '> Editing src/auth/jwt.ts',
    '+ export function refreshToken(token: string): string { ... }',
    '> Running: pnpm vitest run auth',
    '  ✓ validates JWT (8ms)',
    '  ✓ refreshes an expiring token (5ms)',
    '✓ 2 tests passed — ready for review',
  ],
  'dashboard-polish': [
    '> Reading src/ui/dashboard.tsx',
    '> Dashboard has no responsive layout below 768px',
    '> Editing src/ui/dashboard.tsx',
    '+ <div className="dashboard grid gap-4 md:grid-cols-2">',
    '> Running: pnpm vitest run dashboard',
    '  ✓ renders metrics on mobile viewport (11ms)',
    '✓ 1 test passed — ready for review',
  ],
  'notif-batching': [
    '> Reading src/notifications/index.ts',
    '> Notifications sent individually — batching opportunity',
    '> Editing src/notifications/index.ts',
    '+ export function notifyBatch(msgs: string[]) { ... }',
    '> Running: pnpm vitest run notifications',
    '  ✓ batches notifications within 200ms window (6ms)',
    '✓ 1 test passed — ready for review',
  ],
};

/** Node script (spawned via `node -e`) that prints a canned per-worktree transcript, then idles. */
function agentScript(): string {
  return `
    const transcripts = ${JSON.stringify(AGENT_TRANSCRIPTS)};
    const name = process.env.SPROUTGIT_WORKTREE_NAME || '';
    const lines = transcripts[name] || ['> Working...', '> Done.'];
    let i = 0;
    (function next() {
      if (i < lines.length) { console.log(lines[i]); i++; setTimeout(next, 550); }
      else { setInterval(() => {}, 1000); }
    })();
  `;
}

const TEST_AGENT_CONFIG = {
  command: 'node',
  args: ['-e', agentScript()],
  mode: 'terminal' as const,
};

async function seedTestAgent(): Promise<void> {
  await browser.executeAsync(
    (config: unknown, done: (err?: string) => void) => {
      (window as unknown as { api: { saveAgentConfig: (c: unknown) => Promise<void> } })
        .api.saveAgentConfig(config)
        .then(() => done(), (e: unknown) => done(String(e)));
    },
    TEST_AGENT_CONFIG
  );
}

async function closeAllTerminals(): Promise<void> {
  await browser.executeAsync((done: (err?: string) => void) => {
    (window as unknown as { api: { closeAllTerminals: () => Promise<void> } })
      .api.closeAllTerminals()
      .then(() => done(), (e: unknown) => done(String(e)));
  });
}

// ── UI helpers ────────────────────────────────────────────────────────────────

async function openWorkspace(repoPath: string): Promise<void> {
  await browser.execute((p: string) => { window.location.hash = `/workspace?path=${encodeURIComponent(p)}`; }, repoPath);
  await browser.pause(200);
  await $('//*[contains(@class,"sg-tab") and contains(.,"Graph")]').waitForDisplayed({ timeout: UI_TIMEOUT });
}

async function openTab(label: 'Graph' | 'Changes' | 'Terminal'): Promise<void> {
  const tab = $(`//*[contains(@class,"sg-tab") and contains(.,"${label}")]`);
  await tab.waitForDisplayed({ timeout: UI_TIMEOUT });
  await tab.click();
}

async function frame(name: string, holdMs = 0): Promise<void> {
  if (holdMs > 0) await browser.pause(holdMs);
  await captureNamedScreenshot(`demo/${name}`);
}

async function createWorktreeViaUi(branch: string): Promise<void> {
  await $('[data-testid="btn-open-create-worktree"]').click();
  const input = $('[data-testid="input-new-branch"]');
  await input.waitForDisplayed({ timeout: UI_TIMEOUT });
  await input.setValue(branch);
  await $('[data-testid="btn-create-worktree"]').click();
  await $(`[data-testid="worktree-item"][data-branch="${branch}"]`).waitForDisplayed({ timeout: UI_TIMEOUT });
}

async function switchToWorktree(branch: string): Promise<void> {
  await $(`[data-testid="worktree-item"][data-branch="${branch}"]`).click();
  await browser.pause(150);
}

async function launchAgentForActiveWorktree(branch: string): Promise<void> {
  await $(`[data-testid="worktree-item"][data-branch="${branch}"] [data-testid="btn-launch-agent"]`).click();
  await $('[data-testid="terminal-session-tab"][data-session-label="AI Agent"]').waitForDisplayed({ timeout: UI_TIMEOUT });
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Demo GIF frame capture @demo-gif', () => {
  before(function () {
    if (!process.env['CAPTURE_SCREENSHOTS']) {
      this.skip();
    }
  });

  let repoPath: string;

  before(async () => {
    repoPath = createDemoRepo();
    await seedTestAgent();
  });

  after(async () => {
    await closeAllTerminals();
    if (repoPath) await rmWithRetry(repoPath);
  });

  it('captures the parallel-worktrees + agents + diff-review + merge story', async function () {
    await openWorkspace(repoPath);
    await forceTheme('light');

    // ── Beat 1: the starting point — a single worktree, real history ─────────
    await openTab('Graph');
    await $('[data-testid^="commit-row-"]').waitForDisplayed({ timeout: UI_TIMEOUT });
    await frame('01-graph-initial', 400);

    // ── Beat 2: spin up three worktrees for three parallel tasks ─────────────
    await $('[data-testid="btn-open-create-worktree"]').click();
    await $('[data-testid="input-new-branch"]').waitForDisplayed({ timeout: UI_TIMEOUT });
    await frame('02-new-worktree-dialog', 250);
    await $('[data-testid="input-new-branch"]').setValue('auth-refresh');
    await frame('03-new-worktree-typed', 200);
    await $('[data-testid="btn-create-worktree"]').click();
    await $('[data-testid="worktree-item"][data-branch="auth-refresh"]').waitForDisplayed({ timeout: UI_TIMEOUT });
    await frame('04-worktree-auth-created', 300);

    await createWorktreeViaUi('dashboard-polish');
    await frame('05-worktree-dashboard-created', 300);

    await createWorktreeViaUi('notif-batching');
    await frame('06-worktree-notif-created', 400);

    // ── Beat 3: launch a parallel agent session in each worktree ─────────────
    await switchToWorktree('auth-refresh');
    await launchAgentForActiveWorktree('auth-refresh');
    await frame('07-agent-auth-start', 700);
    await frame('08-agent-auth-progress', 1400);

    await switchToWorktree('dashboard-polish');
    await launchAgentForActiveWorktree('dashboard-polish');
    await frame('09-agent-dashboard-start', 700);
    await frame('10-agent-dashboard-progress', 1400);

    await switchToWorktree('notif-batching');
    await launchAgentForActiveWorktree('notif-batching');
    await frame('11-agent-notif-progress', 1600);

    // ── Beat 4: the payoff shot — three agents live at once ───────────────────
    await openTab('Graph');
    await frame('12-three-agents-parallel', 400);

    // ── Beat 5: review a diff from one of the finished sessions ──────────────
    const authWtPath = join(repoPath, '.sproutgit', 'worktrees', 'auth-refresh');
    writeFile(
      authWtPath,
      'src/auth/jwt.ts',
      'export function authenticate(token: string) { return !!token; }\n' +
        'export function refreshToken(token: string): string {\n  return token;\n}\n'
    );
    await switchToWorktree('auth-refresh');
    await openTab('Changes');
    const unstagedRow = $('[data-testid="staging-unstaged-file-row"]');
    await unstagedRow.waitForDisplayed({ timeout: UI_TIMEOUT });
    await unstagedRow.click();
    await frame('13-diff-review', 600);

    // ── Beat 6: land the finished work — commit + merge two of the three ─────
    const authPath = join(repoPath, '.sproutgit', 'worktrees', 'auth-refresh');
    const dashboardPath = join(repoPath, '.sproutgit', 'worktrees', 'dashboard-polish');
    commitAll(authPath, 'feat(auth): add refresh token support', 6);
    writeFile(dashboardPath, 'src/ui/dashboard.tsx',
      'export function Dashboard() {\n  return <div className="dashboard grid gap-4 md:grid-cols-2"><MetricsPanel /></div>;\n}\n');
    commitAll(dashboardPath, 'feat(ui): responsive dashboard layout', 7);
    // Opening a plain repo as a workspace migrates it into SproutGit's
    // managed layout (`.sproutgit/root` bare repo + per-branch worktrees) —
    // `main` becomes a worktree in its own right rather than living at
    // `repoPath` itself, so that's where the merge must run.
    const mainWtPath = join(repoPath, '.sproutgit', 'worktrees', 'main');
    mergeNoFf(mainWtPath, 'auth-refresh', 'Merge auth-refresh', 8);
    mergeNoFf(mainWtPath, 'dashboard-polish', 'Merge dashboard-polish', 9);

    await closeAllTerminals();
    await openWorkspace(repoPath);
    await $('[title="Refresh"]').click();
    await openTab('Graph');
    await $('[data-testid^="commit-row-"]').waitForDisplayed({ timeout: UI_TIMEOUT });
    await frame('14-graph-merged', 500);
    await frame('15-graph-merged-hold', 900);
  });
});
