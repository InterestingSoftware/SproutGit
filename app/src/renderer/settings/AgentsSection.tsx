import {
  Bot,
  CheckCircle2,
  Download,
  FlaskConical,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { api } from "../api.js";
import { useEffect, useRef, useState } from "react";
import { ACP_CAPABLE_TOKENS } from "@sproutgit/types";
import type {
  AcpAdapterStatus,
  AgentInvocationMode,
  AgentRoster,
  AgentRosterEntry,
  AgentTestInput,
  ToolTestResult,
} from "@sproutgit/types";
import type { ToastData } from "@sproutgit/ui";
import { tokenizeCommand } from "./command-tokenize.js";

interface Props {
  onToast: (msg: string, variant?: ToastData["variant"]) => void;
}

/** Known agent CLI presets — quick-add buttons that append a roster entry. */
const AGENT_PRESETS: { id: string; name: string; command: string; supportsIntegrated: boolean }[] = [
  { id: "claude-code", name: "Claude Code", command: "claude", supportsIntegrated: true },
  { id: "kiro", name: "Kiro", command: "kiro", supportsIntegrated: true },
  { id: "cursor", name: "Cursor", command: "cursor-agent", supportsIntegrated: true },
  { id: "codex", name: "Codex CLI", command: "codex", supportsIntegrated: true },
  { id: "gemini", name: "Gemini CLI", command: "gemini", supportsIntegrated: true },
];

/** The set of command basenames recognized as ACP-capable, shared with the main process's ACP_PRESETS table via @sproutgit/types so the two can't drift apart. */
const ACP_CAPABLE_TOKEN_SET = new Set(ACP_CAPABLE_TOKENS);

/**
 * Mirrors the main process's commandSupportsIntegratedMode(). `command` is
 * always just the binary (args live separately), so this takes the path's
 * basename directly rather than splitting on whitespace first — a
 * whitespace split would break an absolute path containing spaces (common
 * on Windows, e.g. `C:\Program Files\...\claude.exe`).
 */
function commandSupportsIntegratedMode(command: string): boolean {
  const trimmed = command.trim().replace(/^["']|["']$/g, "");
  const token = trimmed.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return ACP_CAPABLE_TOKEN_SET.has(token);
}

/** Splits a stored command string into a binary + args — see tokenizeCommand(). */
function splitCommand(raw: string): { command: string; args: string[] } {
  const tokens = tokenizeCommand(raw.trim());
  return { command: tokens[0] ?? "", args: tokens.slice(1) };
}

/** Quotes `command` if it contains whitespace, so re-parsing it with splitCommand() round-trips correctly. */
function quoteIfNeeded(command: string): string {
  return command.includes(" ") ? `"${command}"` : command;
}

function commandText(agent: Pick<AgentRosterEntry, "command" | "args">): string {
  return [quoteIfNeeded(agent.command), ...agent.args].filter(Boolean).join(" ");
}

function summaryLabel(agent: AgentRosterEntry): string {
  if (!agent.command.trim()) return "(not set)";
  const argsText = agent.args.length > 0 ? ` ${agent.args.join(" ")}` : "";
  const modeText = agent.mode === "integrated" ? "Integrated" : "Terminal";
  return `${agent.command}${argsText} · ${modeText}`;
}

function newAgentId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `agent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function blankAgent(): AgentRosterEntry {
  return { id: newAgentId(), name: "New Agent", command: "", args: [], env: {}, mode: "terminal", acp: false };
}

type EnvPair = { key: string; value: string };

function envToPairs(env: Record<string, string>): EnvPair[] {
  return Object.entries(env).map(([key, value]) => ({ key, value }));
}

function pairsToEnv(pairs: EnvPair[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const { key, value } of pairs) {
    if (key.trim()) env[key.trim()] = value;
  }
  return env;
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Loosely validates an imported agent entry, filling in safe defaults for anything missing so a hand-edited or partial JSON file still imports. */
function sanitizeImportedAgent(value: unknown): Omit<AgentRosterEntry, "id"> | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v["command"] !== "string") return null;
  const args = Array.isArray(v["args"]) ? v["args"].filter((a): a is string => typeof a === "string") : [];
  const env =
    v["env"] && typeof v["env"] === "object"
      ? Object.fromEntries(Object.entries(v["env"] as Record<string, unknown>).filter(([, val]) => typeof val === "string")) as Record<string, string>
      : {};
  const mode: AgentInvocationMode = v["mode"] === "integrated" ? "integrated" : "terminal";
  return {
    name: typeof v["name"] === "string" && v["name"].trim() ? v["name"] : v["command"],
    command: v["command"],
    args,
    env,
    mode,
    acp: v["acp"] === true,
  };
}

interface RowProps {
  agent: AgentRosterEntry;
  isDefault: boolean;
  canDelete: boolean;
  onSave: (agent: AgentRosterEntry) => Promise<void>;
  onDelete: () => Promise<void>;
  onSetDefault: () => Promise<void>;
  onToast: (msg: string, variant?: ToastData["variant"]) => void;
  testId: string;
}

function AgentRow({ agent, isDefault, canDelete, onSave, onDelete, onSetDefault, onToast, testId }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(agent.name);
  const [customCommand, setCustomCommand] = useState(commandText(agent));
  const [mode, setMode] = useState<AgentInvocationMode>(agent.mode);
  const [acp, setAcp] = useState(agent.acp);
  const [envPairs, setEnvPairs] = useState<EnvPair[]>(envToPairs(agent.env));
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ToolTestResult | null>(null);
  const [adapterStatus, setAdapterStatus] = useState<AcpAdapterStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installMessage, setInstallMessage] = useState("");
  const installingPackageRef = useRef<string | null>(null);
  const installingLabelRef = useRef<string>("Adapter");

  const draftCommand = splitCommand(customCommand).command;
  const integratedSupported = commandSupportsIntegratedMode(draftCommand) || acp;
  const isRecognizedPreset = commandSupportsIntegratedMode(draftCommand);

  function refreshAdapterStatus() {
    void api.getAcpAdapterStatus(agent.id).then(setAdapterStatus).catch(() => setAdapterStatus(null));
  }

  useEffect(() => {
    if (!editing) return;
    refreshAdapterStatus();
    const off = api.onAcpAdapterInstallProgress(event => {
      if (event.npmPackage !== installingPackageRef.current) return;
      setInstallMessage(event.message);
      if (event.status === "done") {
        setInstalling(false);
        installingPackageRef.current = null;
        onToast(`${installingLabelRef.current} installed`, "success");
        refreshAdapterStatus();
      } else if (event.status === "error") {
        setInstalling(false);
        installingPackageRef.current = null;
        onToast(`Install failed: ${event.message}`, "error");
      }
    });
    return () => { off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function beginEdit() {
    setName(agent.name);
    setCustomCommand(commandText(agent));
    setMode(agent.mode);
    setAcp(agent.acp);
    setEnvPairs(envToPairs(agent.env));
    setTestResult(null);
    setEditing(true);
  }

  async function save() {
    const { command, args } = splitCommand(customCommand);
    const safeAcp = commandSupportsIntegratedMode(command) || acp;
    const safeMode: AgentInvocationMode = safeAcp ? mode : "terminal";
    const updated: AgentRosterEntry = {
      ...agent,
      name: name.trim() || command || "Agent",
      command,
      args,
      env: pairsToEnv(envPairs),
      mode: safeMode,
      acp: commandSupportsIntegratedMode(command) ? true : acp,
    };
    try {
      await onSave(updated);
      onToast("Agent saved", "success");
    } catch (err) {
      onToast(String(err), "error");
    }
  }

  async function runTest() {
    const { command, args } = splitCommand(customCommand);
    const input: AgentTestInput = { name: name.trim() || command, command, args, env: pairsToEnv(envPairs), acp: commandSupportsIntegratedMode(command) || acp };
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testAgent(input);
      setTestResult(result);
      const headline = result.ok ? `${input.name}: test passed` : `${input.name}: test failed`;
      const parts = [result.detail, result.error];
      if (result.acp) parts.push(`Capabilities: ${result.acp.capabilities.join(", ") || "none reported"}`);
      const body = parts.filter(Boolean).join(" — ");
      onToast(body ? `${headline} — ${body}` : headline, result.ok ? "success" : "error");
    } catch (err) {
      setTestResult({ ok: false, resolvedCommand: "", detail: "", error: String(err) });
      onToast(`Test failed — ${String(err)}`, "error");
    } finally {
      setTesting(false);
    }
  }

  function installAdapter() {
    if (!adapterStatus || installing) return;
    setInstalling(true);
    setInstallMessage("Starting install…");
    installingPackageRef.current = adapterStatus.npmPackage;
    installingLabelRef.current = adapterStatus.label;
    void api.installAcpAdapter(adapterStatus.npmPackage).catch(err => {
      setInstalling(false);
      installingPackageRef.current = null;
      onToast(`Install failed: ${String(err)}`, "error");
    });
  }

  return (
    <div className="px-5 py-4" data-testid={testId}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex gap-2.5 min-w-0">
          <div className="mt-0.5 shrink-0 text-(--sg-text-faint)">
            <Bot size={13} />
          </div>
          <div className="min-w-0">
            <p className="sg-heading text-xs font-semibold text-(--sg-text) flex items-center gap-1.5">
              {agent.name}
              {isDefault && (
                <span className="inline-flex items-center gap-0.5 rounded bg-(--sg-primary)/15 px-1.5 py-0.5 text-[9px] font-medium text-(--sg-primary)">
                  <Star size={9} fill="currentColor" /> Default
                </span>
              )}
            </p>
            <p className="text-[11px] text-(--sg-text-faint) truncate">{summaryLabel(agent)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!isDefault && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-(--sg-border) px-2 py-1 text-xs text-(--sg-text-dim) cursor-pointer bg-transparent"
              onClick={() => void onSetDefault()}
              title="Make default"
              data-testid={`${testId}-btn-set-default`}
            >
              <Star size={12} />
            </button>
          )}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-(--sg-border) px-2.5 py-1 text-xs text-(--sg-text-dim) disabled:opacity-50 cursor-pointer bg-transparent"
            onClick={() => void runTest()}
            disabled={testing}
            data-testid={`${testId}-btn-test`}
          >
            {testing ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />} Test
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-(--sg-border) px-2.5 py-1 text-xs text-(--sg-text-dim) cursor-pointer bg-transparent"
            onClick={() => (editing ? setEditing(false) : beginEdit())}
            data-testid={`${testId}-btn-edit`}
          >
            {editing ? (
              "Done"
            ) : (
              <>
                <Pencil size={12} /> Edit
              </>
            )}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-(--sg-border) px-2 py-1 text-xs text-(--sg-danger) disabled:opacity-30 cursor-pointer bg-transparent"
            onClick={() => void onDelete()}
            disabled={!canDelete}
            title={canDelete ? "Delete agent" : "At least one agent is required"}
            data-testid={`${testId}-btn-delete`}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {testResult && (
        <div
          className={`mt-2 rounded border px-2.5 py-2 text-[11px] ${testResult.ok ? "border-(--sg-primary)/30 bg-(--sg-primary)/8 text-(--sg-text)" : "border-(--sg-danger)/30 bg-(--sg-danger)/8 text-(--sg-text)"}`}
          data-testid={`${testId}-test-result`}
        >
          <div className="flex items-center gap-1.5 font-semibold">
            {testResult.ok ? <CheckCircle2 size={12} className="text-(--sg-primary)" /> : <XCircle size={12} className="text-(--sg-danger)" />}
            {testResult.ok ? "Test passed" : "Test failed"}
          </div>
          {testResult.resolvedCommand && <p className="mt-1 font-mono text-[10px] text-(--sg-text-dim) break-all">{testResult.resolvedCommand}</p>}
          {testResult.detail && <p className="mt-1 text-(--sg-text-dim)">{testResult.detail}</p>}
          {testResult.acp && (
            <p className="mt-1 text-(--sg-text-dim)">
              ACP agent: {testResult.acp.name}
              {testResult.acp.version ? ` v${testResult.acp.version}` : ""} — capabilities: {testResult.acp.capabilities.join(", ") || "none reported"}
            </p>
          )}
          {testResult.error && <p className="mt-1 text-(--sg-danger)">{testResult.error}</p>}
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-3 border-t border-(--sg-border) pt-3">
          <div className="flex gap-2">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-40 shrink-0 rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-2.5 py-1.5 text-xs text-(--sg-text)"
              placeholder="Name"
              data-testid={`${testId}-input-name`}
            />
            <input
              value={customCommand}
              onChange={e => setCustomCommand(e.target.value)}
              className="min-w-0 flex-1 rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-2.5 py-1.5 font-mono text-xs text-(--sg-text)"
              placeholder="Command and args, e.g. claude"
              data-testid={`${testId}-input-custom`}
            />
          </div>

          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-(--sg-text-faint)">Environment variables</p>
            <div className="space-y-1.5">
              {envPairs.map((pair, i) => (
                <div key={i} className="flex gap-1.5">
                  <input
                    value={pair.key}
                    onChange={e => setEnvPairs(prev => prev.map((p, idx) => (idx === i ? { ...p, key: e.target.value } : p)))}
                    className="w-36 rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-2 py-1 font-mono text-[11px] text-(--sg-text)"
                    placeholder="KEY"
                    data-testid={`${testId}-env-key-${i}`}
                  />
                  <input
                    value={pair.value}
                    onChange={e => setEnvPairs(prev => prev.map((p, idx) => (idx === i ? { ...p, value: e.target.value } : p)))}
                    className="min-w-0 flex-1 rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-2 py-1 font-mono text-[11px] text-(--sg-text)"
                    placeholder="value"
                    data-testid={`${testId}-env-value-${i}`}
                  />
                  <button
                    type="button"
                    className="rounded border border-(--sg-border) px-2 text-(--sg-text-dim) cursor-pointer bg-transparent"
                    onClick={() => setEnvPairs(prev => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-(--sg-border) px-2 py-1 text-[11px] text-(--sg-text-dim) cursor-pointer bg-transparent"
                onClick={() => setEnvPairs(prev => [...prev, { key: "", value: "" }])}
                data-testid={`${testId}-btn-add-env`}
              >
                <Plus size={11} /> Add variable
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2" data-testid={`${testId}-mode-toggle`}>
            <span className="text-[11px] font-medium text-(--sg-text-faint)">Mode:</span>
            <div className="inline-flex rounded-md border border-(--sg-border) p-0.5">
              <button
                type="button"
                className={`rounded px-2 py-0.5 text-[11px] cursor-pointer ${mode === "integrated" ? "bg-(--sg-primary) text-white" : "text-(--sg-text-dim)"} ${!integratedSupported ? "opacity-40 cursor-not-allowed" : ""}`}
                onClick={() => integratedSupported && setMode("integrated")}
                disabled={!integratedSupported}
                data-testid={`${testId}-btn-mode-integrated`}
                title={integratedSupported ? "Structured chat in the Chat tab" : "Flag this command as ACP-capable to enable Integrated mode"}
              >
                Integrated
              </button>
              <button
                type="button"
                className={`rounded px-2 py-0.5 text-[11px] cursor-pointer ${mode === "terminal" ? "bg-(--sg-primary) text-white" : "text-(--sg-text-dim)"}`}
                onClick={() => setMode("terminal")}
                data-testid={`${testId}-btn-mode-terminal`}
              >
                Terminal
              </button>
            </div>
            {!isRecognizedPreset && (
              <label className="flex items-center gap-1 text-[11px] text-(--sg-text-dim)">
                <input type="checkbox" checked={acp} onChange={e => setAcp(e.target.checked)} data-testid={`${testId}-checkbox-acp`} />
                Speaks ACP
              </label>
            )}
            {isRecognizedPreset && <span className="text-[10px] text-(--sg-text-faint)">Recognized ACP preset</span>}
          </div>

          {adapterStatus && (
            <div className="space-y-1" data-testid={`${testId}-acp-adapter-row`}>
              <div className="flex items-center gap-2 text-[11px]">
                {adapterStatus.installed ? (
                  <span className="flex items-center gap-1 text-(--sg-primary)">
                    <CheckCircle2 size={12} /> {adapterStatus.label} ACP adapter installed
                  </span>
                ) : (
                  <>
                    <span className="text-(--sg-text-faint)">
                      {adapterStatus.label} ACP mode needs a separate adapter (~{adapterStatus.approxSizeMb}MB) — not installed.
                    </span>
                    {adapterStatus.npmAvailable ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded border border-(--sg-border) px-2 py-0.5 text-[11px] text-(--sg-text-dim) disabled:opacity-50 cursor-pointer bg-transparent"
                        onClick={installAdapter}
                        disabled={installing}
                        data-testid={`${testId}-btn-install-acp-adapter`}
                      >
                        {installing ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                        {installing ? installMessage || "Installing…" : "Install"}
                      </button>
                    ) : (
                      <span className="text-(--sg-danger)">npm not found on PATH — can't install automatically.</span>
                    )}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded border border-(--sg-border) px-1.5 py-0.5 text-[11px] text-(--sg-text-dim) cursor-pointer bg-transparent"
                      onClick={refreshAdapterStatus}
                      title="Re-check (e.g. after installing manually)"
                    >
                      <RefreshCw size={11} />
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          <button
            type="button"
            className="rounded border border-(--sg-border) px-3 py-1.5 text-xs text-(--sg-text) cursor-pointer bg-transparent"
            onClick={() => void save()}
            data-testid={`${testId}-btn-save`}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

export function AgentsSection({ onToast }: Props) {
  const [roster, setRoster] = useState<AgentRoster | null>(null);
  const [loading, setLoading] = useState(true);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void api
      .getAgentRoster()
      .then(setRoster)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  async function persist(next: AgentRoster) {
    setRoster(next);
    await api.saveAgentRoster(next);
  }

  async function saveAgent(updated: AgentRosterEntry) {
    if (!roster) return;
    const next = { ...roster, agents: roster.agents.map(a => (a.id === updated.id ? updated : a)) };
    await persist(next);
  }

  async function deleteAgent(id: string) {
    if (!roster || roster.agents.length <= 1) return;
    const agents = roster.agents.filter(a => a.id !== id);
    const defaultAgentId = roster.defaultAgentId === id ? agents[0]!.id : roster.defaultAgentId;
    try {
      await persist({ agents, defaultAgentId });
      onToast("Agent removed", "success");
    } catch (err) {
      onToast(String(err), "error");
    }
  }

  async function setDefault(id: string) {
    if (!roster) return;
    try {
      await persist({ ...roster, defaultAgentId: id });
      onToast("Default agent updated", "success");
    } catch (err) {
      onToast(String(err), "error");
    }
  }

  async function addPreset(presetId: string) {
    if (!roster) return;
    const preset = AGENT_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    const entry: AgentRosterEntry = {
      id: newAgentId(),
      name: preset.name,
      command: preset.command,
      args: [],
      env: {},
      mode: preset.supportsIntegrated ? "integrated" : "terminal",
      acp: preset.supportsIntegrated,
    };
    try {
      await persist({ ...roster, agents: [...roster.agents, entry] });
      onToast(`${preset.name} added`, "success");
    } catch (err) {
      onToast(String(err), "error");
    }
  }

  async function addCustom() {
    if (!roster) return;
    const entry = blankAgent();
    try {
      await persist({ ...roster, agents: [...roster.agents, entry] });
    } catch (err) {
      onToast(String(err), "error");
    }
  }

  function exportAgents() {
    if (!roster) return;
    downloadJson("sproutgit-agents.json", { agents: roster.agents });
  }

  function triggerImport() {
    importInputRef.current?.click();
  }

  async function handleImportFile(file: File) {
    if (!roster) return;
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const rawAgents = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { agents?: unknown[] })?.agents) ? (parsed as { agents: unknown[] }).agents : null;
      if (!rawAgents) throw new Error("Expected a JSON array of agents, or an object with an \"agents\" array.");
      const imported = rawAgents.map(sanitizeImportedAgent).filter((a): a is Omit<AgentRosterEntry, "id"> => a !== null);
      if (imported.length === 0) throw new Error("No valid agent entries found in the file.");
      const withIds: AgentRosterEntry[] = imported.map(a => ({ ...a, id: newAgentId() }));
      await persist({ ...roster, agents: [...roster.agents, ...withIds] });
      onToast(`Imported ${withIds.length} agent${withIds.length === 1 ? "" : "s"}`, "success");
    } catch (err) {
      onToast(`Import failed: ${String(err instanceof Error ? err.message : err)}`, "error");
    }
  }

  if (loading || !roster) {
    return (
      <div className="px-5 py-5 text-xs text-(--sg-text-dim)" data-testid="agents-section">
        Loading…
      </div>
    );
  }

  return (
    <div data-testid="agents-section">
      <div className="flex items-center justify-between gap-2 px-5 py-3">
        <div className="flex flex-wrap gap-2">
          {AGENT_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              className="rounded border border-(--sg-border) px-3 py-1.5 text-xs text-(--sg-text-dim) cursor-pointer bg-transparent"
              onClick={() => void addPreset(preset.id)}
              data-testid={`btn-add-preset-${preset.id}`}
            >
              + {preset.name}
            </button>
          ))}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-(--sg-border) px-3 py-1.5 text-xs text-(--sg-text-dim) cursor-pointer bg-transparent"
            onClick={() => void addCustom()}
            data-testid="btn-add-agent"
          >
            <Plus size={12} /> Custom
          </button>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-(--sg-border) px-2.5 py-1 text-xs text-(--sg-text-dim) cursor-pointer bg-transparent"
            onClick={exportAgents}
            data-testid="btn-export-agents"
          >
            <Download size={12} /> Export
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-(--sg-border) px-2.5 py-1 text-xs text-(--sg-text-dim) cursor-pointer bg-transparent"
            onClick={triggerImport}
            data-testid="btn-import-agents"
          >
            <Upload size={12} /> Import
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            data-testid="input-import-agents"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) void handleImportFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="divide-y divide-(--sg-border)" data-testid="agent-list">
        {roster.agents.map((agent, i) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            isDefault={agent.id === roster.defaultAgentId}
            canDelete={roster.agents.length > 1}
            onSave={saveAgent}
            onDelete={() => deleteAgent(agent.id)}
            onSetDefault={() => setDefault(agent.id)}
            onToast={onToast}
            testId={i === 0 ? "agent-row" : `agent-row-${agent.id}`}
          />
        ))}
      </div>
    </div>
  );
}
