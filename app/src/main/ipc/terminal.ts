import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '@sproutgit/types';
import type { AgentSessionStatusEvent } from '@sproutgit/types';
import { TerminalManagerWithMeta } from '@sproutgit/terminal';
import { handle } from './handle.js';
import { log } from '../telemetry.js';

// Forward PTY output/exit events to the renderer window that created the session.
export const sessionWindows = new Map<string, BrowserWindow>();

// Per-session exit callbacks registered by hook execution (hooks.ts).
const hookExitHandlers = new Map<string, (exitCode: number) => void>();

export function registerHookExitHandler(id: string, handler: (exitCode: number) => void): void {
  hookExitHandlers.set(id, handler);
}

export const manager = new TerminalManagerWithMeta(
  (id, data) => {
    const win = sessionWindows.get(id);
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.TERMINAL_DATA, { id, data });
    }
  },
  (id, exitCode) => {
    // Read before handleSessionExit() (which runs after this callback, per
    // TerminalManagerWithMeta's exit ordering) deletes it — a session
    // closed deliberately via close() has already had its metadata removed
    // by the time this fires, so `meta` is undefined and no status event is
    // sent for that case, which is the desired behaviour (no notification
    // for a terminal the user closed on purpose).
    const meta = manager.getMeta(id);
    const win = sessionWindows.get(id);
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.TERMINAL_EXIT, { id });
      if (meta && meta.agentId !== null) {
        win.webContents.send(IPC.EVENT_AGENT_SESSION_STATUS, {
          id,
          cwd: meta.cwd,
          agentName: meta.agentName,
          reason: 'exited',
        } satisfies AgentSessionStatusEvent);
      }
    }
    const hookHandler = hookExitHandlers.get(id);
    if (hookHandler) {
      hookHandler(exitCode);
      hookExitHandlers.delete(id);
    }
    sessionWindows.delete(id);
  },
  (id, meta) => {
    const win = sessionWindows.get(id);
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.EVENT_AGENT_SESSION_STATUS, {
        id,
        cwd: meta.cwd,
        agentName: meta.agentName,
        reason: 'idle',
      } satisfies AgentSessionStatusEvent);
    }
  },
);

export function registerTerminalHandlers(): void {
  ipcMain.handle(IPC.TERMINAL_CREATE, (_e, args: {
    cwd: string;
    shell?: string;
    label?: string;
    cols?: number;
    rows?: number;
  }) => {
    const win = BrowserWindow.fromWebContents(_e.sender);
    const defaultShell = process.platform === 'win32' ? 'powershell.exe' : 'zsh';
    const shell = (args.shell ?? defaultShell) as import('@sproutgit/types').WorkspaceHookShell;
    let id: string;
    try {
      id = manager.spawn({
        cwd: args.cwd,
        shell,
        ...(args.label !== undefined && { label: args.label }),
        ...(args.cols !== undefined && { cols: args.cols }),
        ...(args.rows !== undefined && { rows: args.rows }),
      });
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      e.message = `[terminal:create] shell=${JSON.stringify(shell)} cwd=${JSON.stringify(args.cwd)} ${e.message}`;
      log.error(`[ipc:${IPC.TERMINAL_CREATE}]`, e);
      throw e;
    }

    if (win) sessionWindows.set(id, win);
    return id;
  });

  handle(IPC.TERMINAL_WRITE, (_e, args: { id: string; data: string }) => {
    manager.write(args.id, args.data);
  });

  handle(IPC.TERMINAL_RESIZE, (_e, args: {
    id: string;
    cols: number;
    rows: number;
  }) => {
    manager.resize(args.id, args.cols, args.rows);
  });

  handle(IPC.TERMINAL_CLOSE, (_e, id: string) => {
    manager.close(id);
  });

  handle(IPC.TERMINAL_CLOSE_FOR_PATH, (_e, pathPrefix: string) => {
    manager.closeForPath(pathPrefix);
  });

  handle(IPC.TERMINAL_CLOSE_ALL, () => {
    manager.closeAll();
  });

  handle(IPC.TERMINAL_LIST, () => {
    return manager.listSessions();
  });
}
