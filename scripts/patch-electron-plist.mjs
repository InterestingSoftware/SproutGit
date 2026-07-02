#!/usr/bin/env node
/**
 * Patches the Electron binary's Info.plist so that macOS shows "SproutGit"
 * in the dock and menu bar during development (instead of "Electron").
 *
 * macOS reads CFBundleName / CFBundleDisplayName directly from the binary's
 * Info.plist — app.name has no effect on the dock label.
 *
 * Run automatically via postinstall, or manually:
 *   node scripts/patch-electron-plist.mjs
 */

import { execFileSync, execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { existsSync, renameSync, rmSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') process.exit(0);

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const APP_NAME = 'SproutGit';

// Locate ALL electron package dirs (pnpm may have one in root and one in app/).
let electronPkgDirs = [];
try {
  const found = execSync(
    `find "${workspaceRoot}/node_modules" -maxdepth 10 -name "path.txt" -path "*/electron/path.txt" 2>/dev/null`,
    { encoding: 'utf8' }
  ).trim();
  electronPkgDirs = found ? found.split('\n').map(p => dirname(p)) : [];
} catch { /* ignore */ }

if (electronPkgDirs.length === 0) {
  console.warn('patch-electron-plist: electron package not found — skipping.');
  process.exit(0);
}

const buddy = '/usr/libexec/PlistBuddy';

for (const electronPkgDir of electronPkgDirs) {
  const distDir = join(electronPkgDir, 'dist');
  const electronApp = join(distDir, 'Electron.app');
  const sproutApp = join(distDir, `${APP_NAME}.app`);
  const pathTxt = join(electronPkgDir, 'path.txt');

  // Step 1: rename Electron.app → SproutGit.app (so macOS uses the right bundle name).
  if (existsSync(electronApp)) {
    // A re-run of electron's own installer can re-extract a fresh Electron.app
    // without clearing out a SproutGit.app left over from a previous patch —
    // remove the stale bundle so the rename doesn't fail with ENOTEMPTY.
    if (existsSync(sproutApp)) {
      rmSync(sproutApp, { recursive: true, force: true });
    }
    renameSync(electronApp, sproutApp);
    console.log(`patch-electron-plist: renamed Electron.app → ${APP_NAME}.app (${electronPkgDir})`);
  } else if (!existsSync(sproutApp)) {
    console.warn(`patch-electron-plist: neither Electron.app nor SproutGit.app found in ${distDir} — skipping.`);
    continue;
  }

  // Step 2: update path.txt so the electron launcher finds the renamed bundle.
  const pathTxtContent = readFileSync(pathTxt, 'utf8').trim();
  const updatedPath = pathTxtContent.replace('Electron.app', `${APP_NAME}.app`);
  if (pathTxtContent !== updatedPath) {
    // electron's index.js reads path.txt with no .trim(), so no trailing newline.
    writeFileSync(pathTxt, updatedPath);
    console.log(`patch-electron-plist: updated path.txt → ${updatedPath} (${electronPkgDir})`);
  }

  // Step 3: patch Info.plist keys.
  const plist = join(sproutApp, 'Contents', 'Info.plist');
  if (!existsSync(plist)) {
    console.warn(`patch-electron-plist: Info.plist not found in ${sproutApp}`);
    continue;
  }

  try {
    execFileSync(buddy, ['-c', `Set :CFBundleName ${APP_NAME}`, plist]);
    execFileSync(buddy, ['-c', `Set :CFBundleDisplayName ${APP_NAME}`, plist]);
    // CFBundleIdentifier must differ from com.github.Electron — macOS caches the
    // dock label per bundle ID, so the name stays "Electron" until it changes.
    execFileSync(buddy, ['-c', 'Set :CFBundleIdentifier com.sproutgit.dev', plist]);
    console.log(`patch-electron-plist: patched Info.plist → ${plist}`);
  } catch (err) {
    console.warn(`patch-electron-plist: failed to patch ${plist}:`, err.message);
  }

  // Step 4: replace the bundle icon so macOS shows our icon from first launch,
  // before app.dock.setIcon() runs in JS.
  const srcIcon = join(workspaceRoot, 'app', 'build', 'icon.icns');
  const bundleIcon = join(sproutApp, 'Contents', 'Resources', 'electron.icns');
  if (existsSync(srcIcon) && existsSync(bundleIcon)) {
    copyFileSync(srcIcon, bundleIcon);
    console.log(`patch-electron-plist: replaced bundle icon → ${bundleIcon}`);
  }
}
