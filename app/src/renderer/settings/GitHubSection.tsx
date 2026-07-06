import { Link2 } from 'lucide-react';
import { api } from '../api.js';
import { useState, useEffect } from 'react';
import type { DeviceCodeResponse, GitHubAuthStatus, AgentPrPermission } from '@sproutgit/types';
import { Spinner, type ToastData } from '@sproutgit/ui';

interface Props {
  onToast: (msg: string, variant?: ToastData['variant']) => void;
  onAuthChange: (auth: GitHubAuthStatus | null) => void;
  workspacePath: string;
}

/** Key in the workspace DB's generic UI-state store (see `workspaceState` schema / `WORKSPACE_GET_STATE`/`SET_STATE`). */
const AGENT_PR_PERMISSION_KEY = 'github.agentPrPermission';
const DEFAULT_AGENT_PR_PERMISSION: AgentPrPermission = 'ask';

function isAgentPrPermission(value: string): value is AgentPrPermission {
  return value === 'auto' || value === 'ask' || value === 'never';
}

export function GitHubSection({ onToast, onAuthChange, workspacePath }: Props) {
  const [githubAuth, setGithubAuth] = useState<GitHubAuthStatus | null>(null);
  const [deviceCode, setDeviceCode] = useState<DeviceCodeResponse | null>(null);
  const [authPolling, setAuthPolling] = useState(false);
  const [authStarting, setAuthStarting] = useState(false);
  const [agentPrPermission, setAgentPrPermission] = useState<AgentPrPermission>(DEFAULT_AGENT_PR_PERMISSION);
  const [savingPermission, setSavingPermission] = useState(false);

  useEffect(() => {
    if (!workspacePath) return;
    void api.getWorkspaceState(workspacePath, AGENT_PR_PERMISSION_KEY).then((saved) => {
      setAgentPrPermission(saved && isAgentPrPermission(saved) ? saved : DEFAULT_AGENT_PR_PERMISSION);
    });
  }, [workspacePath]);

  async function handlePermissionChange(next: AgentPrPermission) {
    setAgentPrPermission(next);
    if (!workspacePath) return;
    setSavingPermission(true);
    try {
      await api.setWorkspaceState(workspacePath, AGENT_PR_PERMISSION_KEY, next);
    } catch (err) {
      onToast(String(err), 'error');
    } finally {
      setSavingPermission(false);
    }
  }

  useEffect(() => {
    void api.githubAuthStatus()
      .then((status: GitHubAuthStatus) => {
        setGithubAuth(status);
        onAuthChange(status);
      })
      .catch(() => {
        const fallback: GitHubAuthStatus = { authenticated: false, username: null, provider: 'github' };
        setGithubAuth(fallback);
        onAuthChange(fallback);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startGithubLogin() {
    setAuthStarting(true);
    try {
      const dc = await api.githubDeviceFlowStart();
      setDeviceCode(dc);
      navigator.clipboard.writeText(dc.userCode).catch(() => {});
      await api.openUrl(dc.verificationUri);

      const poll = async () => {
        try {
          const result = await api.githubDeviceFlowPoll(dc.deviceCode);
          if (result.status === 'complete') {
            setAuthPolling(false);
            setDeviceCode(null);
            const next: GitHubAuthStatus = { authenticated: true, username: result.username, provider: 'github' };
            setGithubAuth(next);
            onAuthChange(next);
            onToast(`Signed in as ${result.username ?? 'GitHub user'}`, 'success');
            return;
          }
          if (result.status === 'pending') {
            setAuthPolling(true);
            setTimeout(() => void poll(), (dc.interval + 1) * 1000);
            return;
          }
          setAuthPolling(false);
          setDeviceCode(null);
          onToast(result.error ?? 'Authentication failed', 'error');
        } catch (err) {
          setAuthPolling(false);
          setDeviceCode(null);
          onToast(String(err), 'error');
        }
      };
      setTimeout(() => void poll(), dc.interval * 1000);
    } catch (err) {
      onToast(String(err), 'error');
    } finally {
      setAuthStarting(false);
    }
  }

  async function handleGithubLogout() {
    try {
      await api.githubLogout();
      const next: GitHubAuthStatus = { authenticated: false, username: null, provider: 'github' };
      setGithubAuth(next);
      onAuthChange(next);
    } catch (err) {
      onToast(String(err), 'error');
    }
  }

  return (
    <section className="rounded-lg border border-(--sg-border) bg-(--sg-surface) p-5">
      <div className="mb-3 flex items-center gap-2">
        <Link2 size={16} className="text-(--sg-primary) shrink-0" />
        <h2 className="sg-heading text-sm font-semibold text-(--sg-primary)">Git Provider</h2>
      </div>

      {githubAuth === null ? (
        <div className="flex items-center gap-2 text-xs text-(--sg-text-dim)">
          <Spinner size="sm" /> Checking connection...
        </div>
      ) : githubAuth.authenticated ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between rounded border border-(--sg-border) bg-(--sg-surface-raised) px-3 py-2.5">
            <p className="text-xs text-(--sg-text)">{githubAuth.username}</p>
            <button
              className="rounded border border-(--sg-border) px-3 py-1.5 text-xs text-(--sg-text-dim) hover:border-(--sg-danger) hover:text-(--sg-danger)"
              onClick={() => void handleGithubLogout()}
            >
              Sign out
            </button>
          </div>

          {workspacePath && (
            <div className="flex items-center justify-between rounded border border-(--sg-border) px-3 py-2.5">
              <div>
                <p className="text-xs text-(--sg-text)">Agent-initiated ready-for-review / merge</p>
                <p className="mt-0.5 text-[11px] text-(--sg-text-faint)">
                  Governs this workspace only. Applies once an agent can call these actions itself (tracked separately) — human use of the PR panel is unaffected.
                </p>
              </div>
              <select
                className="rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-2.5 py-1.5 text-xs text-(--sg-text)"
                value={agentPrPermission}
                disabled={savingPermission}
                onChange={(e) => void handlePermissionChange(e.target.value as AgentPrPermission)}
                data-testid="select-agent-pr-permission"
              >
                <option value="auto">Auto</option>
                <option value="ask">Ask</option>
                <option value="never">Never</option>
              </select>
            </div>
          )}
        </div>
      ) : deviceCode ? (
        <div className="space-y-2.5">
          <p className="text-xs text-(--sg-text-dim)">
            Enter this code on{' '}
            <button
              className="text-(--sg-primary) hover:underline"
              onClick={() => void api.openUrl(deviceCode.verificationUri)}
            >
              github.com/login/device
            </button>
          </p>
          <div className="flex items-center gap-2">
            <span className="flex-1 rounded border border-(--sg-border) bg-(--sg-surface-raised) px-3 py-2 text-center font-mono text-base font-bold tracking-[0.2em] text-(--sg-text)">
              {deviceCode.userCode}
            </span>
            <button
              className="rounded border border-(--sg-border) px-3 py-1.5 text-xs text-(--sg-text-dim) hover:bg-(--sg-surface-raised)"
              onClick={() => {
                navigator.clipboard.writeText(deviceCode.userCode).then(
                  () => onToast('Code copied', 'success'),
                  () => onToast('Could not copy to clipboard', 'error'),
                );
              }}
            >
              Copy
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-(--sg-text-dim)">
            <Spinner size="sm" />
            {authPolling ? 'Waiting for authorization…' : 'Opening GitHub…'}
          </div>
        </div>
      ) : (
        <button
          className="inline-flex items-center gap-2 rounded border border-(--sg-border) bg-(--sg-surface-raised) px-3 py-1.5 text-xs text-(--sg-text) hover:bg-(--sg-primary) hover:text-white disabled:opacity-50"
          onClick={() => void startGithubLogin()}
          disabled={authStarting}
        >
          <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.67 0 8.2c0 3.62 2.29 6.7 5.47 7.78.4.08.55-.18.55-.39 0-.2-.01-.85-.01-1.54-2.23.5-2.7-.98-2.7-.98-.36-.95-.9-1.2-.9-1.2-.73-.52.06-.51.06-.51.8.06 1.23.84 1.23.84.72 1.26 1.88.9 2.34.69.07-.54.28-.9.5-1.1-1.78-.21-3.64-.91-3.64-4.06 0-.9.31-1.63.82-2.2-.09-.21-.36-1.04.08-2.17 0 0 .67-.22 2.2.84A7.43 7.43 0 0 1 8 3.46c.68 0 1.37.1 2.01.31 1.53-1.06 2.2-.84 2.2-.84.44 1.13.17 1.96.08 2.17.51.57.82 1.3.82 2.2 0 3.16-1.87 3.84-3.66 4.05.29.26.54.77.54 1.56 0 1.13-.01 2.03-.01 2.31 0 .21.14.47.55.39A8.2 8.2 0 0 0 16 8.2C16 3.67 12.42 0 8 0Z" />
          </svg>
          Sign in with GitHub
        </button>
      )}
    </section>
  );
}
