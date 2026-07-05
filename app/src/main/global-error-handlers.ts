import { app, type BrowserWindow } from 'electron';
import { IPC, type GlobalErrorEvent } from '@sproutgit/types';
import { log } from './telemetry.js';

function send(getWindow: () => BrowserWindow | null, payload: GlobalErrorEvent): void {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.EVENT_GLOBAL_ERROR, payload);
  }
}

/**
 * Last-resort safety net for crashes and programmer errors the app can't
 * otherwise surface: uncaught exceptions, unhandled rejections, and
 * renderer/child-process crashes. Everything here is logged to main.log and
 * forwarded to the renderer's ErrorModal — this does not attempt recovery,
 * only visibility.
 */
export function registerGlobalErrorHandlers(getWindow: () => BrowserWindow | null): void {
  process.on('uncaughtException', (err: Error) => {
    log.error('[main] uncaughtException', err);
    send(getWindow, { source: 'uncaughtException', message: err.message, ...(err.stack ? { stack: err.stack } : {}) });
  });

  process.on('unhandledRejection', (reason: unknown) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    log.error('[main] unhandledRejection', err);
    send(getWindow, { source: 'unhandledRejection', message: err.message, ...(err.stack ? { stack: err.stack } : {}) });
  });

  app.on('render-process-gone', (_event, _webContents, details) => {
    log.error('[main] render-process-gone', details);
    send(getWindow, {
      source: 'renderProcessGone',
      message: `Renderer process gone (${details.reason}, exit code ${details.exitCode})`,
    });
  });

  app.on('child-process-gone', (_event, details) => {
    log.error('[main] child-process-gone', details);
    send(getWindow, {
      source: 'childProcessGone',
      message: `${details.type} process gone (${details.reason}, exit code ${details.exitCode})`,
    });
  });
}
