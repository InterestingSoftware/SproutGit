import { gotoHash, goHome, createTestRepo, closeAndCleanup, monitorErrors, waitForToast } from '../helpers.js';

/**
 * Deterministic, cross-platform test agents. `sh`/`bash` aren't guaranteed on
 * the Windows E2E runner, so the agent command is `node` — every platform's
 * CI job runs `actions/setup-node` before the E2E step, and passing the
 * script via `-e` means there's no shell involved to quote/escape for
 * (the whole string is one argv entry, spawned directly by node-pty).
 * The default agent prints SPROUTGIT_AGENT so the test can prove env
 * injection worked, then idles so the terminal tab / badge stay alive long
 * enough to assert on; each test explicitly kills its sessions afterwards
 * (see afterEach below) instead of relying on a fixed sleep duration.
 */
const TEST_AGENTS = {
  agents: [
    {
      id: 'test-default-agent',
      name: 'Test Default Agent',
      command: 'node',
      args: ['-e', "console.log('AGENT=' + process.env.SPROUTGIT_AGENT); setInterval(() => {}, 1000);"],
    },
    {
      id: 'test-alt-agent',
      name: 'Test Alt Agent',
      command: 'node',
      args: ['-e', 'setInterval(() => {}, 1000);'],
    },
  ],
  defaultAgentId: 'test-default-agent',
};

async function seedTestAgents(): Promise<void> {
  await browser.executeAsync(
    (roster: unknown, done: (err?: string) => void) => {
      (window as unknown as { api: { saveAgents: (r: unknown) => Promise<void> } })
        .api.saveAgents(roster)
        .then(() => done(), (e: unknown) => done(String(e)));
    },
    TEST_AGENTS
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
    await seedTestAgents();
  });

  afterEach(async () => {
    await closeAllTerminals();
    await closeAndCleanup(testRepo);
  });

  it('launches the default agent as a labeled terminal tab with a live badge', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);

    await expect($('[data-testid="btn-launch-agent"]')).toBeDisplayed();
    await $('[data-testid="btn-launch-agent"]').click();

    await expect(
      $('[data-testid="terminal-session-tab"][data-session-label="Test Default Agent"]')
    ).toBeDisplayed();
    await expect($('[data-testid="agent-badge"]')).toBeDisplayed();

    await assertNoErrors();
  });

  it('injects the SPROUTGIT_AGENT env var into the launched session', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);

    await $('[data-testid="btn-launch-agent"]').click();
    await expect(
      $('[data-testid="terminal-session-tab"][data-session-label="Test Default Agent"]')
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
    expect(rendered).toContain('AGENT=test-default-agent');

    await assertNoErrors();
  });

  it('launches a non-default agent via the picker menu', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);

    await expect($('[data-testid="btn-launch-agent-picker"]')).toBeDisplayed();
    await $('[data-testid="btn-launch-agent-picker"]').click();

    await expect($('[data-testid="context-menu"]')).toBeDisplayed();
    await $('[data-testid="context-menu"]')
      .$('.//button[contains(.,"Test Alt Agent")]')
      .click();

    await expect(
      $('[data-testid="terminal-session-tab"][data-session-label="Test Alt Agent"]')
    ).toBeDisplayed();

    await assertNoErrors();
  });

  it('clears the agent badge once the session is closed', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);

    await $('[data-testid="btn-launch-agent"]').click();
    await expect($('[data-testid="agent-badge"]')).toBeDisplayed();

    await $('//button[@title="Close Test Default Agent"]').click();

    await expect($('[data-testid="agent-badge"]')).not.toBeDisplayed();
    await assertNoErrors();
  });
});

describe('agent settings', () => {
  let testRepo: string;

  beforeEach(async () => {
    testRepo = createTestRepo('agent-settings');
    await seedTestAgents();
  });

  afterEach(async () => {
    await closeAndCleanup(testRepo);
  });

  it('lists the configured agents with the default marked', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/settings?workspace=${encodeURIComponent(testRepo)}`);

    await expect($('[data-testid="agents-section"]')).toBeDisplayed();
    const rows = await $$('[data-testid="agent-row"]');
    expect(rows.length).toBe(2);

    const names = await $$('[data-testid="input-agent-name"]');
    expect(await names[0]?.getValue()).toBe('Test Default Agent');
    expect(await names[1]?.getValue()).toBe('Test Alt Agent');

    const stars = await $$('[data-testid="btn-set-default-agent"]');
    expect(await stars[0]?.getAttribute('title')).toBe('Default agent');
    expect(await stars[1]?.getAttribute('title')).toBe('Set as default');

    await assertNoErrors();
  });

  it('adds a custom agent, saves it, and persists it across a reload', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/settings?workspace=${encodeURIComponent(testRepo)}`);

    await $('[data-testid="btn-add-agent"]').click();
    let names = await $$('[data-testid="input-agent-name"]');
    expect(names.length).toBe(3);

    await names[2]?.setValue('My Custom Agent');
    const commands = await $$('[data-testid="input-agent-command"]');
    await commands[2]?.setValue('my-custom-cli');
    const argsInputs = await $$('[data-testid="input-agent-args"]');
    await argsInputs[2]?.setValue('--flag value');

    // Make the new agent the default.
    const stars = await $$('[data-testid="btn-set-default-agent"]');
    await stars[2]?.click();

    await $('[data-testid="btn-save-agents"]').click();
    await waitForToast('success');

    // Force a remount so the settings page re-fetches from the config DB,
    // proving the write actually round-tripped through IPC + SQLite.
    await goHome();
    await gotoHash(`/settings?workspace=${encodeURIComponent(testRepo)}`);

    names = await $$('[data-testid="input-agent-name"]');
    expect(names.length).toBe(3);
    expect(await names[2]?.getValue()).toBe('My Custom Agent');

    const persistedCommands = await $$('[data-testid="input-agent-command"]');
    expect(await persistedCommands[2]?.getValue()).toBe('my-custom-cli');

    const persistedStars = await $$('[data-testid="btn-set-default-agent"]');
    expect(await persistedStars[2]?.getAttribute('title')).toBe('Default agent');

    await assertNoErrors();
  });

  it('removes an agent from the roster', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/settings?workspace=${encodeURIComponent(testRepo)}`);

    const removeButtons = await $$('[data-testid="btn-remove-agent"]');
    await removeButtons[1]?.click();

    const names = await $$('[data-testid="input-agent-name"]');
    expect(names.length).toBe(1);
    expect(await names[0]?.getValue()).toBe('Test Default Agent');

    await $('[data-testid="btn-save-agents"]').click();
    await waitForToast('success');

    await assertNoErrors();
  });
});
