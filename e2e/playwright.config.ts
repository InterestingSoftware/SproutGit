import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DEV_HOST = process.env.SPROUTGIT_E2E_DEV_HOST ?? 'localhost';

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolveAvailability => {
    const server = createServer();
    server.once('error', () => resolveAvailability(false));
    server.listen(port, DEV_HOST, () => {
      server.close(() => resolveAvailability(true));
    });
  });
}

async function findOpenPort(startPort: number): Promise<number> {
  for (let candidate = startPort; candidate < startPort + 1000; candidate += 1) {
    if (await isPortAvailable(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Could not find an open port starting at ${startPort}`);
}

const inheritedDevPort = Number.parseInt(process.env.SPROUTGIT_E2E_DEV_PORT ?? '', 10);
const inheritedPluginPort = Number.parseInt(process.env.SPROUTGIT_PLAYWRIGHT_TCP_PORT ?? '', 10);
const inheritedSocketPath = process.env.SPROUTGIT_PLAYWRIGHT_SOCKET_PATH;
const inheritedConfigPath = process.env.SPROUTGIT_E2E_TAURI_CONFIG_PATH;

const hasInheritedRuntime =
  Number.isInteger(inheritedDevPort) &&
  inheritedDevPort > 0 &&
  Number.isInteger(inheritedPluginPort) &&
  inheritedPluginPort > 0 &&
  typeof inheritedSocketPath === 'string' &&
  inheritedSocketPath.length > 0;

const PORT_SEED = Number.parseInt(process.env.PW_PORT_SEED ?? String(process.pid), 10) || process.pid;
const DEV_PORT_BASE = 14000 + (PORT_SEED % 2000) * 2;
const PLUGIN_PORT_BASE = 22000 + (PORT_SEED % 2000);

const devPort = hasInheritedRuntime ? inheritedDevPort : await findOpenPort(DEV_PORT_BASE);
const pluginPort = hasInheritedRuntime ? inheritedPluginPort : await findOpenPort(PLUGIN_PORT_BASE);
const devUrl = `http://${DEV_HOST}:${devPort}`;
const socketPath =
  hasInheritedRuntime && inheritedSocketPath
    ? inheritedSocketPath
    : `/tmp/sproutgit-playwright-${process.pid}-${Date.now()}.sock`;

const tauriConfigPath =
  typeof inheritedConfigPath === 'string' && inheritedConfigPath.length > 0
    ? inheritedConfigPath
    : resolve(ROOT, `.tmp/tauri.playwright.${process.pid}.json`);

const runId = `${process.pid}-${Date.now()}`;
const e2eRunsBaseDir = resolve(ROOT, 'tmp', 'e2e-runs');

// Clean up all previous runs before starting this one (keep last run on disk after each run).
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

const tauriConfig = JSON.parse(readFileSync(resolve(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'));
tauriConfig.build = {
  ...tauriConfig.build,
  devUrl,
};
mkdirSync(resolve(ROOT, '.tmp'), { recursive: true });
writeFileSync(tauriConfigPath, JSON.stringify(tauriConfig));

process.env.SPROUTGIT_E2E_DEV_PORT = String(devPort);
process.env.SPROUTGIT_PLAYWRIGHT_TCP_PORT = String(pluginPort);
process.env.SPROUTGIT_PLAYWRIGHT_SOCKET_PATH = socketPath;
process.env.SPROUTGIT_E2E_TAURI_CONFIG_PATH = tauriConfigPath;
process.env.SPROUTGIT_CONFIG_DB_PATH = e2eConfigDbPath;
process.env.SPROUTGIT_E2E_TEST_DIR = e2eTestDir;
process.env.VITE_SPROUTGIT_E2E_RUN_ID = runId;

export default defineConfig({
  testDir: join(HERE, 'specs'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 45_000,
  use: {
    mode: 'tauri',
    headless: true,
  },
  reporter: [
    ['list'],
    ['junit', { outputFile: join(ROOT, 'test-results', 'e2e-junit.xml') }],
    ['html', { open: 'never', outputFolder: join(ROOT, 'test-results', 'playwright-report') }],
  ],
  webServer: {
    command: `pnpm tauri dev --features e2e-testing --config "${tauriConfigPath}"`,
    env: {
      ...process.env,
      SPROUTGIT_E2E_DEV_PORT: String(devPort),
      SPROUTGIT_PLAYWRIGHT_TCP_PORT: String(pluginPort),
      SPROUTGIT_PLAYWRIGHT_SOCKET_PATH: socketPath,
      SPROUTGIT_CONFIG_DB_PATH: e2eConfigDbPath,
      SPROUTGIT_E2E_TEST_DIR: e2eTestDir,
      VITE_SPROUTGIT_E2E_RUN_ID: runId,
    },
    url: devUrl,
    reuseExistingServer: false,
    gracefulShutdown: {
      signal: 'SIGTERM',
      timeout: 5_000,
    },
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  outputDir: join(ROOT, 'test-results', 'playwright-output'),
  preserveOutput: 'failures-only',
});