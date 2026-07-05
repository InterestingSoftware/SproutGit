import { Bot, CheckCircle2, Download, Loader2, RefreshCw } from "lucide-react";
import { api } from "../api.js";
import { useEffect, useRef, useState } from "react";
import { ACP_CAPABLE_TOKENS } from "@sproutgit/types";
import type {
  AcpAdapterStatus,
  AgentConfig,
  AgentInvocationMode,
} from "@sproutgit/types";
import type { ToastData } from "@sproutgit/ui";
import { SettingsToolRow, type ToolPreset } from "./SettingsToolRow.js";
import { tokenizeCommand } from "./command-tokenize.js";

interface Props {
  onToast: (msg: string, variant?: ToastData["variant"]) => void;
}

/** Known agent CLI presets — quick-pick buttons in the row's Edit panel. */
const AGENT_PRESETS: {
  id: string;
  name: string;
  command: string;
  supportsIntegrated: boolean;
}[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    command: "claude",
    supportsIntegrated: true,
  },
  { id: "kiro", name: "Kiro", command: "kiro", supportsIntegrated: true },
  {
    id: "cursor",
    name: "Cursor",
    command: "cursor-agent",
    supportsIntegrated: true,
  },
  {
    id: "codex",
    name: "Codex CLI",
    command: "codex",
    supportsIntegrated: true,
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    command: "gemini",
    supportsIntegrated: true,
  },
];

/** The set of command basenames recognized as ACP-capable, shared with the main process's ACP_PRESETS table via @sproutgit/types so the two can't drift apart. */
const ACP_CAPABLE_TOKEN_SET = new Set(ACP_CAPABLE_TOKENS);

