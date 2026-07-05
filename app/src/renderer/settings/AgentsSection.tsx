import { Bot } from 'lucide-react';
import { api } from '../api.js';
import { useEffect, useState } from 'react';
import type { AgentConfig, AgentInvocationMode } from '@sproutgit/types';
import type { ToastData } from '@sproutgit/ui';
import { SettingsToolRow, type ToolPreset } from './SettingsToolRow.js';

interface Props {
  onToast: (msg: string, variant?: ToastData['variant']) => void;
}

/** Known agent CLI presets — quick-pick buttons in the row's Edit panel. */
const AGENT_PRESETS: { id: string; name: string; command: string; supportsIntegrated: boolean }[] = [
  { id: 'claude-code', name: 'Claude Code', command: 'claude', supportsIntegrated: true },
  { id: 'kiro', name: 'Kiro', command: 'kiro', supportsIntegrated: true },
  { id: 'cursor', name: 'Cursor', command: 'cursor-agent', supportsIntegrated: true },
  { id: 'codex', name: 'Codex CLI', command: 'codex', supportsIntegrated: true },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini', supportsIntegrated: true },
];

/** The set of command basenames recognized as ACP-capable — mirrors the main process's ACP_PRESETS table in agents.ts. */
const ACP_CAPABLE_TOKENS = new Set(['claude', 'claude-code', 'gemini', 'codex', 'kiro', 'kiro-cli', 'cursor-agent']);

/** Mirrors the main process's commandSupportsIntegratedMode(). */
function commandSupportsIntegratedMode(command: string): boolean {
  const trimmed = command.trim().replace(/^["']|["']$/g, '');
  const token = trimmed.split(/\s+/)[0]?.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  return ACP_CAPABLE_TOKENS.has(token);
}

/**
 * Splits a stored command string into a binary + args, honoring a leading
 * quoted path (e.g. `"C:\Program Files\Claude\claude.exe" --flag`) — mirrors
 * the main process's splitCommand() in tool-test-helpers.ts (duplicated here
 * since the renderer can't import main-process code across the IPC
 * boundary). A naive whitespace split on the whole string would otherwise
 * break any command path containing spaces, common on Windows.
 */
function splitCommand(raw: string): { command: string; args: string[] } {
  const trimmed = raw.trim();
  if (!trimmed) return { command: '', args: [] };
  const quotedMatch = /^"([^"]+)"\s*(.*)$/.exec(trimmed) ?? /^'([^']+)'\s*(.*)$/.exec(trimmed);
  if (quotedMatch) {
    const rest = (quotedMatch[2] ?? '').trim();
    return { command: quotedMatch[1]!, args: rest ? rest.split(/\s+/) : [] };
  }
  const parts = trimmed.split(/\s+/);
  return { command: parts[0]!, args: parts.slice(1) };
}

/** Quotes `command` if it contains whitespace, so re-parsing it with splitCommand() round-trips correctly. */
function quoteIfNeeded(command: string): string {
  return command.includes(' ') ? `"${command}"` : command;
}

function commandLabel(config: AgentConfig): string {
  if (!config.command.trim()) return '(not set)';
  const preset = AGENT_PRESETS.find(p => p.command === config.command.trim());
  const base = preset?.name ?? config.command;
  const argsText = config.args.length > 0 ? ` ${config.args.join(' ')}` : '';
  return `${base}${argsText}`;
}

