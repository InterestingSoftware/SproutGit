/**
 * On-demand installer for ACP adapter packages (Claude Code, Codex CLI) —
 * the presets in agents.ts whose ACP support ships as a separate npm
 * package rather than a flag on the CLI itself. These adapters bundle a
 * full compiled agent binary (hundreds of MB), so SproutGit does not ship
 * them in its own installer; instead it can fetch one into its own
 * userData directory on request, independent of the user's global npm/PATH
 * state.
 */
import { app } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AcpAdapterInstallEvent } from '@sproutgit/types';
import { resolveCommandPath } from './tool-test-helpers.js';
import type { AcpPresetInfo } from './agents.js';

/**
 * Reads the version range declared for `npmPackage` in the app's own
 * package.json `dependencies` — the single source of truth for which
 * version this build was tested against. `app.getAppPath()` resolves to
 * the directory containing package.json in both dev and packaged builds.
 */
function declaredAdapterVersion(npmPackage: string): string | null {
  try {
    const pkgJson = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    return pkgJson.dependencies?.[npmPackage] ?? null;
  } catch {
    return null;
  }
}

/** Directory SproutGit installs on-demand ACP adapters into, one subfolder per npm package. */
export function acpAdapterInstallDir(userDataPath: string, npmPackage: string): string {
  return join(userDataPath, 'acp-adapters', npmPackage.replace(/[^a-zA-Z0-9]/g, '_'));
}

function acpAdapterBinPath(userDataPath: string, npmPackage: string, bin: string): string {
  return join(acpAdapterInstallDir(userDataPath, npmPackage), 'node_modules', '.bin', bin);
}

/**
 * Resolves the binary to spawn for an ACP preset that needs a separate
 * adapter package: prefers PATH (covers a manual global install, or `pnpm
 * dev`'s script-injected `node_modules/.bin`), then falls back to a
 * previously on-demand-installed copy in SproutGit's userData directory.
 * Returns `null` if neither is available.
 */
export async function resolveAcpAdapterBin(userDataPath: string, spec: AcpPresetInfo): Promise<string | null> {
  const onPath = await resolveCommandPath(spec.bin);
  if (onPath) return onPath;
  if (!spec.npmPackage) return null;
  const installed = acpAdapterBinPath(userDataPath, spec.npmPackage, spec.bin);
  return existsSync(installed) ? installed : null;
}

/**
 * Installs an ACP adapter package into SproutGit's userData directory via
 * `npm install --prefix`, which works without an existing package.json at
 * the target directory. Streams raw npm output as progress messages —
 * `npm install` doesn't report clean percentages, and raw output is still
 * useful for diagnosing a failed install.
 */
export async function installAcpAdapter(
  userDataPath: string,
  npmPackage: string,
  onProgress: (event: AcpAdapterInstallEvent) => void,
): Promise<void> {
  const dir = acpAdapterInstallDir(userDataPath, npmPackage);
  await mkdir(dir, { recursive: true });

  const npmBin = await resolveCommandPath('npm');
  if (!npmBin) {
    const message = 'npm was not found on PATH. Install Node.js (which includes npm) to enable one-click agent adapter installs.';
    onProgress({ npmPackage, status: 'error', message });
    throw new Error(message);
  }

  // Pinned to the same range declared in app/package.json — the version
  // this build was actually tested against — rather than whatever `latest`
  // happens to resolve to at install time.
  const version = declaredAdapterVersion(npmPackage);
  const packageSpec = version ? `${npmPackage}@${version}` : npmPackage;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      npmBin,
      ['install', packageSpec, '--prefix', dir, '--no-save', '--no-audit', '--no-fund', '--loglevel=error'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stderrBuf = '';
    child.stdout.on('data', d => onProgress({ npmPackage, status: 'progress', message: String(d).trim() }));
    child.stderr.on('data', d => { stderrBuf += String(d); });

    child.once('error', err => {
      onProgress({ npmPackage, status: 'error', message: err.message });
      reject(err);
    });
    child.once('exit', code => {
      if (code === 0) {
        onProgress({ npmPackage, status: 'done', message: 'Installed.' });
        resolve();
      } else {
        const message = stderrBuf.trim() || `npm install exited with code ${code}`;
        onProgress({ npmPackage, status: 'error', message });
        reject(new Error(message));
      }
    });
  });
}
