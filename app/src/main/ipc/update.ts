import { ipcMain, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC } from '@sproutgit/types';
import { log } from '../telemetry.js';

function send(channel: string, ...args: unknown[]): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}

// macOS auto-update goes through Electron's native Squirrel-based updater,
// which refuses to install unless the downloaded build is signed with a
// Developer ID certificate matching the one on the currently running app —
// an OS-level check that can't be turned off from here. CI currently builds
// mac artifacts with CSC_IDENTITY_AUTO_DISCOVERY=false and no signing
// certificate configured (see .github/workflows/ci.yml), so the check always
// fails after download and the update silently reverts to "Check for
// updates". Skip the mac update flow entirely until signing is set up.
//
// __SPROUTGIT_MAC_AUTO_UPDATE_ENABLED__ is baked in at build time (see
// electron.vite.config.ts) from the SPROUTGIT_MAC_AUTO_UPDATE_ENABLED env
// var. Once mac builds are actually signed, set that env var to 'true' in
// ci.yml's mac build step (and drop its CSC_IDENTITY_AUTO_DISCOVERY=false
// override) to turn this back on — no other app code changes needed.
const MAC_UPDATE_UNSUPPORTED_MESSAGE = 'Auto-update on macOS requires the app to be code-signed, which is not yet configured for this build.';
function macUpdateUnsupported(): boolean {
  return process.platform === 'darwin' && !__SPROUTGIT_MAC_AUTO_UPDATE_ENABLED__;
}

export function registerUpdateHandlers(): void {
  // electron-updater configuration
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Route electron-updater's internal logging (including the detailed reason
  // behind download/verification failures, e.g. code-signature mismatches on
  // macOS) into the persistent app log instead of nowhere.
  autoUpdater.logger = log;

  autoUpdater.on('checking-for-update', () => {
    send(IPC.EVENT_UPDATE_CHECKING);
  });

  autoUpdater.on('update-available', (info) => {
    send(IPC.EVENT_UPDATE_AVAILABLE, (info as { version?: string }).version ?? '');
  });

  autoUpdater.on('update-not-available', () => {
    send(IPC.EVENT_UPDATE_NOT_AVAILABLE);
  });

  autoUpdater.on('download-progress', (progress) => {
    send(IPC.EVENT_UPDATE_DOWNLOADING, Math.round((progress as { percent?: number }).percent ?? 0));
  });

  autoUpdater.on('update-downloaded', () => {
    send(IPC.EVENT_UPDATE_READY);
  });

  autoUpdater.on('error', (err: Error) => {
    log.error('[update] auto-updater error:', err);
    send(IPC.EVENT_UPDATE_ERROR, err.message);
  });

  // Renderer-triggered check
  ipcMain.handle(IPC.UPDATE_CHECK, async () => {
    if (macUpdateUnsupported()) {
      send(IPC.EVENT_UPDATE_ERROR, MAC_UPDATE_UNSUPPORTED_MESSAGE);
      return;
    }
    await autoUpdater.checkForUpdates();
  });

  // Renderer-triggered install (quit + install)
  ipcMain.handle(IPC.UPDATE_INSTALL, () => {
    autoUpdater.quitAndInstall();
  });
}

/** Call once after the main window is shown. */
export function startUpdateCheck(): void {
  // Only check in production builds (not dev / test).
  if (process.env['NODE_ENV'] === 'development') return;
  if (macUpdateUnsupported()) {
    log.info('[update] skipping startup update check on macOS: build is unsigned, native updater cannot install it');
    return;
  }
  void autoUpdater.checkForUpdates();
}