export function AgentsSection({ onToast }: Props) {
  const [config, setConfig] = useState<AgentConfig>({ command: '', args: [], mode: 'terminal' });
  const [customCommand, setCustomCommand] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api.getAgentConfig().then(c => {
      setConfig(c);
      setCustomCommand([quoteIfNeeded(c.command), ...c.args].filter(Boolean).join(' '));
    }).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  const integratedSupported = commandSupportsIntegratedMode(config.command);

  async function persist(next: AgentConfig) {
    // Integrated mode is only valid for a recognized command — fall back to
    // Terminal automatically if the newly selected/typed command doesn't
    // support structured streaming output.
    const safeMode: AgentInvocationMode = commandSupportsIntegratedMode(next.command) ? next.mode : 'terminal';
    const toSave: AgentConfig = { ...next, mode: safeMode };
    setConfig(toSave);
    try {
      await api.saveAgentConfig(toSave);
      onToast('AI agent saved', 'success');
    } catch (err) {
      onToast(String(err), 'error');
    }
  }

  function selectPreset(id: string) {
    const preset = AGENT_PRESETS.find(p => p.id === id);
    if (!preset) return;
    setCustomCommand(preset.command);
    void persist({ ...config, command: preset.command, args: [] });
  }

  function saveCustomCommand() {
    const { command, args } = splitCommand(customCommand);
    void persist({ ...config, command, args });
  }

  function setMode(mode: AgentInvocationMode) {
    void persist({ ...config, mode });
  }

  const presets: ToolPreset[] = AGENT_PRESETS.map(p => ({
    id: p.id,
    name: p.name,
    active: config.command.trim() === p.command,
  }));

  return (
    <section className="rounded-lg border border-(--sg-border) bg-(--sg-surface)" data-testid="agents-section">
      <div className="border-b border-(--sg-border) px-5 py-4">
        <h2 className="sg-heading text-sm font-semibold text-(--sg-primary) flex items-center gap-1.5">
          <Bot size={15} /> AI Agent
        </h2>
        <p className="mt-1 text-xs text-(--sg-text-faint)">
          Configure the single AI coding agent SproutGit launches for you — same as your editor or diff tool.
        </p>
      </div>

      {loading ? (
        <div className="px-5 py-5 text-xs text-(--sg-text-dim)">Loading…</div>
      ) : (
        <SettingsToolRow
          testId="agent-row"
          icon={<Bot size={13} />}
          title="Agent Command"
          currentValueLabel={commandLabel(config)}
          presets={presets}
          onSelectPreset={selectPreset}
          customValue={customCommand}
          onCustomValueChange={setCustomCommand}
          customPlaceholder="Command and args, e.g. claude"
          onSaveCustom={saveCustomCommand}
          onTest={() => api.testAgent()}
          onToast={onToast}
          belowSummary={
            <div className="mt-2 flex items-center gap-2" data-testid="agent-mode-toggle">
              <span className="text-[11px] font-medium text-(--sg-text-faint)">Mode:</span>
              <div className="inline-flex rounded-md border border-(--sg-border) p-0.5">
                <button
                  type="button"
                  className={`rounded px-2 py-0.5 text-[11px] cursor-pointer ${config.mode === 'integrated' ? 'bg-(--sg-primary) text-white' : 'text-(--sg-text-dim)'} ${!integratedSupported ? 'opacity-40 cursor-not-allowed' : ''}`}
                  onClick={() => integratedSupported && setMode('integrated')}
                  disabled={!integratedSupported}
                  data-testid="btn-agent-mode-integrated"
                  title={integratedSupported ? 'Structured chat in the Chat tab' : 'This command is not recognized as ACP-capable'}
                >
                  Integrated
                </button>
                <button
                  type="button"
                  className={`rounded px-2 py-0.5 text-[11px] cursor-pointer ${config.mode === 'terminal' ? 'bg-(--sg-primary) text-white' : 'text-(--sg-text-dim)'}`}
                  onClick={() => setMode('terminal')}
                  data-testid="btn-agent-mode-terminal"
                  title="Raw terminal session"
                >
                  Terminal
                </button>
              </div>
              {!integratedSupported && (
                <span className="text-[10px] text-(--sg-text-faint)">Integrated mode requires an ACP-capable agent (Claude Code, Gemini CLI, Codex CLI, Kiro, or Cursor).</span>
              )}
            </div>
          }
        />
      )}
    </section>
  );
}
