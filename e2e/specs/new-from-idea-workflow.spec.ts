import { goHome, monitorErrors, waitForToast, E2E_TIMEOUT_MS } from '../helpers.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const RETRYABLE_RM_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY', 'EMFILE', 'ENFILE']);

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
 *    via node-pty with SPROUTGIT_AGENT set — idles briefly so the terminal
 *    tab has time to render, echoes whatever it reads on stdin (the kickoff
 *    prompt) back to its own stdout, then exits on its own a moment later.
 *    Unix PTYs echo typed input at the line-discipline level regardless of
 *    what the child process does, but Windows' ConPTY doesn't reliably do
 *    the same for a plain script that never enables console echo itself —
 *    so this can't rely on the pty to echo it; the script has to. Exiting
 *    on its own (rather than staying alive forever and needing to be
 *    killed by the test's cleanup) means the OS releases its handle on the
 *    workspace directory through the normal process-exit path well before
 *    cleanup ever runs, instead of via an external kill signal whose actual
 *    OS-level teardown timing turned out to be unpredictable on Windows
 *    even when explicitly waited for (see closeAllTerminalsAndWaitForExit
 *    below, kept as a defensive backstop, not the primary mechanism).
 */
const GENERATED_NAME = 'E2E Sample Project';
const GENERATED_SLUG = 'e2e-sample-project';
const GENERATED_STACK = 'Test Stack';
const GENERATED_DESCRIPTION = 'An e2e-generated test project.';

const TEST_AGENT_SCRIPT = `
if (process.env.SPROUTGIT_AGENT) {
  process.stdin.on('data', c => {
    process.stdout.write(c);
    setTimeout(() => process.exit(0), 3000);
  });
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

/** Closes the workspace's SQLite connection (and MCP/watcher handles) via IPC. */
async function closeWorkspace(workspacePath: string): Promise<void> {
  await browser.executeAsync(
    (p: string, done: (err?: string) => void) => {
      (window as unknown as { api: { closeWorkspace: (path: string) => Promise<void> } })
        .api.closeWorkspace(p)
        .then(() => done(), (e: unknown) => done(String(e)));
    },
    workspacePath
  );
}

/**
 * Navigates home, waits for the workspace route to actually unmount, then
 * closes the workspace and deletes its folder.
 *
 * The subtle part is *waiting for the unmount*. The renderer keeps polling a
 * workspace's queries (worktree list/status, metadata, prune) until its route
 * component actually unmounts and TanStack Query drops the observers. Several
 * of those queries re-open state.db through the main process's getWorkspaceDb
 * cache, so as long as the workspace is still mounted it keeps re-establishing
 * a state.db handle faster than cleanup can delete it — and on Windows an open
 * handle blocks unlink (WAL mode makes the lock stickier still), so the delete
 * never succeeds. goHome()'s fixed 200 ms pause isn't enough for React to
 * unmount the route on a loaded CI runner; the earlier failures showed
 * git:listWorktrees polls still firing *after* cleanup had started deleting,
 * proving the route was still live. Every other spec avoids this only because
 * its flow has gone quiescent by teardown; this one's scaffold-kickoff keeps
 * async work alive right across the navigation.
 *
 * Waiting for a home-screen element to render is the deterministic signal that
 * the workspace route has unmounted and its polling has stopped — no more
 * state.db re-opens after that point. A short re-close-and-retry loop then
 * mops up the at-most-one query that may have been in flight across the
 * unmount. (See the PR's follow-up note: the app itself should make
 * WORKSPACE_CLOSE authoritative so a late read can't re-establish a handle —
 * fixing that at the source would let this collapse back to a single close +
 * delete like every other spec.)
 */
async function closeAndDeleteWorkspace(workspacePath: string, projectsFolder: string): Promise<void> {
  await goHome();
  // Deterministic proof the workspace route unmounted (btn-clone is always on
  // the home screen) — not a fixed-time guess. This is the actual fix; the
  // retry loop below is just belt-and-suspenders for an in-flight straggler.
  await $('[data-testid="btn-clone"]').waitForDisplayed({ timeout: E2E_TIMEOUT_MS });

  const maxAttempts = 20;
  for (let attempt = 0; ; attempt++) {
    await closeWorkspace(workspacePath).catch(() => undefined);
    try {
      rmSync(projectsFolder, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !RETRYABLE_RM_CODES.has(code) || attempt >= maxAttempts) throw error;
      await delay(300);
    }
  }
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
    await closeAndDeleteWorkspace(workspacePath, projectsFolder);
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
