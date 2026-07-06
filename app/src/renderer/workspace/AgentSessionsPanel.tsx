import { useEffect, useState } from 'react';
import { Bot, X, ArrowRight, Radar } from 'lucide-react';
import { api } from '../api.js';
import type { WorktreeInfo, TerminalInfo } from '@sproutgit/types';

type Props = {
  open: boolean;
  worktrees: WorktreeInfo[];
  onJump: (session: TerminalInfo) => void;
  onClose: () => void;
};

function formatElapsed(startedAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function worktreeLabel(cwd: string, worktrees: WorktreeInfo[]): string {
  const wt = worktrees.find(w => w.path === cwd);
  if (!wt) return cwd.split(/[\\/]/).pop() ?? cwd;
  return wt.branch ?? (wt.detached ? 'detached HEAD' : (wt.path.split(/[\\/]/).pop() ?? wt.path));
}

/**
 * "Mission control" overlay listing every currently-running agent-launched
 * terminal session across all worktrees in the open workspace, with a
 * jump-to-terminal action for each. Polls terminal:list on a 1s interval
 * while open — cheap (an in-memory map read in the main process) and keeps
 * elapsed time and cross-window session state accurate without threading
 * this into the renderer's existing per-window terminalSessions store.
 */
export function AgentSessionsPanel({ open, worktrees, onJump, onClose }: Props) {
  const [sessions, setSessions] = useState<TerminalInfo[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const refresh = () => {
      void api.listTerminals().then(list => { if (!cancelled) setSessions(list); }).catch(() => undefined);
      setNow(Date.now());
    };
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [open]);

  if (!open) return null;

  const agentSessions = sessions
    .filter(s => s.agentId !== null)
    .sort((a, b) => a.startedAt - b.startedAt);

  return (
    <div className="fixed inset-0 z-200" onClick={onClose}>
      <div
        className="sg-agent-sessions-panel absolute right-3 top-11 w-90 max-h-[70vh] overflow-y-auto rounded-[10px] border border-(--sg-border) bg-(--sg-surface) shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={e => e.stopPropagation()}
        data-testid="agent-sessions-panel"
        role="dialog"
        aria-modal
        aria-label="Agent sessions"
      >
        <div className="flex items-center justify-between border-b border-(--sg-border-subtle) px-3 py-2">
          <h2 className="m-0 flex items-center gap-1.5 text-[13px] font-semibold text-(--sg-text)">
            <Radar size={14} className="text-(--sg-primary)" />
            Agent Sessions
            <span
              className="rounded-full bg-(--sg-primary)/15 px-1.5 py-0 text-[10px] font-semibold text-(--sg-primary)"
              data-testid="agent-sessions-count"
            >
              {agentSessions.length}
            </span>
          </h2>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded p-1 bg-transparent border-none cursor-pointer text-(--sg-text-faint) hover:bg-(--sg-surface-raised) hover:text-(--sg-text)"
            onClick={onClose}
            aria-label="Close"
            data-testid="btn-close-agent-sessions"
          >
            <X size={14} />
          </button>
        </div>

        {agentSessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <Bot size={20} className="text-(--sg-text-faint)" />
            <p className="m-0 text-xs text-(--sg-text-dim)">No agent sessions are currently running.</p>
          </div>
        ) : (
          <ul className="m-0 list-none p-0">
            {agentSessions.map(session => (
              <li
                key={session.id}
                className="sg-agent-session-row flex items-center gap-2 border-b border-(--sg-border-subtle) px-3 py-2 last:border-b-0"
                data-testid="agent-session-row"
                data-cwd={session.cwd}
              >
                <Bot size={14} className="shrink-0 text-(--sg-primary)" />
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-xs font-semibold text-(--sg-text)">
                    {worktreeLabel(session.cwd, worktrees)}
                  </p>
                  <p className="m-0 truncate text-[10px] text-(--sg-text-dim)">
                    {session.agentName ?? 'agent'} · {formatElapsed(session.startedAt, now)}
                  </p>
                </div>
                <button
                  type="button"
                  className="sg-jump-to-session-btn inline-flex shrink-0 items-center gap-1 rounded-md border border-(--sg-border) bg-transparent px-2 py-1 text-[11px] font-medium text-(--sg-text-dim) cursor-pointer hover:bg-(--sg-surface-raised) hover:text-(--sg-primary)"
                  onClick={() => onJump(session)}
                  data-testid="btn-jump-to-session"
                  title="Jump to terminal"
                >
                  Jump <ArrowRight size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
