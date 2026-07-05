import { goHome, rmWithRetry, monitorErrors, waitForToast, E2E_TIMEOUT_MS } from '../helpers.js';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * A deterministic, cross-platform test agent — same rationale as
 * agent-workflow.spec.ts's TEST_AGENT_CONFIG: `node` is guaranteed present in
 * every E2E CI job, and `-e` passes the whole script as one argv entry with
 * no shell involved.
 *
 * This single script has to answer to two very different invocations of the
 * *same* configured command, since the app only stores one agent
 * command/args pair:
 *  - The one-shot "generate a name/stack" call (project-idea-generator.ts)
 *    spawns it via execFile with no SPROUTGIT_* env — reads the full prompt
 *    from stdin, prints a fixed JSON response, and exits.
 *  - The "scaffold this" terminal launch (agents.ts' AGENT_LAUNCH) spawns it
 *    via node-pty with SPROUTGIT_AGENT set — idles so the terminal tab stays
 *    alive, and explicitly echoes whatever it reads on stdin (the kickoff
 *    prompt) back to its own stdout. Unix PTYs echo typed input at the line-
 *    discipline level regardless of what the child process does, but Windows'
 *    ConPTY doesn't reliably do the same for a plain script that never enables
 *    console echo itself — so this can't rely on the pty to echo it; the
 *    script has to.
 */
const GENERATED_NAME = 'E2E Sample Project';
const GENERATED_SLUG = 'e2e-sample-project';
const GENERATED_STACK = 'Test Stack';
const GENERATED_DESCRIPTION = 'An e2e-generated test project.';

const TEST_AGENT_SCRIPT = `
if (process.env.SPROUTGIT_AGENT) {
  process.stdin.on('data', c => process.stdout.write(c));
  setInterval(() => {}, 1000);
} else {
  let d = '';
  process.stdin.on('data', c => { d += c; });
  process.stdin.on('end', () => {
    console.log(JSON.stringify({ name: ${JSON.stringify(GENERATED_NAME)}, techStack: ${JSON.stringify(GENERATED_STACK)}, description: ${JSON.stringify(GENERATED_DESCRIPTION)} }));
  });
}
`;

async function seedTestAgent(): Promise<void> {
  await browser.executeAsync(
    (config: unknown, done: (err?: string) => void) => {
      (window as unknown as { api: { saveAgentConfig: (c: unknown) => Promise<void> } })
        .api.saveAgentConfig(config)
        .then(() => done(), (e: unknown) => done(String(e)));
    },
    { command: 'node', args: ['-e', TEST_AGENT_SCRIPT], mode: 'terminal' }
  );
}

async function setProjectsFolder(dir: string): Promise<void> {
  await browser.executeAsync(
    (path: string, done: (err?: string) => void) => {
      (window as unknown as { api: { setSetting: (k: string, v: string) => Promise<void> } })
        .api.setSetting('projectsFolder', path)
        .then(() => done(), (e: unknown) => done(String(e)));
    },
    dir
  );
}

/**
 * Kills every live terminal session and waits for the underlying OS
 * processes to actually finish exiting before returning — not just for
 * TerminalManager.close() to request the kill and drop its own bookkeeping
 * (which happens synchronously, well before the OS confirms termination).
 * This test's fake agent is a live, indefinitely-running process
 * (setInterval) whose cwd is inside the workspace about to be deleted; on
 * Windows, that process can hold a lock on it for a variable, sometimes
 * long amount of time after the kill signal — but node-pty's own onExit
 * callback (wired to TERMINAL_EXIT/onTerminalExit) fires exactly when the
 * OS confirms the process is gone, so waiting on that is a real signal
 * instead of a guessed delay.
 */
async function closeAllTerminalsAndWaitForExit(): Promise<void> {
  await browser.executeAsync((done: (err?: string) => void) => {
    const api = (window as unknown as {
      api: {
        listTerminals: () => Promise<{ id: string }[]>;
        onTerminalExit: (cb: (id: string) => void) => () => void;
        closeAllTerminals: () => Promise<void>;
      };
    }).api;

    api.listTerminals()
      .then(terminals => {
        const pending = new Set(terminals.map(t => t.id));
        if (pending.size === 0) {
          void api.closeAllTerminals().then(() => done(), (e: unknown) => done(String(e)));
          return;
        }
        const offExit = api.onTerminalExit(id => {
          pending.delete(id);
          if (pending.size === 0) {
            clearTimeout(timer);
            offExit();
            done();
          }
        });
        // Defensive fallback only — an id that never reports exiting (e.g. a
        // future change stops emitting TERMINAL_EXIT) shouldn't hang the hook
        // forever; this is well short of the 120s mocha hook timeout.
        const timer = setTimeout(() => { offExit(); done(); }, 20_000);
        void api.closeAllTerminals().catch((e: unknown) => { clearTimeout(timer); offExit(); done(String(e)); });
      }, (e: unknown) => done(String(e)));
  });
}

/**
 * Navigates home and closes the workspace's SQLite connection via IPC —
 * the first two steps of helpers.ts's closeAndCleanup(), without its own
 * built-in file deletion. This test needs a single, more generously-budgeted
 * delete pass over the whole projectsFolder afterward (see afterEach below)
 * rather than closeAndCleanup's default retry budget for workspacePath
 * followed by a second one for projectsFolder — retrying the same still-
 * locked file twice back to back wastes the whole first budget for nothing.
 */
async function closeWorkspace(workspacePath: string): Promise<void> {
  await goHome();
  await browser.executeAsync(
    (p: string, done: (err?: string) => void) => {
      (window as unknown as { api: { closeWorkspace: (path: string) => Promise<void> } })
        .api.closeWorkspace(p)
        .then(() => done(), (e: unknown) => done(String(e)));
    },
    workspacePath
  );
}

describe('new from idea workflow', () => {
  let projectsFolder: string;
  let workspacePath: string;

  beforeEach(async () => {
    projectsFolder = mkdtempSync(join(tmpdir(), 'sg-e2e-new-idea-projects-'));
    workspacePath = join(projectsFolder, GENERATED_SLUG);
    await seedTestAgent();
    await setProjectsFolder(projectsFolder);
  });

  afterEach(async () => {
    await closeAllTerminalsAndWaitForExit();
    // Closes the workspace's SQLite connection via IPC *before* deleting —
    // skipping that leaves state.db locked on Windows. One retry pass over
    // the whole projectsFolder afterward, budgeted generously since this
    // test's workspace is freshly created (fresh state.db, freshly run
    // migrations) rather than a repo that's existed since beforeEach, giving
    // Windows Defender's real-time scanner — the documented, external cause
    // of transient EBUSY/EPERM on just-written files, see cleanupRepo's doc
    // comment — the freshest possible target right as cleanup runs.
    await closeWorkspace(workspacePath).catch(() => undefined);
    // maxRetries=25/retryDelayMs=250 sums to ~81s worst case (250 * 25*26/2)
    // — comfortably under the 120s Windows mocha hook timeout (wdio.conf.ts)
    // with headroom for the rest of this hook's own overhead.
    await rmWithRetry(projectsFolder, { maxRetries: 25, retryDelayMs: 250 });
  });

  it('pitches an idea, generates a name/stack, creates the project, and kicks off the agent', async () => {
    const assertNoErrors = monitorErrors();
    await goHome();

    await expect($('[data-testid="btn-new-from-idea"]')).toBeDisplayed();
    await $('[data-testid="btn-new-from-idea"]').click();
    await expect($('[data-testid="idea-dialog"]')).toBeDisplayed();

    await $('[data-testid="input-idea-pitch"]').setValue('a cli that turns a changelog into release notes');
    await $('[data-testid="btn-idea-generate"]').click();

    // Generated fields should appear, prefilled from the fake agent's response.
    // The name comes back slugified (folder/branch-safe) — it's the same field
    // used as both the display name and the workspace folder name.
    await expect($('[data-testid="input-idea-name"]')).toHaveValue(GENERATED_SLUG);
    await expect($('[data-testid="input-idea-stack"]')).toHaveValue(GENERATED_STACK);
    await expect($('[data-testid="input-idea-description"]')).toHaveValue(GENERATED_DESCRIPTION);

    // Drive the parent folder through the field itself rather than trusting
    // the settings pre-seed in beforeEach — the homescreen may already have
    // been mounted (and fetched its default) before that write landed, and
    // this is the one field that determines where a real directory gets
    // created on disk, so it must not silently fall back to the app's real
    // default (~/Projects) and write outside the test's temp sandbox.
    const parentFolderInput = $('[data-testid="input-idea-parent-folder"]');
    await parentFolderInput.setValue(projectsFolder);
    await expect(parentFolderInput).toHaveValue(projectsFolder);

    await $('[data-testid="btn-idea-create"]').click();
    await waitForToast('success');

    // Lands in the new workspace with its lone "main" worktree already active.
    await expect($('[data-testid="worktree-item"][data-branch="main"]')).toBeDisplayed();

    // Terminal-mode agent: scaffolding kickoff launches the agent as a
    // terminal session and (after workspace.tsx's boot delay) types the
    // kickoff prompt into it.
    await expect(
      $('[data-testid="terminal-session-tab"][data-session-label="AI Agent"]')
    ).toBeDisplayed();

    function readTerminalBuffer(): Promise<string> {
      return browser.execute(() => {
        const container = document.querySelector('[data-testid="terminal-container"]') as
          (HTMLDivElement & { __xterm?: { buffer: { active: { length: number; getLine: (n: number) => { translateToString: (trim: boolean) => string } | undefined } } } }) | null;
        const term = container?.__xterm;
        if (!term) return '';
        const lines: string[] = [];
        for (let i = 0; i < term.buffer.active.length; i++) {
          lines.push(term.buffer.active.getLine(i)?.translateToString(true) ?? '');
        }
        // Joined without newlines since xterm hard-wraps at the terminal's
        // column width, which can split the slug itself across two buffer lines.
        return lines.join('');
      });
    }

    // Polls rather than a fixed pause: the terminal container/xterm instance
    // mounting, the 1500ms in-app kickoff delay, and the agent process actually
    // starting are all variable-latency, more so on a loaded CI runner.
    await browser.waitUntil(async () => (await readTerminalBuffer()).includes(GENERATED_SLUG), {
      timeout: E2E_TIMEOUT_MS,
      timeoutMsg: `Expected the terminal to render the kickoff prompt containing "${GENERATED_SLUG}"`,
    });

    await assertNoErrors();
  });
});
