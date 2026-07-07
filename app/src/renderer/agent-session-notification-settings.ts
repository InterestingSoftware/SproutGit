import { api } from './api.js';

const AGENT_SESSION_NOTIFICATIONS_KEY = 'agentSessionNotificationsEnabled';

/** Whether to show an OS notification when a background worktree's agent session finishes/idles. Defaults to enabled. */
export async function loadAgentSessionNotificationsEnabled(): Promise<boolean> {
  const raw = await api.getSetting(AGENT_SESSION_NOTIFICATIONS_KEY);
  return raw !== 'false';
}

export async function saveAgentSessionNotificationsEnabled(enabled: boolean): Promise<void> {
  await api.setSetting(AGENT_SESSION_NOTIFICATIONS_KEY, String(enabled));
}
