import { app, BrowserWindow } from 'electron';
import { IPC, type GlobalErrorEvent } from '@sproutgit/types';
import { log } from './telemetry.js';

// These are process-level failures, not tied to any one workspace/window —
// broadcast to every open window rather than a single "main" one so an error
// in one window's renderer doesn't get silently missed by the others.
function send(payload: GlobalErrorEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.EVENT_GLOBAL_ERROR, payload);
  }
}

/**
 * Last-resort safety net for crashes and programmer errors the app can't
 * otherwise surface: uncaught exceptions, unhandled rejections, and
 * renderer/child-process crashes. Everything here is logged to main.log and
 * forwarded to the renderer's ErrorModal — this does not attempt recovery,
 * only visibility.
 */
export function registerGlobalErrorHandlers(): void {
  process.on('uncaughtException', (err: Error) => {
    log.error('[main] uncaughtException', err);
    send({ source: 'uncaughtException', message: err.message, ...(err.stack ? { stack: err.stack } : {}) });
  });

  process.on('unhandledRejection', (reason: unknown) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    log.error('[main] unhandledRejection', err);
    send({ source: 'unhandledRejection', message: err.message, ...(err.stack ? { stack: err.stack } : {}) });
  });

  app.on('render-process-gone', (_event, _webContents, details) => {
    log.error('[main] render-process-gone', details);
    send({
      source: 'renderProcessGone',
      message: `Renderer process gone (${details.reason}, exit code ${details.exitCode})`,
    });
  });

  app.on('child-process-gone', (_event, details) => {
    log.error('[main] child-process-gone', details);
    send({
      source: 'childProcessGone',
      message: `${details.type} process gone (${details.reason}, exit code ${details.exitCode})`,
    });
  });
}
