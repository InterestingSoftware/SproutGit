import { gotoHash, goHome, createTestRepo, closeAndCleanup, monitorErrors, waitForToast } from '../helpers.js';

/**
 * A deterministic, cross-platform test agent. `sh`/`bash` aren't guaranteed on
 * the Windows E2E runner, so the agent command is `node` — every platform's
 * CI job runs `actions/setup-node` before the E2E step, and passing the
 * script via `-e` means there's no shell involved to quote/escape for
 * (the whole string is one argv entry, spawned directly by node-pty).
 * The agent prints SPROUTGIT_AGENT so the test can prove env injection
 * worked, then idles so the terminal tab / badge stay alive long enough to
 * assert on; each test explicitly kills its sessions afterwards (see
 * afterEach below) instead of relying on a fixed sleep duration.
 */
const TEST_AGENT_CONFIG = {
  command: 'node',
  args: ['-e', "console.log('AGENT=' + process.env.SPROUTGIT_AGENT); setInterval(() => {}, 1000);"],
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

/** Kill every live PTY session so a leftover agent process can't starve later specs. */
async function closeAllTerminals(): Promise<void> {
  await browser.executeAsync((done: (err?: string) => void) => {
    (window as unknown as { api: { closeAllTerminals: () => Promise<void> } })
      .api.closeAllTerminals()
      .then(() => done(), (e: unknown) => done(String(e)));
  });
}

describe('agent launch workflow', () => {
  let testRepo: string;

  beforeEach(async () => {
    testRepo = createTestRepo('agent-launch');
    await seedTestAgent();
  });

  afterEach(async () => {
    await closeAllTerminals();
    await closeAndCleanup(testRepo);
  });

  it('launches the configured agent as a labeled terminal tab with a live badge', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);

    await expect($('[data-testid="btn-launch-agent"]')).toBeDisplayed();
    await $('[data-testid="btn-launch-agent"]').click();

    await expect(
      $('[data-testid="terminal-session-tab"][data-session-label="AI Agent"]')
    ).toBeDisplayed();
    await expect($('[data-testid="agent-badge"]')).toBeDisplayed();

    await assertNoErrors();
  });

  it('injects the SPROUTGIT_AGENT env var into the launched session', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);

    await $('[data-testid="btn-launch-agent"]').click();
    await expect(
      $('[data-testid="terminal-session-tab"][data-session-label="AI Agent"]')
    ).toBeDisplayed();

    // Give the PTY a moment to run `echo` and flush its output to xterm's buffer.
    await browser.pause(800);

    // xterm.js renders to a <canvas>, so the DOM has no visible text — read
    // the scrollback buffer directly off the Terminal instance the component
    // stashes on its container (see TerminalPane.tsx: container.__xterm).
    const rendered = await browser.execute(() => {
      const container = document.querySelector('[data-testid="terminal-container"]') as
        (HTMLDivElement & { __xterm?: { buffer: { active: { length: number; getLine: (n: number) => { translateToString: (trim: boolean) => string } | undefined } } } }) | null;
      const term = container?.__xterm;
      if (!term) return '';
      const lines: string[] = [];
      for (let i = 0; i < term.buffer.active.length; i++) {
        lines.push(term.buffer.active.getLine(i)?.translateToString(true) ?? '');
      }
      return lines.join('\n');
    });
    expect(rendered).toContain('AGENT=agent');

    await assertNoErrors();
  });

  it('clears the agent badge once the session is closed', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);

    await $('[data-testid="btn-launch-agent"]').click();
    await expect($('[data-testid="agent-badge"]')).toBeDisplayed();

    await $('//button[@title="Close AI Agent"]').click();

    await expect($('[data-testid="agent-badge"]')).not.toBeDisplayed();
    await assertNoErrors();
  });
});

