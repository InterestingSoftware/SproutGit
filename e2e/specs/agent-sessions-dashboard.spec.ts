import { gotoHash, createTestRepo, closeAndCleanup, monitorErrors } from '../helpers.js';

/**
 * Same deterministic, cross-platform test agent as agent-workflow.spec.ts —
 * `node -e` needs no shell to quote/escape for, and idles so the session
 * stays alive long enough to assert on. See that file for the full rationale.
 */
const TEST_AGENT_ROSTER = {
  agents: [{
    id: 'e2e-test-agent',
    name: 'node',
    command: 'node',
    args: ['-e', "console.log('AGENT=' + process.env.SPROUTGIT_AGENT); setInterval(() => {}, 1000);"],
    env: {},
    mode: 'terminal' as const,
    acp: false,
  }],
  defaultAgentId: 'e2e-test-agent',
};

async function seedTestAgent(): Promise<void> {
  await browser.executeAsync(
    (roster: unknown, done: (err?: string) => void) => {
      (window as unknown as { api: { saveAgentRoster: (r: unknown) => Promise<void> } })
        .api.saveAgentRoster(roster)
        .then(() => done(), (e: unknown) => done(String(e)));
    },
    TEST_AGENT_ROSTER
  );
}

/** Kill every live PTY session so a leftover agent process can't starve later specs. */
async function closeAllTerminals(): Promise<void> {
  await browser.executeAsync((done: (err?: string) => void) => {
    (window as unknown as { api: { closeAllTerminals: () => Promise<void> } })
      .api.closeAllTerminals()
      .then(() => done(), (e: unknown) => done(String(e)));
  });
}

async function createWorktree(branchName: string): Promise<void> {
  await $('[data-testid="btn-open-create-worktree"]').click();
  await expect($('[data-testid="input-new-branch"]')).toBeDisplayed();
  await $('[data-testid="input-new-branch"]').setValue(branchName);
  await $('[data-testid="btn-create-worktree"]').click();
  await expect($(`[data-testid="worktree-item"][data-branch="${branchName}"]`)).toBeDisplayed();
}

describe('agent sessions dashboard', () => {
  let testRepo: string;

  beforeEach(async () => {
    testRepo = createTestRepo('agent-sessions-dashboard');
    await seedTestAgent();
  });

  afterEach(async () => {
    await closeAllTerminals();
    await closeAndCleanup(testRepo);
  });

  it('shows an empty state when no agent sessions are running', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);

    await $('[data-testid="btn-agent-sessions"]').click();
    await expect($('[data-testid="agent-sessions-panel"]')).toBeDisplayed();
    await expect($('[data-testid="agent-sessions-count"]')).toHaveText('0');
    await expect($('[data-testid="agent-session-row"]')).not.toBeDisplayed();

    await assertNoErrors();
  });

  it('lists a running agent session with its worktree, agent name, and elapsed time, and jumps to its terminal', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);

    const activeBranch = await $('[data-testid="worktree-item"][data-active="true"]').getAttribute('data-branch');

    await $('[data-testid="btn-launch-agent"]').click();
    await expect($('[data-testid="agent-badge"]')).toBeDisplayed();

    // Switch away from the Terminal tab so the jump action below has to prove
    // it actually navigates there, rather than the tab already being active.
    await $('//*[contains(@class,"sg-tab") and contains(.,"Graph")]').click();

    await $('[data-testid="btn-agent-sessions"]').click();
    await expect($('[data-testid="agent-sessions-panel"]')).toBeDisplayed();
    await expect($('[data-testid="agent-sessions-count"]')).toHaveText('1');

    const row = $('[data-testid="agent-session-row"]');
    await expect(row).toBeDisplayed();
    const rowText = await row.getText();
    expect(rowText).toContain(activeBranch);
    expect(rowText).toContain('node');

    await row.$('[data-testid="btn-jump-to-session"]').click();

    // Panel closes and the terminal tab for the agent session is now focused.
    await expect($('[data-testid="agent-sessions-panel"]')).not.toBeDisplayed();
    await expect(
      $('[data-testid="terminal-session-tab"][data-session-label="AI Agent"][aria-selected="true"]')
    ).toBeDisplayed();

    await assertNoErrors();
  });

  it('lists sessions from every worktree and jumps between them', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);

    const firstBranch = await $('[data-testid="worktree-item"][data-active="true"]').getAttribute('data-branch');
    await $('[data-testid="btn-launch-agent"]').click();
    await expect($('[data-testid="agent-badge"]')).toBeDisplayed();

    const secondBranch = 'feature-dashboard';
    await createWorktree(secondBranch);
    await $(`[data-testid="worktree-item"][data-branch="${secondBranch}"]`).click();
    await $('[data-testid="btn-launch-agent"]').click();
    await expect($('[data-testid="agent-badge"]')).toBeDisplayed();

    await $('[data-testid="btn-agent-sessions"]').click();
    await expect($('[data-testid="agent-sessions-count"]')).toHaveText('2');
    const rows = await $$('[data-testid="agent-session-row"]');
    expect(rows).toHaveLength(2);

    // Jump back to the first worktree's session while the second is active.
    const firstRow = await (async () => {
      for (const el of rows) {
        if ((await el.getText()).includes(firstBranch)) return el;
      }
      throw new Error(`No session row found for worktree ${firstBranch}`);
    })();
    await firstRow.$('[data-testid="btn-jump-to-session"]').click();

    await expect($(`[data-testid="worktree-item"][data-branch="${firstBranch}"][data-active="true"]`)).toBeDisplayed();
    await expect(
      $('[data-testid="terminal-session-tab"][data-session-label="AI Agent"][aria-selected="true"]')
    ).toBeDisplayed();

    await assertNoErrors();
  });
});
