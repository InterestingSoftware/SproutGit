import { Bot, Plus, Trash2, Star } from 'lucide-react';
import { api } from '../api.js';
import { useEffect, useState } from 'react';
import type { AgentRoster, CodingAgent } from '@sproutgit/types';
import type { ToastData } from '@sproutgit/ui';

interface Props {
  onToast: (msg: string, variant?: ToastData['variant']) => void;
}

function randomId() {
  return `agent-${Math.random().toString(36).slice(2, 10)}`;
}

export function AgentsSection({ onToast }: Props) {
  const [roster, setRoster] = useState<AgentRoster>({ agents: [], defaultAgentId: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api.listAgents().then(setRoster).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  function updateAgent(id: string, patch: Partial<CodingAgent>) {
    setRoster(r => ({ ...r, agents: r.agents.map(a => a.id === id ? { ...a, ...patch } : a) }));
  }

  function addAgent() {
    const id = randomId();
    setRoster(r => ({
      ...r,
      agents: [...r.agents, { id, name: 'New Agent', command: '', args: [] }],
      defaultAgentId: r.defaultAgentId ?? id,
    }));
  }

  function removeAgent(id: string) {
    setRoster(r => ({
      agents: r.agents.filter(a => a.id !== id),
      defaultAgentId: r.defaultAgentId === id ? (r.agents.find(a => a.id !== id)?.id ?? null) : r.defaultAgentId,
    }));
  }

  function setDefault(id: string) {
    setRoster(r => ({ ...r, defaultAgentId: id }));
  }

  async function save() {
    setSaving(true);
    try {
      await api.saveAgents(roster);
      onToast('Coding agents saved', 'success');
    } catch (err) {
      onToast(String(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-(--sg-border) bg-(--sg-surface) p-5" data-testid="agents-section">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="sg-heading text-sm font-semibold text-(--sg-primary) flex items-center gap-1.5">
          <Bot size={15} /> Coding Agents
        </h2>
        <button
          type="button"
          className="sg-add-agent-btn inline-flex items-center gap-1 rounded-md border border-(--sg-border) bg-transparent px-2 py-1 text-[11px] text-(--sg-text-dim) hover:bg-(--sg-surface-raised) cursor-pointer"
          onClick={addAgent}
          data-testid="btn-add-agent"
        >
          <Plus size={12} /> Add agent
        </button>
      </div>

      {loading ? (
        <div className="text-xs text-(--sg-text-dim)">Loading…</div>
      ) : (
        <div className="flex flex-col gap-2">
          {roster.agents.map(agent => (
            <div key={agent.id} className="sg-agent-row flex flex-col gap-1.5 rounded-md border border-(--sg-border) p-2.5" data-testid="agent-row">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDefault(agent.id)}
                  className="shrink-0 border-none bg-transparent cursor-pointer p-0.5"
                  title={roster.defaultAgentId === agent.id ? 'Default agent' : 'Set as default'}
                  aria-label="Set as default agent"
                  data-testid="btn-set-default-agent"
                >
                  <Star size={13} className={roster.defaultAgentId === agent.id ? 'fill-(--sg-warning) text-(--sg-warning)' : 'text-(--sg-text-faint)'} />
                </button>
                <input
                  value={agent.name}
                  onChange={e => updateAgent(agent.id, { name: e.target.value })}
                  placeholder="Name"
                  className="min-w-0 flex-1 rounded border border-(--sg-border) bg-(--sg-input-bg) px-2 py-1 text-xs text-(--sg-text)"
                  data-testid="input-agent-name"
                />
                <button
                  type="button"
                  onClick={() => removeAgent(agent.id)}
                  className="shrink-0 rounded p-1 text-(--sg-text-dim) hover:text-(--sg-danger) border-none cursor-pointer bg-transparent"
                  title="Remove agent"
                  aria-label="Remove agent"
                  data-testid="btn-remove-agent"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={agent.command}
                  onChange={e => updateAgent(agent.id, { command: e.target.value })}
                  placeholder="Command (e.g. claude)"
                  className="min-w-0 flex-1 rounded border border-(--sg-border) bg-(--sg-input-bg) px-2 py-1 text-xs font-mono text-(--sg-text)"
                  data-testid="input-agent-command"
                />
                <input
                  value={agent.args.join(' ')}
                  onChange={e => updateAgent(agent.id, { args: e.target.value.split(/\s+/).filter(Boolean) })}
                  placeholder="Args (space-separated)"
                  className="min-w-0 flex-1 rounded border border-(--sg-border) bg-(--sg-input-bg) px-2 py-1 text-xs font-mono text-(--sg-text)"
                  data-testid="input-agent-args"
                />
              </div>
            </div>
          ))}

          {roster.agents.length === 0 && (
            <p className="text-[11px] text-(--sg-text-faint)">No agents configured yet.</p>
          )}

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="mt-1 inline-flex w-fit items-center gap-1 rounded-md bg-(--sg-primary) px-3 py-1.5 text-xs font-medium text-white hover:bg-(--sg-primary-hover) disabled:opacity-50 cursor-pointer border-none"
            data-testid="btn-save-agents"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      )}
    </section>
  );
}
