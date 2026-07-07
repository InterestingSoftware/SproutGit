import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Pencil,
  Plus,
  PanelTop,
  SquareSplitHorizontal,
  LayoutGrid,
  X,
  Trash2,
  ChevronsRight,
} from "lucide-react";
import { api } from "../api.js";
import { useContextMenu } from "@sproutgit/ui";
import { useWorkspaceStore } from "../stores/workspace-store.js";
import type { ToastFn } from "../toast-context.js";

/** Max characters of PTY output retained per terminal (~1MB of UTF-16). Older
 *  output is dropped from the front rather than kept forever — a terminal
 *  running a chatty long-lived process must not accumulate output for its
 *  entire lifetime. */
const TERMINAL_BUFFER_CAP = 512 * 1024;

function shellDisplayName(shellPath: string | null | undefined): string {
  if (!shellPath) return "terminal";
  const base = shellPath.split(/[/\\]/).pop() ?? shellPath;
  return base.replace(/\.exe$/i, "");
}

/**
 * Owns terminal session lifecycle for the workspace view: the non-reactive
 * PTY output buffers, all terminal-related IPC listeners (data/exit, hook
 * launch, agent launch), and the actions the terminal tab UI needs (open,
 * close, rename, layout, context menu).
 */
export function useTerminalManager(params: {
  workspacePath: string;
  activeWorktreePath: string | undefined;
  defaultShell: string;
  toast: ToastFn;
}) {
  const { workspacePath, activeWorktreePath, defaultShell, toast } = params;
  const contextMenu = useContextMenu();

  const terminalSessions = useWorkspaceStore((s) => s.terminalSessions);
  const activeTerminalId = useWorkspaceStore((s) => s.activeTerminalId);
  const terminalLayout = useWorkspaceStore((s) => s.terminalLayout);

  // Sessions for the currently selected worktree. All other sessions keep
  // their PTYs running in the background and reappear when you switch back.
  const visibleSessions = terminalSessions.filter(
    (s) => s.cwd === activeWorktreePath,
  );

  const [renamingTerminalId, setRenamingTerminalId] = useState<string | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // Non-reactive terminal data buffer. Capped per terminal so a long-running
  // or repeatedly-opened terminal doesn't accumulate unbounded output for
  // the lifetime of the session — see TERMINAL_BUFFER_CAP above.
  const terminalDataRef = useRef<Map<string, string>>(new Map());
  // Cumulative characters trimmed from the front of each terminal's buffer,
  // so TerminalPane (which reads pendingData as an ever-growing stream) can
  // still compute correct write deltas after a trim.
  const terminalDroppedLenRef = useRef<Map<string, number>>(new Map());
  const terminalBuffersHydratedRef = useRef(false);
  // The store's terminalSessions survive WorkspaceInner unmounting/remounting
  // (e.g. navigating to Projects and back) so background PTYs keep their
  // pendingData/droppedLen, but these refs do not — they'd otherwise reset to
  // empty and the next onTerminalData event would clobber the preserved
  // buffer with just the newest chunk. Reseed once per mount, synchronously
  // during render so it happens before the onTerminalData listener attaches.
  if (!terminalBuffersHydratedRef.current) {
    terminalBuffersHydratedRef.current = true;
    for (const sess of useWorkspaceStore.getState().terminalSessions) {
      terminalDataRef.current.set(sess.id, sess.pendingData);
      terminalDroppedLenRef.current.set(sess.id, sess.droppedLen);
    }
  }

  useEffect(() => {
    // If the active terminal was closed (not in any session), fall back to
    // the last visible session for the current worktree.
    if (
      activeTerminalId &&
      !terminalSessions.some((s) => s.id === activeTerminalId)
    ) {
      const activePath = useWorkspaceStore.getState().activeWorktree?.path;
      const last =
        terminalSessions.filter((s) => s.cwd === activePath).at(-1)?.id ?? null;
      useWorkspaceStore.setState({ activeTerminalId: last });
    }
    if (
      renamingTerminalId &&
      !terminalSessions.some((s) => s.id === renamingTerminalId)
    ) {
      setRenamingTerminalId(null);
      setRenameValue("");
    }
  }, [activeTerminalId, renamingTerminalId, terminalSessions]);

  useEffect(() => {
    if (!renamingTerminalId || !renameInputRef.current) return;
    renameInputRef.current.focus();
    renameInputRef.current.select();
  }, [renamingTerminalId]);

  // ── Terminal IPC ──────────────────────────────────────────────────────

  useEffect(() => {
    const offData = api.onTerminalData((id: string, data: string) => {
      const prevBuffer = terminalDataRef.current.get(id) ?? "";
      const prevDropped = terminalDroppedLenRef.current.get(id) ?? 0;
      let buffer: string;
      let droppedLen: number;
      if (data.length >= TERMINAL_BUFFER_CAP) {
        // A single chunk alone meets/exceeds the cap — skip concatenating it
        // with the old buffer so we never allocate a temporary string larger
        // than the cap (the old buffer is entirely superseded anyway).
        const overflow = data.length - TERMINAL_BUFFER_CAP;
        buffer = data.slice(overflow);
        droppedLen = prevDropped + prevBuffer.length + overflow;
      } else {
        const combined = prevBuffer + data;
        if (combined.length > TERMINAL_BUFFER_CAP) {
          const overflow = combined.length - TERMINAL_BUFFER_CAP;
          buffer = combined.slice(overflow);
          droppedLen = prevDropped + overflow;
        } else {
          buffer = combined;
          droppedLen = prevDropped;
        }
      }
      terminalDataRef.current.set(id, buffer);
      terminalDroppedLenRef.current.set(id, droppedLen);
      useWorkspaceStore.setState((s) => ({
        terminalSessions: s.terminalSessions.map((sess) =>
          sess.id === id ? { ...sess, pendingData: buffer, droppedLen } : sess,
        ),
      }));
    });

    const offExit = api.onTerminalExit((id: string) => {
      terminalDataRef.current.delete(id);
      terminalDroppedLenRef.current.delete(id);
      useWorkspaceStore.setState((s) => {
        const remaining = s.terminalSessions.filter((sess) => sess.id !== id);
        const currentPath = s.activeWorktree?.path;
        const visibleRemaining = remaining.filter(
          (sess) => sess.cwd === currentPath,
        );
        return {
          terminalSessions: remaining,
          activeTerminalId:
            s.activeTerminalId === id
              ? (visibleRemaining.at(-1)?.id ?? null)
              : s.activeTerminalId,
        };
      });
    });

    return () => {
      offData();
      offExit();
    };
  }, []);

  // ── Hook terminal launch listener ─────────────────────────────────────

  useEffect(() => {
    const offHookTerminal = api.onHookTerminalLaunch((event) => {
      const label = `hook: ${event.hookName}`;
      useWorkspaceStore.setState((s) => {
        const cwd = event.cwd;
        return {
          terminalSessions: [
            ...s.terminalSessions,
            {
              id: event.terminalId,
              cwd,
              label: makeTerminalLabel(
                s.terminalSessions.filter((sess) => sess.cwd === cwd),
                label,
              ),
              pendingData: "",
              droppedLen: 0,
              agentId: null,
            },
          ],
          activeTerminalId: event.terminalId,
          activeTab: "terminal",
          worktreeActiveTerminalId: {
            ...s.worktreeActiveTerminalId,
            [cwd]: event.terminalId,
          },
        };
      });
    });

    return () => {
      offHookTerminal();
    };
  }, []);

  // ── Agent terminal launch listener ─────────────────────────────────────

  useEffect(() => {
    const offAgentTerminal = api.onAgentTerminalLaunch((event) => {
      useWorkspaceStore.setState((s) => {
        const cwd = event.cwd;
        return {
          terminalSessions: [
            ...s.terminalSessions,
            {
              id: event.terminalId,
              cwd,
              label: makeTerminalLabel(
                s.terminalSessions.filter((sess) => sess.cwd === cwd),
                "AI Agent",
              ),
              pendingData: "",
              droppedLen: 0,
              agentId: "agent",
            },
          ],
          activeTerminalId: event.terminalId,
          activeTab: "terminal",
          worktreeActiveTerminalId: {
            ...s.worktreeActiveTerminalId,
            [cwd]: event.terminalId,
          },
        };
      });
    });

    return () => {
      offAgentTerminal();
    };
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────

  function makeTerminalLabel(
    sessions: typeof terminalSessions,
    baseLabel: string,
  ) {
    const trimmed = baseLabel.trim() || "terminal";
    const existing = sessions.filter((s) => s.label === trimmed).length;
    return existing === 0 ? trimmed : `${trimmed} (${existing + 1})`;
  }

  async function openTerminal(
    cwd: string,
    label?: string,
    shellOverride?: string,
  ) {
    try {
      const terminalArgs: {
        cwd: string;
        label?: string;
        shell?: string;
      } = { cwd };
      if (label) terminalArgs.label = label;
      const resolvedShell = shellOverride ?? defaultShell;
      if (resolvedShell) terminalArgs.shell = resolvedShell;
      const id = await api.createTerminal(terminalArgs);
      const shellLabel = shellDisplayName(resolvedShell);
      useWorkspaceStore.setState((s) => ({
        terminalSessions: [
          ...s.terminalSessions,
          {
            id,
            cwd,
            label: makeTerminalLabel(
              s.terminalSessions.filter((sess) => sess.cwd === cwd),
              label ?? shellLabel,
            ),
            pendingData: "",
            droppedLen: 0,
            agentId: null,
          },
        ],
        activeTerminalId: id,
        activeTab: "terminal",
        worktreeActiveTerminalId: { ...s.worktreeActiveTerminalId, [cwd]: id },
      }));
    } catch (err) {
      toast(`Failed to open terminal: ${String(err)}`, "error");
    }
  }

  async function launchAgent(worktreePath: string, agentId?: string) {
    try {
      await api.launchAgent(agentId ? { workspacePath, worktreePath, agentId } : { workspacePath, worktreePath });
    } catch (err) {
      toast(`Failed to launch agent: ${String(err)}`, "error");
    }
  }

  function terminalPanelStyle(id: string): CSSProperties {
    if (terminalLayout === "tabs") {
      return {
        display: id === activeTerminalId ? "block" : "none",
        minHeight: 0,
        flex: 1,
      };
    }
    return {
      display: "block",
      minHeight: 0,
      minWidth: 0,
      flex: 1,
    };
  }

  function terminalWrapperClass() {
    if (terminalLayout === "split") return "flex flex-1 min-h-0";
    if (terminalLayout === "grid")
      return "grid flex-1 min-h-0 grid-cols-2 auto-rows-fr";
    return "flex flex-1 min-h-0 flex-col";
  }

  async function closeTerminal(id: string) {
    await api.closeTerminal(id).catch(() => undefined);
    terminalDataRef.current.delete(id);
    terminalDroppedLenRef.current.delete(id);
    useWorkspaceStore.setState((s) => {
      const remaining = s.terminalSessions.filter((sess) => sess.id !== id);
      const currentPath = s.activeWorktree?.path;
      const visibleRemaining = remaining.filter(
        (sess) => sess.cwd === currentPath,
      );
      return {
        terminalSessions: remaining,
        activeTerminalId:
          s.activeTerminalId === id
            ? (visibleRemaining.at(-1)?.id ?? null)
            : s.activeTerminalId,
      };
    });
    if (renamingTerminalId === id) {
      setRenamingTerminalId(null);
      setRenameValue("");
    }
  }

  async function closeTerminals(ids: string[]) {
    if (ids.length === 0) return;
    await Promise.all(
      ids.map((id) => api.closeTerminal(id).catch(() => undefined)),
    );
    for (const id of ids) {
      terminalDataRef.current.delete(id);
      terminalDroppedLenRef.current.delete(id);
    }
    useWorkspaceStore.setState((s) => {
      const idSet = new Set(ids);
      const remaining = s.terminalSessions.filter(
        (sess) => !idSet.has(sess.id),
      );
      const currentPath = s.activeWorktree?.path;
      const visibleRemaining = remaining.filter(
        (sess) => sess.cwd === currentPath,
      );
      return {
        terminalSessions: remaining,
        activeTerminalId: idSet.has(s.activeTerminalId ?? "")
          ? (visibleRemaining.at(-1)?.id ?? null)
          : s.activeTerminalId,
      };
    });
    if (renamingTerminalId && ids.includes(renamingTerminalId)) {
      setRenamingTerminalId(null);
      setRenameValue("");
    }
  }

  function startTerminalRename(id: string) {
    const session = terminalSessions.find((s) => s.id === id);
    if (!session) return;
    useWorkspaceStore.setState({ activeTerminalId: id, activeTab: "terminal" });
    setRenamingTerminalId(id);
    setRenameValue(session.label);
  }

  function commitTerminalRename() {
    if (!renamingTerminalId) return;
    const trimmed = renameValue.trim();
    if (trimmed) {
      useWorkspaceStore.setState((s) => ({
        terminalSessions: s.terminalSessions.map((sess) =>
          sess.id === renamingTerminalId ? { ...sess, label: trimmed } : sess,
        ),
      }));
    }
    setRenamingTerminalId(null);
    setRenameValue("");
  }

  function cancelTerminalRename() {
    setRenamingTerminalId(null);
    setRenameValue("");
  }

  function openTerminalTabMenu(e: ReactMouseEvent, sessionId: string) {
    const index = visibleSessions.findIndex((s) => s.id === sessionId);
    if (index === -1) return;
    const idsToRight = visibleSessions.slice(index + 1).map((s) => s.id);
    const otherIds = visibleSessions
      .filter((s) => s.id !== sessionId)
      .map((s) => s.id);
    contextMenu.open(e, [
      {
        label: "Rename",
        icon: <Pencil size={14} />,
        onClick: () => startTerminalRename(sessionId),
      },
      {
        label: "New Terminal",
        icon: <Plus size={14} />,
        onClick: () => {
          void openTerminal(activeWorktreePath ?? workspacePath);
        },
      },
      "separator",
      {
        label: "Tabbed Layout",
        icon: <PanelTop size={14} />,
        onClick: () =>
          useWorkspaceStore.setState({
            terminalLayout: "tabs",
            activeTerminalId: sessionId,
            activeTab: "terminal",
          }),
      },
      {
        label: "Split Layout",
        icon: <SquareSplitHorizontal size={14} />,
        onClick: () =>
          useWorkspaceStore.setState({
            terminalLayout: "split",
            activeTerminalId: sessionId,
            activeTab: "terminal",
          }),
      },
      {
        label: "Grid Layout",
        icon: <LayoutGrid size={14} />,
        onClick: () =>
          useWorkspaceStore.setState({
            terminalLayout: "grid",
            activeTerminalId: sessionId,
            activeTab: "terminal",
          }),
      },
      "separator",
      {
        label: "Close",
        icon: <X size={14} />,
        danger: true,
        onClick: () => {
          void closeTerminal(sessionId);
        },
      },
      {
        label: "Close Others",
        icon: <Trash2 size={14} />,
        disabled: otherIds.length === 0,
        danger: true,
        onClick: () => {
          void closeTerminals(otherIds);
        },
      },
      {
        label: "Close To Right",
        icon: <ChevronsRight size={14} />,
        disabled: idsToRight.length === 0,
        danger: true,
        onClick: () => {
          void closeTerminals(idsToRight);
        },
      },
    ]);
  }

  return {
    visibleSessions,
    activeTerminalId,
    terminalLayout,
    renamingTerminalId,
    renameValue,
    setRenameValue,
    renameInputRef,
    openTerminal,
    closeTerminal,
    closeTerminals,
    launchAgent,
    startTerminalRename,
    commitTerminalRename,
    cancelTerminalRename,
    terminalPanelStyle,
    terminalWrapperClass,
    openTerminalTabMenu,
  };
}
