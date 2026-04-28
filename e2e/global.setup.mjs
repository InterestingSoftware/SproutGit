import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

function binaryName() {
  return process.platform === 'win32' ? 'SproutGit.exe' : 'SproutGit';
}

function resolveBuiltBinaryPath() {
  const name = binaryName();

  const candidates = [
    process.env.SPROUTGIT_E2E_TAURI_COMMAND,
    process.env.CARGO_TARGET_DIR ? resolve(process.env.CARGO_TARGET_DIR, 'release', name) : null,
    resolve(process.cwd(), 'src-tauri', 'target', 'release', name),
    process.platform === 'darwin'
      ? resolve(homedir(), 'Library', 'Caches', 'SproutGit', 'cargo-target', 'release', name)
      : null,
    process.platform === 'linux'
      ? resolve(homedir(), '.cache', 'sproutgit', 'cargo-target', 'release', name)
      : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export default async function globalSetup() {
  if (process.env.SPROUTGIT_E2E_SKIP_BUILD === '1') {
    console.warn('[e2e] Skipping tauri build (SPROUTGIT_E2E_SKIP_BUILD=1).');
    const existingBinary = resolveBuiltBinaryPath();
    if (!existingBinary) {
      throw new Error(
        'SPROUTGIT_E2E_SKIP_BUILD=1 was set, but no built SproutGit binary was found. Run `pnpm run test:e2e:build` first.'
      );
    }
    process.env.SPROUTGIT_E2E_TAURI_COMMAND = existingBinary;
    process.env.SPROUTGIT_E2E_TAURI_CWD = process.cwd();
    console.warn(`[e2e] Using existing built app: ${existingBinary}`);
    return;
  }

  console.warn('[e2e] Running one-time e2e build before Playwright tests...');
  execFileSync('pnpm', ['run', 'test:e2e:build'], {
    stdio: 'inherit',
    env: process.env,
  });

  const builtBinary = resolveBuiltBinaryPath();
  if (!builtBinary) {
    throw new Error(
      'Build completed but no SproutGit release binary could be located for E2E launch.'
    );
  }

  process.env.SPROUTGIT_E2E_TAURI_COMMAND = builtBinary;
  process.env.SPROUTGIT_E2E_TAURI_CWD = process.cwd();
  console.warn(`[e2e] Using built app: ${builtBinary}`);
}