/** Mirrors the main process's commandSupportsIntegratedMode(). */
function commandSupportsIntegratedMode(command: string): boolean {
  const trimmed = command.trim().replace(/^["']|["']$/g, "");
  const token =
    trimmed.split(/\s+/)[0]?.split(/[\\/]/).pop()?.toLowerCase() ?? "";
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

function commandLabel(config: AgentConfig): string {
  if (!config.command.trim()) return "(not set)";
  const preset = AGENT_PRESETS.find((p) => p.command === config.command.trim());
  const base = preset?.name ?? config.command;
  const argsText = config.args.length > 0 ? ` ${config.args.join(" ")}` : "";
  const modeText = config.mode === "integrated" ? "Integrated" : "Terminal";
  return `${base}${argsText} · ${modeText}`;
}

export function AgentsSection({ onToast }: Props) {
  const [config, setConfig] = useState<AgentConfig>({
    command: "",
    args: [],
    mode: "terminal",
  });
  const [customCommand, setCustomCommand] = useState("");
  const [loading, setLoading] = useState(true);
  const [adapterStatus, setAdapterStatus] = useState<AcpAdapterStatus | null>(
    null,
  );
  const [installing, setInstalling] = useState(false);
  const [installMessage, setInstallMessage] = useState("");
  const installingPackageRef = useRef<string | null>(null);
  const installingLabelRef = useRef<string>("Adapter");

  function refreshAdapterStatus() {
    void api
      .getAcpAdapterStatus()
      .then(setAdapterStatus)
      .catch(() => setAdapterStatus(null));
  }

  useEffect(() => {
    void api
      .getAgentConfig()
      .then((c) => {
        setConfig(c);
        setCustomCommand(
          [quoteIfNeeded(c.command), ...c.args].filter(Boolean).join(" "),
        );
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
    refreshAdapterStatus();
  }, []);

  useEffect(() => {
    const off = api.onAcpAdapterInstallProgress((event) => {
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
    return () => {
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const integratedSupported = commandSupportsIntegratedMode(config.command);

  async function persist(next: AgentConfig) {
    // Integrated mode is only valid for a recognized command — fall back to
    // Terminal automatically if the newly selected/typed command doesn't
    // support structured streaming output.
    const safeMode: AgentInvocationMode = commandSupportsIntegratedMode(
      next.command,
    )
      ? next.mode
      : "terminal";
    const toSave: AgentConfig = { ...next, mode: safeMode };
    setConfig(toSave);
    try {
      await api.saveAgentConfig(toSave);
      onToast("AI agent saved", "success");
      refreshAdapterStatus();
    } catch (err) {
      onToast(String(err), "error");
    }
  }

  function installAdapter() {
    if (!adapterStatus || installing) return;
    setInstalling(true);
    setInstallMessage("Starting install…");
    installingPackageRef.current = adapterStatus.npmPackage;
    installingLabelRef.current = adapterStatus.label;
    void api.installAcpAdapter(adapterStatus.npmPackage).catch((err) => {
      setInstalling(false);
      installingPackageRef.current = null;
      onToast(`Install failed: ${String(err)}`, "error");
    });
  }

  function selectPreset(id: string) {
    const preset = AGENT_PRESETS.find((p) => p.id === id);
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

  const presets: ToolPreset[] = AGENT_PRESETS.map((p) => ({
    id: p.id,
    name: p.name,
    active: config.command.trim() === p.command,
  }));

  if (loading) {
    return (
      <div
        className="px-5 py-5 text-xs text-(--sg-text-dim)"
        data-testid="agents-section"
      >
        Loading…
      </div>
    );
  }

  return (
    <div data-testid="agents-section">
      <SettingsToolRow
        testId="agent-row"
        icon={<Bot size={13} />}
        title="AI Agent"
        currentValueLabel={commandLabel(config)}
        presets={presets}
        onSelectPreset={selectPreset}
        customValue={customCommand}
        onCustomValueChange={setCustomCommand}
        customPlaceholder="Command and args, e.g. claude"
        onSaveCustom={saveCustomCommand}
        onTest={() => api.testAgent()}
        onToast={onToast}
        editExtra={
          <>
            <div
              className="flex items-center gap-2"
              data-testid="agent-mode-toggle"
            >
              <span className="text-[11px] font-medium text-(--sg-text-faint)">
                Mode:
              </span>
              <div className="inline-flex rounded-md border border-(--sg-border) p-0.5">
                <button
                  type="button"
                  className={`rounded px-2 py-0.5 text-[11px] cursor-pointer ${config.mode === "integrated" ? "bg-(--sg-primary) text-white" : "text-(--sg-text-dim)"} ${!integratedSupported ? "opacity-40 cursor-not-allowed" : ""}`}
                  onClick={() => integratedSupported && setMode("integrated")}
                  disabled={!integratedSupported}
                  data-testid="btn-agent-mode-integrated"
                  title={
                    integratedSupported
                      ? "Structured chat in the Chat tab"
                      : "This command is not recognized as ACP-capable"
                  }
                >
                  Integrated
                </button>
                <button
                  type="button"
                  className={`rounded px-2 py-0.5 text-[11px] cursor-pointer ${config.mode === "terminal" ? "bg-(--sg-primary) text-white" : "text-(--sg-text-dim)"}`}
                  onClick={() => setMode("terminal")}
                  data-testid="btn-agent-mode-terminal"
                  title="Raw terminal session"
                >
                  Terminal
                </button>
              </div>
              {!integratedSupported && (
                <span className="text-[10px] text-(--sg-text-faint)">
                  Integrated mode requires an ACP-capable agent (Claude Code,
                  Gemini CLI, Codex CLI, Kiro, or Cursor).
                </span>
              )}
            </div>
            {adapterStatus && (
              <div className="space-y-1" data-testid="agent-acp-adapter-row">
                <div className="flex items-center gap-2 text-[11px]">
                  {adapterStatus.installed ? (
                    <span className="flex items-center gap-1 text-(--sg-primary)">
                      <CheckCircle2 size={12} /> {adapterStatus.label} ACP
                      adapter installed
                    </span>
                  ) : (
                    <>
                      <span className="text-(--sg-text-faint)">
                        {adapterStatus.label} ACP mode needs a separate adapter
                        (~{adapterStatus.approxSizeMb}MB) — not installed.
                      </span>
                      {adapterStatus.npmAvailable ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded border border-(--sg-border) px-2 py-0.5 text-[11px] text-(--sg-text-dim) disabled:opacity-50 cursor-pointer bg-transparent"
                          onClick={installAdapter}
                          disabled={installing}
                          data-testid="btn-install-acp-adapter"
                        >
                          {installing ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Download size={11} />
                          )}
                          {installing
                            ? installMessage || "Installing…"
                            : "Install"}
                        </button>
                      ) : (
                        <span className="text-(--sg-danger)">
                          npm not found on PATH — can't install automatically.
                        </span>
                      )}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded border border-(--sg-border) px-1.5 py-0.5 text-[11px] text-(--sg-text-dim) cursor-pointer bg-transparent"
                        onClick={refreshAdapterStatus}
                        title="Re-check (e.g. after installing manually)"
                        data-testid="btn-recheck-acp-adapter"
                      >
                        <RefreshCw size={11} />
                      </button>
                    </>
                  )}
                </div>
                {!adapterStatus.installed && (
                  <p className="text-[10px] text-(--sg-text-faint)">
                    Or install it yourself, globally:{" "}
                    <code className="font-mono text-(--sg-text-dim)">
                      npm install -g {adapterStatus.npmPackage}
                    </code>
                  </p>
                )}
              </div>
            )}
          </>
        }
      />
    </div>
  );
}