describe('agent settings', () => {
  let testRepo: string;

  beforeEach(async () => {
    testRepo = createTestRepo('agent-settings');
    await seedTestAgent();
  });

  afterEach(async () => {
    await closeAndCleanup(testRepo);
  });

  it('shows the configured agent command in the single agent row', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/settings?workspace=${encodeURIComponent(testRepo)}`);

    await expect($('[data-testid="agents-section"]')).toBeDisplayed();
    await expect($('[data-testid="agent-row"]')).toBeDisplayed();

    // Terminal mode is the only option for a non-Claude-Code command.
    await expect($('[data-testid="btn-agent-mode-integrated"]')).toBeDisabled();

    await assertNoErrors();
  });

  it('edits the agent command, saves it, and persists it across a reload', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/settings?workspace=${encodeURIComponent(testRepo)}`);

    await $('[data-testid="agent-row-btn-edit"]').click();
    const input = $('[data-testid="agent-row-input-custom"]');
    await input.setValue('my-custom-cli --flag');
    await $('[data-testid="agent-row-btn-save"]').click();
    await waitForToast('success');

    // Force a remount so the settings page re-fetches from the config DB,
    // proving the write actually round-tripped through IPC + SQLite.
    await goHome();
    await gotoHash(`/settings?workspace=${encodeURIComponent(testRepo)}`);

    const rowText = await $('[data-testid="agent-row"]').getText();
    expect(rowText).toContain('my-custom-cli');

    await assertNoErrors();
  });

  it('enables Integrated mode only when the command is recognized as Claude Code', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/settings?workspace=${encodeURIComponent(testRepo)}`);

    await $('[data-testid="agent-row-btn-edit"]').click();
    const input = $('[data-testid="agent-row-input-custom"]');
    await input.setValue('claude');
    await $('[data-testid="agent-row-btn-save"]').click();
    await waitForToast('success');

    await expect($('[data-testid="btn-agent-mode-integrated"]')).not.toBeDisabled();

    await assertNoErrors();
  });

  it('clicking Test against a resolvable but unrecognized agent command reports success without spawning a live prompt', async () => {
    // Only Claude Code's non-interactive prompt flag (-p) is known, so a
    // command not recognized as Claude Code (e.g. this `node` invocation)
    // is expected to resolve and stop there, rather than attempting a live
    // prompt spawn that would hang until AGENT_TEST's 15s timeout on a CLI
    // whose non-interactive flag isn't known (see AGENT_TEST's unit tests
    // in app/src/main/ipc/__tests__/agent-test.test.ts for the Claude-Code
    // path, which needs a real `claude` CLI this e2e environment doesn't have).
    const assertNoErrors = monitorErrors();
    await gotoHash(`/settings?workspace=${encodeURIComponent(testRepo)}`);

    await $('[data-testid="agent-row-btn-edit"]').click();
    const input = $('[data-testid="agent-row-input-custom"]');
    await input.setValue("node -e process.stdout.write('OK');process.exit(0)");
    await $('[data-testid="agent-row-btn-save"]').click();
    await waitForToast('success');

    await $('[data-testid="agent-row-btn-test"]').click();
    await waitForToast('success');

    await expect($('[data-testid="agent-row-test-result"]')).toBeDisplayed();
    const resultText = await $('[data-testid="agent-row-test-result"]').getText();
    expect(resultText).toContain('Test passed');
    expect(resultText).not.toContain('-p');

    await assertNoErrors();
  });

  it('clicking Test against an unresolvable agent command shows a fail result and an error toast', async () => {
    await gotoHash(`/settings?workspace=${encodeURIComponent(testRepo)}`);

    await $('[data-testid="agent-row-btn-edit"]').click();
    const input = $('[data-testid="agent-row-input-custom"]');
    await input.setValue('sproutgit-definitely-not-a-real-agent-binary-xyz');
    await $('[data-testid="agent-row-btn-save"]').click();
    await waitForToast('success');

    await $('[data-testid="agent-row-btn-test"]').click();
    await waitForToast('error');

    await expect($('[data-testid="agent-row-test-result"]')).toBeDisplayed();
    const resultText = await $('[data-testid="agent-row-test-result"]').getText();
    expect(resultText).toContain('Test failed');
    expect(resultText).toContain('Command not found on PATH');
  });
});
