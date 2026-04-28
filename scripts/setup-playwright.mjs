import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

if (process.env.SPROUTGIT_SKIP_PLAYWRIGHT_SETUP === '1') {
  console.log('[setup-playwright] Skipping browser setup (SPROUTGIT_SKIP_PLAYWRIGHT_SETUP=1).');
  process.exit(0);
}

const playwrightBin =
  process.platform === 'win32'
    ? join(process.cwd(), 'node_modules', '.bin', 'playwright.cmd')
    : join(process.cwd(), 'node_modules', '.bin', 'playwright');

const args =
  process.platform === 'linux' ? ['install', '--with-deps', 'chromium'] : ['install', 'chromium'];

console.log(`[setup-playwright] Running: ${playwrightBin} ${args.join(' ')}`);
// On Windows, .cmd files must be run via cmd.exe (shell: true).
execFileSync(playwrightBin, args, { stdio: 'inherit', shell: process.platform === 'win32' });
