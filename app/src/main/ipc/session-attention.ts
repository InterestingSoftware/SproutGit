import { BrowserWindow } from 'electron';
import { IPC } from '@sproutgit/types';
import { handle } from './handle.js';
import { AttentionTracker } from '../attention-tracker.js';

/** Process-wide singleton — shared by chat.ts (ACP turn/permission signals) and terminal.ts (PTY output-idle heuristic, via @sproutgit/terminal's IdleTracker). */
export const attentionTracker = new AttentionTracker();

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

attentionTracker.onChange(entry => broadcast(IPC.EVENT_SESSION_ATTENTION_CHANGED, entry));
attentionTracker.onRemove(sessionId => broadcast(IPC.EVENT_SESSION_ATTENTION_REMOVED, { sessionId }));

export function registerSessionAttentionHandlers(): void {
  handle(IPC.SESSION_ATTENTION_LIST, () => attentionTracker.list());
}
