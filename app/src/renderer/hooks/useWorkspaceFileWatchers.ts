import { useEffect, useRef } from "react";
import type { useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";
import { reportError } from "../error-reporting.js";
import { resetWorkspaceStore } from "../stores/workspace-store.js";
import {
  useEditorStore,
  handleExternalChange,
  tabKey,
} from "../stores/editor-store.js";
import { qk } from "../queries.js";
import type { ToastFn } from "../toast-context.js";
import type { FileChangedEvent, WorktreeInfo } from "@sproutgit/types";

/**
 * All of the workspace's background subscriptions that keep server state in
 * sync with the filesystem/git and don't belong to a more specific concern
 * (terminals, worktree selection, commit diff): the workspace-level git
 * watcher, the active worktree's file-content watcher, refetch-on-focus,
 * worktree metadata pruning, MCP auto-start, and workspace-switch cleanup.
 */
export function useWorkspaceFileWatchers(params: {
  workspacePath: string;
  gitRepoPath: string;
  activeWorktreePath: string | undefined;
  worktrees: WorktreeInfo[];
  qc: ReturnType<typeof useQueryClient>;
  toast: ToastFn;
}) {
  const {
    workspacePath,
    gitRepoPath,
    activeWorktreePath,
    worktrees,
    qc,
    toast,
  } = params;

  // ── Reset UI state when workspace path changes ────────────────────────

  useEffect(() => {
    resetWorkspaceStore(workspacePath);
  }, [workspacePath]);

  // ── MCP server auto-start ────────────────────────────────────────────
  // No-op unless the user previously enabled MCP for this workspace in
  // Settings — this just makes "enabled" survive across app restarts.
  // Gated on gitRepoPath for the same reason as the file watcher below:
  // checking/persisting MCP state touches .sproutgit/state.db, which would
  // otherwise get created (via openWorkspaceDb's side effect) inside a
  // not-yet-migrated plain repo and make its working tree look dirty right
  // as the legacy-layout bare-repo migration runs.
  // Intentionally no stop-on-unmount: like background terminal sessions,
  // the server should keep running while the app is open even after
  // navigating away from this workspace view; it's torn down on workspace
  // close (WORKSPACE_CLOSE) and app quit instead.
  useEffect(() => {
    if (!gitRepoPath) return;
    // A failure here means the MCP server just doesn't start, invisibly —
    // surface it instead.
    void api
      .mcpEnsureStarted(workspacePath)
      .catch((err: unknown) => reportError("Failed to start MCP server", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitRepoPath]);

  // ── Close terminals when switching to a DIFFERENT workspace ──────────
  // We use a ref so the cleanup only fires when the path genuinely changes
  // (not when the component unmounts on navigation to the Projects screen).
  const prevWorkspacePathRef = useRef<string>(workspacePath);
  useEffect(() => {
    const prevPath = prevWorkspacePathRef.current;
    prevWorkspacePathRef.current = workspacePath;
    if (prevPath && prevPath !== workspacePath) {
      void api.closeTerminalsForPath(prevPath);
    }
  }, [workspacePath]);

  // ── File watcher → invalidate queries ────────────────────────────────
  // Wait for gitRepoPath (root, always bare) to be known before watching —
  // starting earlier would watch the pre-migration path, and on Windows
  // `fs.watch` holds an open handle that blocks the rename that converts a
  // workspace to the bare-root layout (EPERM).

  useEffect(() => {
    if (!gitRepoPath) return;
    // A failure here means the app silently stops picking up external
    // changes (branch switches, commits, worktree adds from another tool)
    // for the whole session — surface it rather than letting the workspace
    // look "stuck"/stale with no explanation.
    void api
      .startWatching(gitRepoPath)
      .catch((err: unknown) =>
        toast(`Failed to watch workspace for changes: ${String(err)}`, "error"),
      );
    const offWorktree = api.onWorktreeChanged(() => {
      void qc.invalidateQueries({ queryKey: qk.worktrees(gitRepoPath) });
    });
    const offRefs = api.onGitRefsChanged(() => {
      void qc.invalidateQueries({ queryKey: qk.commits(gitRepoPath) });
      void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
    });
    return () => {
      void api.stopWatching(gitRepoPath).catch(() => undefined);
      offWorktree();
      offRefs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitRepoPath]);

  // ── File content watcher (active worktree) → file tree + open tab live-sync ──
  // Distinct from the workspace-level watcher above (which only tracks .git/*
  // for branch/ref changes) — this one covers the working tree's file
  // *contents* so the file browser refreshes and open editor tabs pick up
  // external edits (e.g. an AI agent or another tool writing to a file).
  //
  // It also doubles as a fast path for the Changes tab's status query: any
  // content change likely means `git status` changed too, so invalidate it
  // immediately instead of waiting on its 15s poll (kept as a fallback for
  // changes this watcher can't see, e.g. an index/stash operation from
  // another tool with no working-tree file write).
  useEffect(() => {
    const worktreePath = activeWorktreePath;
    if (!worktreePath) return;

    void api.startFileWatching(worktreePath);
    const offFileChanged = api.onFileChanged((event: FileChangedEvent) => {
      if (event.worktreePath !== worktreePath) return;
      void qc.invalidateQueries({ queryKey: qk.fileTree(worktreePath) });
      void qc.invalidateQueries({ queryKey: qk.worktreeStatus(worktreePath) });
      if (gitRepoPath)
        void qc.invalidateQueries({
          queryKey: qk.worktreeChangeCounts(gitRepoPath),
        });

      const key = tabKey(worktreePath, event.relativePath);
      if (!useEditorStore.getState().tabs[key]) return;

      if (event.type === "deleted") return; // leave the buffer as-is; save will recreate the file

      api
        .readFile(worktreePath, event.relativePath)
        .then((result) => {
          // Re-read the tab's current state rather than the one captured
          // before this async read started — it may have been saved,
          // reloaded, or closed while the read was in flight.
          const currentTab = useEditorStore.getState().tabs[key];
          if (!currentTab) return;
          if (result.mtimeMs <= currentTab.knownMtimeMs) return;
          handleExternalChange(key, result.content, result.mtimeMs);
        })
        .catch(() => undefined);
    });

    return () => {
      void api.stopFileWatching(worktreePath);
      offFileChanged();
    };
  }, [activeWorktreePath, gitRepoPath, qc]);

  // ── Refresh worktrees when the window regains focus ───────────────────
  // Catches worktrees an external tool (e.g. Claude Code) registered while
  // this window was unfocused, on top of the filesystem watcher above.
  useEffect(() => {
    if (!gitRepoPath) return;
    const onFocus = () =>
      void qc.invalidateQueries({ queryKey: qk.worktrees(gitRepoPath) });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [gitRepoPath, qc]);

  // ── Drop worktree_metadata rows for worktrees that have disappeared ────
  // Best-effort bookkeeping cleanup only — never runs `git worktree prune`.
  useEffect(() => {
    if (!workspacePath || worktrees.length === 0) return;
    void api
      .pruneWorktreeMetadata({
        workspacePath,
        activeWorktreePaths: worktrees.map((w) => w.path),
      })
      .catch(() => undefined);
  }, [workspacePath, worktrees]);
}
