import { useEffect, useRef } from 'react';
import { api } from '../api.js';
import { useWorkspaceStore } from '../stores/workspace-store.js';
import { loadAgentSessionNotificationsEnabled } from '../agent-session-notification-settings.js';
import type { WorktreeInfo, AgentSessionStatusEvent, NotificationClickedEvent } from '@sproutgit/types';

function worktreeLabel(cwd: string, worktrees: WorktreeInfo[]): string {
  const wt = worktrees.find(w => w.path === cwd);
  if (!wt) return cwd.split(/[\\/]/).pop() ?? cwd;
  return wt.branch ?? (wt.detached ? 'detached HEAD' : (wt.path.split(/[\\/]/).pop() ?? wt.path));
}

/**
 * Fires a native OS notification when a background worktree's agent session
 * finishes or goes idle, and jumps back to that session when the
 * notification is clicked.
 *
 * "Background" means the app window isn't focused, a different worktree is
 * selected, or the Terminal tab isn't active — only the renderer has all
 * three signals, so (unlike idle *detection*, which lives in the main
 * process's TerminalManager) the decision of whether to actually show a
 * notification is made here, not in main.
 */
export function useAgentSessionNotifications(params: {
  worktrees: WorktreeInfo[];
  onJump: (session: { id: string; cwd: string }) => void;
}) {
  // Refs (not effect deps) so the listeners below can read the latest
  // worktrees/onJump without unsubscribing/resubscribing on every render.
  const worktreesRef = useRef(params.worktrees);
  worktreesRef.current = params.worktrees;
  const onJumpRef = useRef(params.onJump);
  onJumpRef.current = params.onJump;

  useEffect(() => {
    const offStatus = api.onAgentSessionStatus((event: AgentSessionStatusEvent) => {
      void (async () => {
        const enabled = await loadAgentSessionNotificationsEnabled();
        if (!enabled) return;

        const { activeWorktree, activeTab } = useWorkspaceStore.getState();
        const isForeground =
          document.hasFocus() && activeWorktree?.path === event.cwd && activeTab === 'terminal';
        if (isForeground) return;

        const agentLabel = event.agentName ? `"${event.agentName}"` : 'Agent';
        const title = event.reason === 'exited'
          ? `${agentLabel} session finished`
          : `${agentLabel} session went idle`;
        const body = `${worktreeLabel(event.cwd, worktreesRef.current)} — click to jump back in`;

        await api.showAgentSessionNotification({
          title,
          body,
          worktreePath: event.cwd,
          terminalId: event.id,
        });
      })().catch(err => console.error('[agent-session-notifications]', err));
    });

    const offClicked = api.onNotificationClicked((event: NotificationClickedEvent) => {
      onJumpRef.current({ id: event.terminalId, cwd: event.worktreePath });
    });

    return () => {
      offStatus();
      offClicked();
    };
  }, []);
}
