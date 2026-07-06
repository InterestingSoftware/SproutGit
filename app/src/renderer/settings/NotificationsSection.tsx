import { Bell } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ToastData } from '@sproutgit/ui';
import { loadAgentSessionNotificationsEnabled, saveAgentSessionNotificationsEnabled } from '../agent-session-notification-settings.js';

interface Props {
  onToast: (msg: string, variant?: ToastData['variant']) => void;
}

export function NotificationsSection({ onToast }: Props) {
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void loadAgentSessionNotificationsEnabled().then(value => {
      setEnabled(value);
      setLoaded(true);
    });
  }, []);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    try {
      await saveAgentSessionNotificationsEnabled(next);
    } catch (err) {
      onToast(String(err), 'error');
    }
  }

  return (
    <section className="rounded-lg border border-(--sg-border) bg-(--sg-surface) p-5" data-testid="notifications-section">
      <h2 className="sg-heading mb-3 text-sm font-semibold text-(--sg-primary) flex items-center gap-1.5">
        <Bell size={15} /> Notifications
      </h2>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-(--sg-text-dim)">Agent session finished</p>
          <p className="mt-0.5 text-[11px] text-(--sg-text-faint)">
            Show an OS notification when a background worktree&apos;s agent session finishes or goes idle.
          </p>
        </div>
        <label
          className="sg-agent-session-notifications-toggle inline-flex shrink-0 cursor-pointer items-center gap-2 text-xs text-(--sg-text-dim)"
          data-testid="agent-session-notifications-toggle"
        >
          <input
            type="checkbox"
            checked={enabled}
            disabled={!loaded}
            onChange={() => void toggle()}
          />
          {enabled ? 'Enabled' : 'Disabled'}
        </label>
      </div>
    </section>
  );
}
