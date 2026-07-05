import { Plug, Copy, Check } from 'lucide-react';
import { api } from '../api.js';
import { useEffect, useState } from 'react';
import type { McpClientId, McpServerStatus } from '@sproutgit/types';
import type { ToastData } from '@sproutgit/ui';

interface Props {
  onToast: (msg: string, variant?: ToastData['variant']) => void;
  workspacePath: string;
}

const CLIENTS: { id: McpClientId; name: string }[] = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'gemini', name: 'Gemini CLI' },
  { id: 'codex', name: 'Codex CLI' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'kiro', name: 'Kiro' },
];

export function McpSection({ onToast, workspacePath }: Props) {
  const [status, setStatus] = useState<McpServerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [writingClient, setWritingClient] = useState<McpClientId | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!workspacePath) { setLoading(false); return; }
    setLoading(true);
    void api.mcpStatus(workspacePath).then(setStatus).catch(() => undefined).finally(() => setLoading(false));
  }, [workspacePath]);

  async function toggleEnabled() {
    if (!status || busy) return;
    setBusy(true);
    try {
      const next = await api.mcpSetEnabled(workspacePath, !status.enabled);
      setStatus(next);
      onToast(next.enabled ? 'MCP server enabled' : 'MCP server disabled', 'success');
    } catch (err) {
      onToast(String(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function writeConfigFor(client: McpClientId) {
    setWritingClient(client);
    try {
      const result = await api.mcpWriteClientConfig(workspacePath, client);
      onToast(`Wrote MCP config to ${result.configPath}`, 'success');
    } catch (err) {
      onToast(String(err), 'error');
    } finally {
      setWritingClient(null);
    }
  }

  async function copyManualSnippet() {
    try {
      const snippet = await api.mcpGetManualSnippet(workspacePath);
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      onToast('Manual config snippet copied', 'success');
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      onToast(String(err), 'error');
    }
  }

  return (
    <section className="rounded-lg border border-(--sg-border) bg-(--sg-surface)" data-testid="mcp-section">
      <div className="border-b border-(--sg-border) px-5 py-4">
        <h2 className="sg-heading text-sm font-semibold text-(--sg-primary) flex items-center gap-1.5">
          <Plug size={15} /> MCP Server
        </h2>
        <p className="mt-1 text-xs text-(--sg-text-faint)">
          Expose this workspace to MCP-capable agents (list/create worktrees, check status) over a local socket — no network exposure, no token required.
        </p>
      </div>

      {!workspacePath ? (
        <div className="px-5 py-5 text-xs text-(--sg-text-dim)">Open a workspace to configure its MCP server.</div>
      ) : loading ? (
        <div className="px-5 py-5 text-xs text-(--sg-text-dim)">Loading…</div>
      ) : (
        <div className="divide-y divide-(--sg-border)">
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="sg-heading text-xs font-semibold text-(--sg-text)">Enable for this workspace</p>
              <p className="text-[11px] text-(--sg-text-faint)">
                {status?.running && status.socketPath ? `Running at ${status.socketPath}` : 'Not running'}
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-(--sg-text-dim)" data-testid="mcp-enabled-toggle">
              <input
                type="checkbox"
                checked={status?.enabled ?? false}
                disabled={busy}
                onChange={() => void toggleEnabled()}
              />
              {status?.enabled ? 'Enabled' : 'Disabled'}
            </label>
          </div>

          {status?.enabled && status.running && (
            <div className="px-5 py-4">
              <p className="sg-heading text-xs font-semibold text-(--sg-text)">Connect an agent</p>
              <p className="mt-1 text-[11px] text-(--sg-text-faint)">
                Auto-write this workspace's connection into a client's MCP config.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {CLIENTS.map(client => (
                  <button
                    key={client.id}
                    type="button"
                    className="rounded border border-(--sg-border) px-3 py-1.5 text-xs text-(--sg-text) disabled:opacity-50"
                    disabled={writingClient !== null}
                    onClick={() => void writeConfigFor(client.id)}
                    data-testid={`mcp-write-config-${client.id}`}
                  >
                    {writingClient === client.id ? 'Writing…' : client.name}
                  </button>
                ))}
              </div>
              <div className="mt-3 border-t border-(--sg-border-subtle) pt-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded border border-(--sg-border) px-3 py-1.5 text-xs text-(--sg-text-dim)"
                  onClick={() => void copyManualSnippet()}
                  data-testid="mcp-copy-manual-config"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  Copy manual config (any other client)
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
