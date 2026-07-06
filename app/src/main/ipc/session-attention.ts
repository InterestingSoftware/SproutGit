import { BrowserWindow } from 'electron';
import { IPC } from '@sproutgit/types';
import { handle } from './handle.js';
import { AttentionTracker, PtyIdleHeuristic, PTY_IDLE_CHECK_INTERVAL_MS } from '../attention-tracker.js';

/** Process-wide singleton — shared by chat.ts (ACP turn/permission signals) and terminal.ts (PTY output-idle heuristic). */
export const attentionTracker = new AttentionTracker();

/** Best-effort output-idle heuristic for PTY agent sessions — see attention-tracker.ts. */
export const ptyIdleHeuristic = new PtyIdleHeuristic(attentionTracker);

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

attentionTracker.onChange(entry => broadcast(IPC.EVENT_SESSION_ATTENTION_CHANGED, entry));
attentionTracker.onRemove(sessionId => broadcast(IPC.EVENT_SESSION_ATTENTION_REMOVED, { sessionId }));

export function registerSessionAttentionHandlers(): void {
  handle(IPC.SESSION_ATTENTION_LIST, () => attentionTracker.list());

  // Periodically flags agent-launched PTY sessions that have gone quiet —
  // .unref() so this timer never keeps the process alive on its own.
  setInterval(() => ptyIdleHeuristic.sweep(), PTY_IDLE_CHECK_INTERVAL_MS).unref();
}
