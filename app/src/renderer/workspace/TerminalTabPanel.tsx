import { useState, type CSSProperties, type MutableRefObject } from "react";
import { TerminalPane } from "@sproutgit/ui";
import {
  Plus,
  ChevronDown,
  Rows3,
  Columns2,
  LayoutGrid,
  X,
} from "lucide-react";
import { api } from "../api.js";
import { useWorkspaceStore } from "../stores/workspace-store.js";

type TerminalSession = ReturnType<
  typeof useWorkspaceStore.getState
>["terminalSessions"][number];

type Props = {
  workspacePath: string;
  activeWorktreePath: string | undefined;
  visibleSessions: TerminalSession[];
  activeTerminalId: string | null;
  terminalLayout: "tabs" | "split" | "grid";
  availableShells: { name: string; path: string }[];
  renamingTerminalId: string | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
  renameInputRef: MutableRefObject<HTMLInputElement | null>;
  onOpenTerminal: (cwd: string, label?: string, shellOverride?: string) => void;
  onCloseTerminal: (id: string) => void;
  onOpenTerminalTabMenu: (e: React.MouseEvent, sessionId: string) => void;
  onSelectTerminal: (id: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onSetLayout: (layout: "tabs" | "split" | "grid") => void;
  terminalPanelStyle: (id: string) => CSSProperties;
  terminalWrapperClass: () => string;
};

/** Terminal tab: session tab bar (rename/menu/shell picker) plus the PTY panes. */
export function TerminalTabPanel({
  workspacePath,
  activeWorktreePath,
  visibleSessions,
  activeTerminalId,
  terminalLayout,
  availableShells,
  renamingTerminalId,
  renameValue,
  setRenameValue,
  renameInputRef,
  onOpenTerminal,
  onCloseTerminal,
  onOpenTerminalTabMenu,
  onSelectTerminal,
  onCommitRename,
  onCancelRename,
  onSetLayout,
  terminalPanelStyle,
  terminalWrapperClass,
}: Props) {
  const [showShellPicker, setShowShellPicker] = useState(false);

  return (
    <div className="flex flex-col h-full">
      <div className="flex min-h-8 shrink-0 items-center gap-1 border-b border-(--sg-border) bg-(--sg-bg) px-1.5">
        <div
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-0.5"
          role="tablist"
          aria-label="Terminal sessions"
        >
          {visibleSessions.map((s) => {
            const isActive = s.id === activeTerminalId;
            const isRenaming = s.id === renamingTerminalId;
            return (
              <div
                key={s.id}
                className={`group relative flex shrink-0 items-center overflow-hidden rounded ${isActive ? "bg-(--sg-surface-raised)" : "hover:bg-(--sg-surface)"}`}
                onContextMenu={(e) => onOpenTerminalTabMenu(e, s.id)}
              >
                {isActive && (
                  <span className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded-t-full bg-(--sg-primary) shadow-[0_0_6px_var(--sg-primary)]" />
                )}
                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    data-testid="input-rename-terminal"
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={onCommitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onCommitRename();
                      if (e.key === "Escape") onCancelRename();
                      e.stopPropagation();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="min-w-0 w-25 rounded bg-(--sg-input-bg) px-2 py-1 text-[11px] font-medium text-(--sg-text) outline-(--sg-primary)"
                  />
                ) : (
                  <button
                    data-testid="terminal-session-tab"
                    data-session-label={s.label}
                    role="tab"
                    aria-selected={isActive}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium ${isActive ? "text-(--sg-primary)" : "text-(--sg-text)"}`}
                    onClick={() => onSelectTerminal(s.id)}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? "bg-(--sg-primary)" : "bg-(--sg-text-faint)"}`}
                    />
                    <span className="max-w-35 truncate">{s.label}</span>
                  </button>
                )}
                <button
                  className="flex items-center px-1.5 py-1.5 text-(--sg-text-dim) transition-colors hover:text-(--sg-danger)"
                  title={`Close ${s.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTerminal(s.id);
                  }}
                >
                  <X size={10} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="relative inline-flex shrink-0 items-stretch rounded bg-(--sg-bg)">
          <button
            data-testid="btn-add-terminal"
            title="New terminal"
            className="flex items-center rounded-l px-2 py-1 text-(--sg-text-faint) transition-colors hover:bg-(--sg-surface-raised) hover:text-(--sg-text-dim)"
            onClick={() => onOpenTerminal(activeWorktreePath ?? workspacePath)}
          >
            <Plus size={13} />
          </button>
          {availableShells.length > 0 && (
            <button
              title="Choose shell"
              className="flex items-center rounded-r px-1 py-1 text-(--sg-text-faint) transition-colors hover:bg-(--sg-surface-raised) hover:text-(--sg-text-dim)"
              onClick={() => setShowShellPicker((v) => !v)}
            >
              <ChevronDown size={10} />
            </button>
          )}
          {showShellPicker && availableShells.length > 0 && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowShellPicker(false)}
              />
              <div className="absolute top-full right-0 z-50 mt-1 min-w-32.5 overflow-hidden rounded-md border border-(--sg-border) bg-(--sg-surface) py-1 shadow-xl">
                {availableShells.map((shell) => (
                  <button
                    key={shell.path}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-(--sg-text) transition-colors hover:bg-(--sg-surface-raised)"
                    onClick={() => {
                      setShowShellPicker(false);
                      onOpenTerminal(
                        activeWorktreePath ?? workspacePath,
                        undefined,
                        shell.path,
                      );
                    }}
                  >
                    {shell.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="mx-0.5 h-3.5 w-px bg-(--sg-border)" />
        <div className="flex shrink-0 items-center gap-0.5 py-0.5">
          <button
            title="Tabbed"
            className={`rounded p-1 transition-colors ${terminalLayout === "tabs" ? "bg-(--sg-surface-raised) text-(--sg-primary)" : "text-(--sg-text-faint) hover:bg-(--sg-surface-raised) hover:text-(--sg-text-dim)"}`}
            onClick={() => onSetLayout("tabs")}
          >
            <Rows3 size={14} />
          </button>
          <button
            title="Split"
            className={`rounded p-1 transition-colors ${terminalLayout === "split" ? "bg-(--sg-surface-raised) text-(--sg-primary)" : "text-(--sg-text-faint) hover:bg-(--sg-surface-raised) hover:text-(--sg-text-dim)"}`}
            onClick={() => onSetLayout("split")}
          >
            <Columns2 size={14} />
          </button>
          <button
            title="Grid"
            className={`rounded p-1 transition-colors ${terminalLayout === "grid" ? "bg-(--sg-surface-raised) text-(--sg-primary)" : "text-(--sg-text-faint) hover:bg-(--sg-surface-raised) hover:text-(--sg-text-dim)"}`}
            onClick={() => onSetLayout("grid")}
          >
            <LayoutGrid size={14} />
          </button>
        </div>
      </div>
      <div className={terminalWrapperClass()}>
        {visibleSessions.map((s) => (
          <div
            key={s.id}
            className={`h-full min-h-0 min-w-0 ${terminalLayout !== "tabs" ? "border-r border-(--sg-border) last:border-r-0 nth-[2n]:border-r-0 nth-[n+3]:border-t nth-[n+3]:border-(--sg-border)" : ""}`}
            style={terminalPanelStyle(s.id)}
          >
            <TerminalPane
              sessionId={s.id}
              incomingData={s.pendingData}
              droppedLen={s.droppedLen}
              className="h-full w-full"
              // High-frequency (every keystroke/resize) — a toast per
              // failure would be spam, so this is intentionally silent
              // beyond swallowing the rejection to avoid unhandled-
              // rejection console noise if the PTY session has died.
              onData={(id, data) => {
                void api.writeTerminal(id, data).catch(() => undefined);
              }}
              onResize={(id, cols, rows) => {
                void api.resizeTerminal(id, cols, rows).catch(() => undefined);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
