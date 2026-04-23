import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const CONFIG_PATH = 'e2e/playwright.config.ts';
const rawArgs = process.argv.slice(2).filter(arg => arg !== '--');
const tauriHeaded = rawArgs.includes('--headed');
const passthroughArgs = rawArgs.filter(arg => arg !== '--headed');
const skipPrebuild = process.env.SPROUTGIT_E2E_SKIP_PREBUILD === '1';
const suiteSeed = process.env.PW_PORT_SEED ?? String(Date.now());
const suiteConfigPath = resolve(ROOT, `.tmp/tauri.playwright.isolated.${suiteSeed}.json`);

if (tauriHeaded) {
  console.warn('[e2e-isolated] --headed detected; enabling Tauri headed mode without forwarding --headed to Playwright CLI.');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runPrebuildOnce() {
  if (skipPrebuild) {
    console.warn('[e2e-isolated] Skipping prebuild (SPROUTGIT_E2E_SKIP_PREBUILD=1).');
    return;
  }

  console.warn('[e2e-isolated] Running one-time prebuild before isolated test invocations...');
  const result = spawnSync('pnpm', ['run', 'test:e2e:build'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      PW_PORT_SEED: suiteSeed,
      SPROUTGIT_E2E_TAURI_CONFIG_PATH: suiteConfigPath,
    },
  });

  if ((result.status ?? 1) !== 0) {
    console.error('[e2e-isolated] Prebuild failed; aborting isolated runs.');
    process.exit(result.status ?? 1);
  }
}

function listTests() {
  const output = execFileSync(
    'pnpm',
    ['exec', 'playwright', 'test', '-c', CONFIG_PATH, '--list', ...passthroughArgs],
    { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' },
  );

  const lines = output.split('\n');
  const tests = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('.spec.ts:')) continue;

    const match = trimmed.match(/^(.+\.spec\.ts):\d+:\d+\s+›\s+(.+)$/);
    if (!match) continue;

    const [, file, fullTitle] = match;
    tests.push({ file, fullTitle });
  }

  return tests.filter(({ fullTitle }) => {
    if (fullTitle.includes('@canary') && !process.env.RUN_CANARY) {
      return false;
    }

    if (fullTitle.includes('@screenshots') && !process.env.CAPTURE_SCREENSHOTS) {
      return false;
    }

    return true;
  });
}

function runSingleTest(file, fullTitle) {
  const grep = `^${escapeRegex(fullTitle)}$`;
  const commandArgs = [
    'exec',
    'playwright',
    'test',
    '-c',
    CONFIG_PATH,
    file,
    '--grep',
    grep,
    '--workers=1',
    ...passthroughArgs,
  ];

  console.warn(`\n[e2e-isolated] Running ${file} :: ${fullTitle}`);
  const result = spawnSync('pnpm', commandArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      SPROUTGIT_E2E_HEADED: tauriHeaded ? '1' : '0',
      // Keep a stable suite seed/config path to avoid forcing Tauri rebuild work per test.
      PW_PORT_SEED: suiteSeed,
      SPROUTGIT_E2E_TAURI_CONFIG_PATH: suiteConfigPath,
    },
  });

  return result.status ?? 1;
}

runPrebuildOnce();
const tests = listTests();

if (tests.length === 0) {
  console.error('[e2e-isolated] No runnable tests matched the provided filters.');
  process.exit(1);
}

let failed = 0;
for (const test of tests) {
  const code = runSingleTest(test.file, test.fullTitle);
  if (code !== 0) {
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`\n[e2e-isolated] ${failed} test invocation(s) failed.`);
  process.exit(1);
}

console.warn(`\n[e2e-isolated] Completed ${tests.length} isolated test invocation(s).`);
