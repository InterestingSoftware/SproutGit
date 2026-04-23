import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DEV_HOST = process.env.SPROUTGIT_E2E_DEV_HOST ?? 'localhost';
const MIN_TEST_PORT = 1024;
const MAX_TEST_PORT = 45_000;

function parseSafePort(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < MIN_TEST_PORT || parsed > MAX_TEST_PORT) return null;
  return parsed;
}

async function isPortAvailable(port: number): Promise<boolean> {
  if (port < MIN_TEST_PORT || port > 65_535) {
    return false;
  }

  return new Promise(resolveAvailability => {
    const server = createServer();
    server.once('error', () => resolveAvailability(false));
    server.listen(port, DEV_HOST, () => {
      server.close(() => resolveAvailability(true));
    });
  });
}

async function findOpenPort(startPort: number): Promise<number> {
  const start = Math.max(MIN_TEST_PORT, startPort);
  const endExclusive = Math.min(MAX_TEST_PORT + 1, start + 1000);

  for (let candidate = start; candidate < endExclusive; candidate += 1) {
    if (await isPortAvailable(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Could not find an open port in safe range starting at ${startPort}`);
}

const inheritedDevPort = parseSafePort(process.env.SPROUTGIT_E2E_DEV_PORT);
const inheritedPluginPort = parseSafePort(process.env.SPROUTGIT_PLAYWRIGHT_TCP_PORT);
const inheritedSocketPath = process.env.SPROUTGIT_PLAYWRIGHT_SOCKET_PATH;
const hasInheritedRuntime =
  typeof inheritedDevPort === 'number' &&
  typeof inheritedPluginPort === 'number' &&
  typeof inheritedSocketPath === 'string' &&
  inheritedSocketPath.length > 0;

const PORT_SEED = Number.parseInt(process.env.PW_PORT_SEED ?? String(process.pid), 10) || process.pid;
const DEV_PORT_BASE = 14000 + (PORT_SEED % 2000) * 2;
const PLUGIN_PORT_BASE = 22000 + (PORT_SEED % 2000);

const devPort = hasInheritedRuntime ? inheritedDevPort : await findOpenPort(DEV_PORT_BASE);
const pluginPort = hasInheritedRuntime ? inheritedPluginPort : await findOpenPort(PLUGIN_PORT_BASE);
const socketPath =
  hasInheritedRuntime && inheritedSocketPath
    ? inheritedSocketPath
    : join(tmpdir(), `sproutgit-playwright-${process.pid}-${Date.now()}.sock`);

const runId = `${process.pid}-${Date.now()}`;
const e2eRunsBaseDir = resolve(ROOT, 'tmp', 'e2e-runs');

// Clean up previous run artifacts before starting this run.
try {
  const existingRuns = readdirSync(e2eRunsBaseDir)
    .map(name => ({ name, mtime: statSync(resolve(e2eRunsBaseDir, name)).mtime.getTime() }))
    .sort((a, b) => a.mtime - b.mtime);
  for (const run of existingRuns) {
    rmSync(resolve(e2eRunsBaseDir, run.name), { recursive: true, force: true });
  }
} catch {
  // Ignore — runs dir may not exist yet.
}

const e2eRunDir = resolve(e2eRunsBaseDir, runId);
const e2eConfigDbPath = resolve(e2eRunDir, 'config', 'config.db');
const e2eTestDir = resolve(e2eRunDir, 'workspace-data');

mkdirSync(resolve(e2eRunDir, 'config'), { recursive: true });
mkdirSync(e2eTestDir, { recursive: true });

process.env.SPROUTGIT_E2E_DEV_PORT = String(devPort);
process.env.SPROUTGIT_PLAYWRIGHT_TCP_PORT = String(pluginPort);
process.env.SPROUTGIT_PLAYWRIGHT_SOCKET_PATH = socketPath;
process.env.SPROUTGIT_CONFIG_DB_PATH = e2eConfigDbPath;
process.env.SPROUTGIT_E2E_TEST_DIR = e2eTestDir;
process.env.SPROUTGIT_E2E_TAURI_CWD = ROOT;
const headedViaEnv = process.env.SPROUTGIT_E2E_HEADED === '1';

export default defineConfig({
  testDir: join(HERE, 'specs'),
  globalSetup: join(HERE, 'global.setup.mjs'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 45_000,
  use: {
    mode: 'tauri',
    headless: !headedViaEnv,
  },
  reporter: [
    ['list'],
    ['junit', { outputFile: join(ROOT, 'test-results', 'e2e-junit.xml') }],
    ['html', { open: 'never', outputFolder: join(ROOT, 'test-results', 'playwright-report') }],
  ],
  outputDir: join(ROOT, 'test-results', 'playwright-output'),
  preserveOutput: 'failures-only',
});