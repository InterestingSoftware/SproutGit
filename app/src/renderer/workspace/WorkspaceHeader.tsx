import type { CSSProperties } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  GitBranch,
  ChevronRight,
  ChevronDown,
  Settings,
  AppWindow,
  FolderOpen,
  Radar,
} from "lucide-react";
import {
  WindowControls,
  UpdateBadge,
  useContextMenu,
  type UpdateState,
} from "@sproutgit/ui";
import { api } from "../api.js";
import type { RecentWorkspace, WorktreeInfo } from "@sproutgit/types";

type Props = {
  workspacePath: string;
  activeWorktree: WorktreeInfo | null;
  updateState: UpdateState;
  loadRecentWorkspaces: () => Promise<RecentWorkspace[]>;
  onSwitchWorkspace: (path: string) => void;
  /** Whether any worktree currently has a live agent-launched terminal session — shows a live dot on the Agent Sessions button. */
  hasLiveAgentSession: boolean;
  /** Number of tracked sessions currently in an "awaiting" state (awaiting-permission or awaiting-input) — see useSessionAttention(). */
  waitingCount: number;
  onToggleSessionsPanel: () => void;
  /** Jumps straight to the oldest-waiting session's pending prompt; falls back to opening the sessions panel if `waitingCount` somehow drops to 0 between render and click. */
  onJumpToNextWaiting: () => void;
};

/** Last path segment, tolerating both '/' (macOS/Linux) and '\' (Windows) separators. */
function workspaceBaseName(p: string): string {
  const trimmed = p.trim().replace(/[\\/]+$/g, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/** Full-width top header: back/workspace-switcher chrome, active branch, window/settings buttons. */
export function WorkspaceHeader({
  workspacePath,
  activeWorktree,
  updateState,
  loadRecentWorkspaces,
  onSwitchWorkspace,
  hasLiveAgentSession,
  waitingCount,
  onToggleSessionsPanel,
  onJumpToNextWaiting,
}: Props) {
  const navigate = useNavigate();
  const contextMenu = useContextMenu();

  return (
    <header
      className="flex items-center h-(--sg-titlebar-height) shrink-0 border-b border-(--sg-border) bg-(--sg-surface)"
      style={{ WebkitAppRegion: "drag" } as CSSProperties}
      data-testid="workspace-header"
    >
      <WindowControls />
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <button
          className="group flex items-center gap-1 rounded-md px-2 py-1 text-xs text-(--sg-text-dim) transition-colors hover:bg-(--sg-surface-raised) hover:text-(--sg-text) border-none bg-transparent cursor-pointer"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
          onClick={() => void navigate({ to: "/" })}
          data-testid="btn-back-projects"
        >
          <span className="transition-transform group-hover:-translate-x-0.5">
            ←
          </span>
          <span>Projects</span>
        </button>
        <div className="h-3 w-px bg-(--sg-border)" />
        <button
          className="group/switcher flex items-center gap-0.5 rounded-md px-1.5 py-0.5 -mx-1.5 text-xs font-medium text-(--sg-text) transition-colors hover:bg-(--sg-surface-raised) border-none bg-transparent cursor-pointer max-w-45 min-w-0"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
          title="Switch workspace"
          data-testid="btn-workspace-switcher"
          onClick={async (e) => {
            const fresh = await loadRecentWorkspaces();
            const others = fresh.filter(
              (w) => w.workspacePath !== workspacePath,
            );
            contextMenu.open(
              e,
              others.length > 0
                ? others.map((w) => ({
                    label: workspaceBaseName(w.workspacePath),
                    icon: <FolderOpen size={14} />,
                    onClick: () => onSwitchWorkspace(w.workspacePath),
                  }))
                : [
                    {
                      label: "No other recent workspaces",
                      disabled: true,
                      onClick: () => undefined,
                    },
                  ],
            );
          }}
        >
          <span className="truncate">{workspaceBaseName(workspacePath)}</span>
          <ChevronDown
            size={12}
            className="text-(--sg-text-faint) shrink-0 opacity-60 group-hover/switcher:opacity-100"
          />
        </button>
        <ChevronRight size={12} className="text-(--sg-text-faint) shrink-0" />
        <span className="flex items-center gap-1 font-mono text-xs text-(--sg-primary) truncate max-w-50">
          <GitBranch size={12} className="shrink-0" />
          {activeWorktree?.branch ??
            (activeWorktree?.detached ? "detached" : "—")}
        </span>
      </div>
      <div
        className="flex items-center h-full pr-1 gap-0.5 shrink-0"
        style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
      >
        <UpdateBadge
          state={updateState}
          onInstall={() => void api.installUpdate()}
        />
        {waitingCount > 0 && (
          <button
            className="inline-flex items-center gap-1 rounded-full bg-(--sg-warning)/15 px-2 py-0.5 text-[11px] font-semibold text-(--sg-warning) border-none cursor-pointer hover:bg-(--sg-warning)/25"
            title={`${waitingCount} agent session${waitingCount === 1 ? "" : "s"} waiting on you — jump to the oldest one`}
            onClick={onJumpToNextWaiting}
            data-testid="waiting-sessions-indicator"
          >
            {waitingCount} waiting
          </button>
        )}
        <button
          className="relative inline-flex items-center justify-center p-2 bg-transparent border-none cursor-pointer text-(--sg-text-faint) rounded-sm transition-colors hover:text-(--sg-text) hover:bg-(--sg-surface-raised)"
          title="Agent Sessions"
          aria-label="Agent Sessions"
          onClick={onToggleSessionsPanel}
          data-testid="btn-agent-sessions"
        >
          <Radar size={16} />
          {hasLiveAgentSession && (
            <span
              className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-(--sg-primary)"
              aria-hidden="true"
              data-testid="agent-sessions-live-dot"
            />
          )}
        </button>
        <button
          className="inline-flex items-center justify-center p-2 bg-transparent border-none cursor-pointer text-(--sg-text-faint) rounded-sm transition-colors hover:text-(--sg-text) hover:bg-(--sg-surface-raised)"
          title="New Window"
          onClick={() => void api.openNewWindow()}
        >
          <AppWindow size={16} />
        </button>
        <button
          className="inline-flex items-center justify-center p-2 bg-transparent border-none cursor-pointer text-(--sg-text-faint) rounded-sm transition-colors hover:text-(--sg-text) hover:bg-(--sg-surface-raised)"
          title="Settings"
          onClick={() =>
            void navigate({
              to: "/settings",
              search: { workspace: workspacePath },
            })
          }
        >
          <Settings size={16} />
        </button>
      </div>
      <WindowControls side="right" />
    </header>
  );
}
