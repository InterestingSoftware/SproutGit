/**
 * Pushed to the renderer when an agent-launched terminal session exits or its
 * output has been quiet for a while. The renderer (not main) decides whether
 * a background OS notification is warranted — it's the only side that knows
 * which worktree/tab is currently in view.
 */
export type AgentSessionStatusEvent = {
  id: string;
  cwd: string;
  agentName: string | null;
  reason: 'exited' | 'idle';
};

/**
 * Renderer → main request to show a native OS notification. The renderer has
 * already decided notifications are enabled and the session is in the
 * background; main just owns the `Notification` API and focuses/jumps back
 * to the session on click.
 */
export type ShowAgentNotificationArgs = {
  title: string;
  body: string;
  worktreePath: string;
  terminalId: string;
};

/** Pushed to the renderer when the user clicks an agent-session-finished notification. */
export type NotificationClickedEvent = {
  worktreePath: string;
  terminalId: string;
};
