import { resolve, join } from 'path';
import { execSync } from 'child_process';
import { existsSync, statSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

// Propagate test-mode env vars to the Electron process (inherited by child processes).
process.env['NODE_ENV'] = 'test';
process.env['SPROUTGIT_E2E'] = '1';
// Enable Chromium/Electron verbose logging so crashes surface in CI output.
process.env['ELECTRON_ENABLE_LOGGING'] = '1';

// Use the real Electron binary directly so ChromeDriver can kill the process
// cleanly. Using `appEntryPoint` launches via the .bin/electron shell wrapper
// (shell → node cli.js → Electron), and on macOS the Electron child process is
// reparented to init when cli.js is killed, leaving orphaned windows after tests.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronBinary = require('electron') as string;
// Chromium log file — tmpdir() resolves to /tmp on Linux/macOS and %TEMP% on Windows.
const chromiumLogFile = join(tmpdir(), 'electron-e2e-chromium.log');

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./specs/**/*.spec.ts'],
  exclude: [],
  maxInstances: 1,

  // Retry a whole spec file once if it fails. Driving a real Electron app
  // through ChromeDriver in CI is inherently subject to rare, non-deterministic
  // infrastructure flakes that no amount of test logic can prevent — the
  // ChromeDriver process crashing mid-session, "Timeout exceeded to get the
  // ContextId" from the CDP bridge, a session dying on a momentarily-overloaded
  // runner. Without a retry, one such hiccup in any single spec fails the
  // entire suite. One retry (with a fresh session) turns those transient
  // failures into a self-heal while still surfacing a genuinely-broken spec,
  // which fails both times. Deferred so a flaky spec re-runs at the end of the
  // queue on a clean session rather than immediately.
  specFileRetries: 1,
  specFileRetriesDeferred: true,

  capabilities: [
    {
      browserName: 'electron',
      // wdio-electron-service capability options (not yet in the base WDIO types)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'wdio:electronServiceOptions': {
        appBinaryPath: electronBinary,
        // Default is 10s. Observed failing on Windows CI with "Timeout
        // exceeded to get the ContextId" — the same class of problem as
        // waitforTimeout below (a fixed budget tuned for macOS's fast native
        // render, too tight for slower non-macOS CI runners). Give Linux/
        // Windows the same headroom; macOS keeps the library default since
        // it's never hit this.
        cdpBridgeTimeout: process.platform === 'darwin' ? 10_000 : 60_000,
        appArgs: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          // NOTE: do NOT pass --disable-software-rasterizer here.
          // On Linux CI (no GPU), the software rasterizer is the only rendering
          // backend. Disabling it prevents windows from ever becoming ready.
          // macOS works regardless (Metal provides a native fallback).
          '--disable-dev-shm-usage',
          // Write Chromium's internal logs (GPU crash, sandbox errors, etc.) to a
          // known file so CI can dump it even when the session never establishes.
          '--enable-logging',
          `--log-file=${chromiumLogFile}`,
          '--v=1',
          `--app=${resolve(__dirname, '../app/out/main/index.js')}`,
          '--sproutgit-e2e',
        ],
      },
    } as any,
  ],

  logLevel: 'info',
  bail: 0,

  // On Linux the renderer can be slow to initialise (QEMU emulation on CI or
  // amd64 runners without hardware GPU acceleration). On Windows, opening a
  // not-yet-migrated workspace runs several git subprocess spawns plus
  // directory moves to convert it to the bare-root layout — Windows CI
  // (subprocess spawn overhead, Defender scanning each spawn) is measurably
  // slower at that than macOS, sometimes past the 15s budget that's fine
  // for macOS's <2s native render. Give both the same 4× headroom; macOS
  // keeps the tight budget since it never needs it.
  waitforTimeout: process.platform === 'darwin' ? 15_000 : 60_000,

  connectionRetryTimeout: process.platform === 'darwin' ? 20_000 : 60_000,
  connectionRetryCount: 3,

  services: ['electron'],

  framework: 'mocha',
  reporters: ['spec'],

  mochaOpts: {
    ui: 'bdd',
    // Safety-net timeout per test; individual element waits are capped by waitforTimeout.
    // Screenshot pipeline runs 5 shots × 2 themes and can take up to 2 minutes.
    // Linux/Windows get 4× headroom (QEMU/CPU-limited CI runners on Linux;
    // slower git-subprocess-heavy first-open migration on Windows) — a test
    // can chain several waitforTimeout-bounded waits, so this needs the same
    // multiple applied to it or the outer mocha timeout could cut a test off
    // before its own per-element retries get a chance to succeed.
    timeout: process.env['CAPTURE_SCREENSHOTS'] ? 120_000 : process.platform === 'darwin' ? 30_000 : 120_000,
  },

  // Always build the Electron app before running tests so the test binary is
  // up-to-date without requiring a separate manual build step.
  onPrepare: () => {
    const appDir = resolve(__dirname, '../app');
    // Use the local electron-vite binary directly to avoid pnpm workspace
    // resolution issues (pnpm exec looks for .pnpmfile.mjs at the workspace root).
    const electronVite = resolve(appDir, 'node_modules/.bin/electron-vite');

    console.log('[wdio] Building Electron app…');
    execSync(`"${electronVite}" build`, { cwd: appDir, stdio: 'inherit' });
    console.log('[wdio] Build complete.');

    if (process.platform === 'linux') {
      console.log('[wdio] Electron binary:', electronBinary);
      try {
        const ver = execSync(`"${electronBinary}" --version`, { timeout: 10_000 }).toString().trim();
        console.log('[wdio] Electron version check OK:', ver);
      } catch (e) {
        console.error('[wdio] Electron --version FAILED (binary may be missing libs):', e);
      }
      try {
        const ldd = execSync(`ldd "${electronBinary}"`, { timeout: 5_000 }).toString();
        const missing = ldd.split('\n').filter(l => l.includes('not found'));
        if (missing.length) {
          console.error('[wdio] MISSING SHARED LIBS:\n' + missing.join('\n'));
        } else {
          console.log('[wdio] ldd: all shared libs present');
        }
      } catch (e) {
        console.error('[wdio] ldd check failed:', e);
      }
    }
  },

  // Pipe Electron main-process logs into the test output so failures are
  // self-diagnosing without needing to check log files manually.
  beforeTest: () => {
    const logPath = join(tmpdir(), 'sg-e2e-latest.log');
    // Record byte offset so afterTest only shows lines written during this test.
    (globalThis as Record<string, unknown>)['__sgLogOffset'] =
      existsSync(logPath) ? statSync(logPath).size : 0;
  },

  afterTest: (_test, _ctx, { passed }) => {
    if (passed) return;
    const logPath = join(tmpdir(), 'sg-e2e-latest.log');
    if (!existsSync(logPath)) {
      console.log('[wdio] No e2e log file found at', logPath, '— isE2EMode may not be active');
      return;
    }
    const offset = ((globalThis as Record<string, unknown>)['__sgLogOffset'] as number) ?? 0;
    const content = readFileSync(logPath).slice(offset).toString('utf-8').trim();
    if (content) {
      console.log('\n─── Electron main-process log (this test) ───');
      console.log(content);
      console.log('─────────────────────────────────────────────');
    }
  },

  // Dump all available Electron/Chromium logs at the end of the run so
  // session-timeout failures (where afterTest never fires) are still diagnosed.
  onComplete: (_exitCode, _config, _caps, results) => {
    const failed = (results as { failed?: number }).failed ?? 0;
    if (!failed) return;
    if (existsSync(chromiumLogFile)) {
      const content = readFileSync(chromiumLogFile, 'utf-8').trim().split('\n').slice(-100).join('\n');
      console.log('\n─── Chromium internal log (last 100 lines) ───');
      console.log(content);
      console.log('──────────────────────────────────────────────');
    }
    const sgLog = join(tmpdir(), 'sg-e2e-latest.log');
    if (existsSync(sgLog)) {
      const content = readFileSync(sgLog, 'utf-8').trim().split('\n').slice(-100).join('\n');
      console.log('\n─── Electron app log (last 100 lines) ───');
      console.log(content);
      console.log('─────────────────────────────────────────');
    }
  },

};
