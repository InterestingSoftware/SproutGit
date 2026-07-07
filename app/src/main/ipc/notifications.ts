/**
 * Native OS notification for a background agent session finishing/idling.
 *
 * The renderer owns the *policy* (is the setting enabled, is this worktree
 * currently out of view) since only it knows which worktree/tab is active —
 * this module just owns the Electron `Notification` API and the
 * focus-and-jump-back behaviour on click.
 */
import { BrowserWindow, Notification } from 'electron';
import { IPC } from '@sproutgit/types';
import type { ShowAgentNotificationArgs, NotificationClickedEvent } from '@sproutgit/types';
import { handle } from './handle.js';

export function registerNotificationHandlers(): void {
  handle(IPC.NOTIFICATION_SHOW, (_e, args: ShowAgentNotificationArgs) => {
    if (!Notification.isSupported()) return;

    const win = BrowserWindow.fromWebContents(_e.sender);
    const notification = new Notification({ title: args.title, body: args.body });

    notification.on('click', () => {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        win.webContents.send(IPC.EVENT_NOTIFICATION_CLICKED, {
          worktreePath: args.worktreePath,
          terminalId: args.terminalId,
        } satisfies NotificationClickedEvent);
      }
    });

    notification.show();
  });
}
