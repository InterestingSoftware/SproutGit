import { ipcMain } from 'electron';
import { log } from '../telemetry.js';

/**
 * Registers an IPC handler, logging (and re-throwing) any error so it's
 * captured in the persistent electron-log file. `ipcMain.handle` already
 * forwards rejections to the renderer on its own, but without this wrapper
 * nothing about the failure is ever recorded for production diagnosis.
 */
export function handle<T>(
  channel: string,
  fn: (event: Electron.IpcMainInvokeEvent, ...args: never[]) => T | Promise<T>,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...(args as never[]));
    } catch (error) {
      log.error(`[ipc:${channel}]`, error);
      throw error;
    }
  });
}
