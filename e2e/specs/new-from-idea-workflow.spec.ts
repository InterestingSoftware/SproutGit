import { goHome, cleanupRepo, monitorErrors, waitForToast } from '../helpers.js';
import { mkdtempSync, rmSync } from 'fs';
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
 *    alive; the pty's own line discipline echoes whatever gets typed into it
 *    (the kickoff prompt), so nothing extra is needed here to see it rendered.
 */
const GENERATED_NAME = 'E2E Sample Project';
const GENERATED_SLUG = 'e2e-sample-project';
const GENERATED_STACK = 'Test Stack';
const GENERATED_DESCRIPTION = 'An e2e-generated test project.';

const TEST_AGENT_SCRIPT = `
if (process.env.SPROUTGIT_AGENT) {
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

async function closeAllTerminals(): Promise<void> {
  await browser.executeAsync((done: (err?: string) => void) => {
    (window as unknown as { api: { closeAllTerminals: () => Promise<void> } })
      .api.closeAllTerminals()
      .then(() => done(), (e: unknown) => done(String(e)));
  });
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
    await closeAllTerminals();
    await goHome();
    await cleanupRepo(workspacePath).catch(() => undefined);
    rmSync(projectsFolder, { recursive: true, force: true });
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

    await browser.pause(2200); // outlasts the 1500ms kickoff delay in workspace.tsx

    const rendered = await browser.execute(() => {
      const container = document.querySelector('[data-testid="terminal-container"]') as
        (HTMLDivElement & { __xterm?: { buffer: { active: { length: number; getLine: (n: number) => { translateToString: (trim: boolean) => string } | undefined } } } }) | null;
      const term = container?.__xterm;
      if (!term) return '';
      const lines: string[] = [];
      for (let i = 0; i < term.buffer.active.length; i++) {
        lines.push(term.buffer.active.getLine(i)?.translateToString(true) ?? '');
      }
      return lines.join('');
    });
    // The kickoff prompt names the project after the (slugified) name field.
    // Joined without newlines since xterm hard-wraps at the terminal's column
    // width, which can split the slug itself across two buffer lines.
    expect(rendered).toContain(GENERATED_SLUG);

    await assertNoErrors();
  });
});
