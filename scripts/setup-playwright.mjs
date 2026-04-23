import { execFileSync } from 'node:child_process';

if (process.env.SPROUTGIT_SKIP_PLAYWRIGHT_SETUP === '1') {
  console.log('[setup-playwright] Skipping browser setup (SPROUTGIT_SKIP_PLAYWRIGHT_SETUP=1).');
  process.exit(0);
}

const args =
  process.platform === 'linux'
    ? ['exec', 'playwright', 'install', '--with-deps', 'chromium']
    : ['exec', 'playwright', 'install', 'chromium'];

console.log(`[setup-playwright] Running: pnpm ${args.join(' ')}`);
execFileSync('pnpm', args, { stdio: 'inherit' });
