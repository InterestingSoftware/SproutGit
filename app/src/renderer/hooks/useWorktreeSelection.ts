import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useWorkspaceStore } from "../stores/workspace-store.js";
import type { useDeleteWorktree } from "../queries.js";
import type { ToastFn } from "../toast-context.js";
import type {
  WorkspaceStatus,
  WorktreeInfo,
  WorktreeSwitchHookSource,
} from "@sproutgit/types";

async function runSwitchAndTriggerHooks(args: {
  workspacePath: string;
  targetWorktreePath: string;
  initiatingWorktreePath: string | null;
  source: WorktreeSwitchHookSource;
}): Promise<void> {
  await api.runSwitchHooks(args);
  await api.runTriggerHooks({
    workspacePath: args.workspacePath,
    trigger: "after_worktree_switch",
    worktreePath: args.targetWorktreePath,
    initiatingWorktreePath: args.initiatingWorktreePath,
    source: args.source,
  });
}

/**
 * Owns picking the initial/active worktree (including restoring the last
 * selection from the DB and auto-switching to a newly created worktree),
 * plus the switch/delete/create-hooks actions that mutate it.
 */
export function useWorktreeSelection(params: {
  workspacePath: string;
  worktrees: WorktreeInfo[];
  rootPath: string | undefined;
  gitRepoPath: string;
  workspaceStatus: WorkspaceStatus | undefined;
  activeWorktree: WorktreeInfo | null;
  deleteWorktreeMutation: ReturnType<typeof useDeleteWorktree>;
  toast: ToastFn;
  closeDeleteDialog: () => void;
}) {
  const {
    workspacePath,
    worktrees,
    rootPath: rootP,
    gitRepoPath,
    workspaceStatus,
    activeWorktree,
    deleteWorktreeMutation,
    toast,
    closeDeleteDialog,
  } = params;

  const [pendingNewWorktreePath, setPendingNewWorktreePath] = useState<
    string | null
  >(null);
  const lastWorktreeWorkspaceRef = useRef("");

  useEffect(() => {
    // Filter out root worktree — it should never be active
    const selectableWorktrees = worktrees.filter((w) => w.path !== rootP);
    if (selectableWorktrees.length === 0) {
      useWorkspaceStore.setState({ activeWorktree: null });
      return;
    }

    const workspaceChanged = lastWorktreeWorkspaceRef.current !== workspacePath;
    lastWorktreeWorkspaceRef.current = workspacePath;

    // If the workspace hasn't changed, preserve an already-valid selection
    // (e.g. a new worktree was added/removed — don't reset the active one).
    if (!workspaceChanged) {
      // If a new worktree was just created, switch to it automatically.
      if (pendingNewWorktreePath) {
        const newWt = selectableWorktrees.find(
          (w) => w.path === pendingNewWorktreePath,
        );
        if (newWt) {
          const prevPath =
            useWorkspaceStore.getState().activeWorktree?.path ?? null;
          setPendingNewWorktreePath(null);
          useWorkspaceStore.setState((s) => ({
            activeWorktree: newWt,
            creatingWorktree: false,
            pendingCreationBranch: null,
            worktreeActiveTerminalId: {
              ...s.worktreeActiveTerminalId,
              ...(prevPath ? { [prevPath]: s.activeTerminalId } : {}),
            },
            activeTerminalId: s.worktreeActiveTerminalId[newWt.path] ?? null,
          }));
          void runSwitchAndTriggerHooks({
            workspacePath,
            targetWorktreePath: newWt.path,
            initiatingWorktreePath: prevPath,
            source: "create",
          }).catch((err: unknown) =>
            toast(`Switch hooks failed: ${String(err)}`, "error"),
          );
          return;
        }
      }
      const current = useWorkspaceStore.getState().activeWorktree;
      if (current && selectableWorktrees.some((w) => w.path === current.path))
        return;
    }

    // On workspace open: restore the last-selected worktree from the DB, fall
    // back to first non-detached, then first overall.
    void api
      .getWorkspaceState(workspacePath, "activeWorktreePath")
      .then((saved) => {
        const restored = saved
          ? (selectableWorktrees.find((w) => w.path === saved) ?? null)
          : null;
        const initial =
          restored ??
          selectableWorktrees.find((w) => !w.detached) ??
          selectableWorktrees[0] ??
          null;
        useWorkspaceStore.setState({ activeWorktree: initial });
        if (initial) {
          void runSwitchAndTriggerHooks({
            workspacePath,
            targetWorktreePath: initial.path,
            initiatingWorktreePath: null,
            source: "load",
          }).catch((err: unknown) =>
            toast(`Switch hooks failed: ${String(err)}`, "error"),
          );
        }
      })
      .catch(() => {
        const initial =
          selectableWorktrees.find((w) => !w.detached) ??
          selectableWorktrees[0] ??
          null;
        useWorkspaceStore.setState({ activeWorktree: initial });
        if (initial) {
          void runSwitchAndTriggerHooks({
            workspacePath,
            targetWorktreePath: initial.path,
            initiatingWorktreePath: null,
            source: "load",
          }).catch((err: unknown) =>
            toast(`Switch hooks failed: ${String(err)}`, "error"),
          );
        }
      });
    // toast is recreated every render (see toast-context.tsx) — omit it so
    // this effect only reruns when the worktree selection actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktrees, rootP, workspacePath, pendingNewWorktreePath]);

  async function handleWorktreeSwitch(wt: WorktreeInfo) {
    if (activeWorktree?.path === wt.path) return;
    const prevPath = activeWorktree?.path ?? null;
    // Save the active terminal for the outgoing worktree and restore the
    // last known active terminal for the incoming worktree.
    useWorkspaceStore.setState((s) => {
      const savedForTarget = s.worktreeActiveTerminalId[wt.path] ?? null;
      const visibleForTarget = s.terminalSessions.filter(
        (sess) => sess.cwd === wt.path,
      );
      const restoredId =
        savedForTarget &&
        visibleForTarget.some((sess) => sess.id === savedForTarget)
          ? savedForTarget
          : (visibleForTarget.at(-1)?.id ?? null);
      return {
        activeWorktree: wt,
        activeTerminalId: restoredId,
        worktreeActiveTerminalId: {
          ...s.worktreeActiveTerminalId,
          ...(prevPath ? { [prevPath]: s.activeTerminalId } : {}),
        },
      };
    });
    void api
      .setWorkspaceState(workspacePath, "activeWorktreePath", wt.path)
      .catch(() => undefined);
    void runSwitchAndTriggerHooks({
      workspacePath,
      targetWorktreePath: wt.path,
      initiatingWorktreePath: prevPath,
      source: "manual",
    }).catch((err: unknown) =>
      toast(`Switch hooks failed: ${String(err)}`, "error"),
    );
  }

  async function doDeleteWorktree(wt: WorktreeInfo) {
    const isDeletingActive = activeWorktree?.path === wt.path;
    const nextWt = isDeletingActive
      ? (worktrees.find(
          (w) => w.path !== wt.path && w.path !== workspaceStatus?.rootPath,
        ) ?? null)
      : null;

    try {
      if (isDeletingActive && nextWt) {
        try {
          await api.runSwitchHooks({
            workspacePath,
            targetWorktreePath: nextWt.path,
            initiatingWorktreePath: wt.path,
            source: "delete",
          });
          await api.runTriggerHooks({
            workspacePath,
            trigger: "after_worktree_switch",
            worktreePath: nextWt.path,
            initiatingWorktreePath: wt.path,
            source: "delete",
          });
        } catch {
          /* non-critical */
        }
      }

      // before/after_worktree_remove hooks and terminal cleanup now run
      // server-side as part of the worktree:delete IPC call itself (see
      // app/src/main/worktree-lifecycle.ts). afterRemoveWorktreePath is the
      // UI's own "next active worktree" concept (no MCP equivalent), passed
      // through explicitly so the after-hook's env vars still reflect it.
      const afterRemoveWorktreePath = (nextWt ?? activeWorktree)?.path ?? null;

      // Switch the active worktree away *before* the mutation so that no git
      // queries fire on the deleted path while or after the deletion runs.
      if (isDeletingActive)
        useWorkspaceStore.setState({ activeWorktree: nextWt });
      await deleteWorktreeMutation.mutateAsync({
        workspacePath,
        rootRepoPath: gitRepoPath,
        ...(workspaceStatus?.worktreesPath
          ? { managedWorktreesPath: workspaceStatus.worktreesPath }
          : {}),
        worktreePath: wt.path,
        // Never delete the branch of an external worktree — an external tool
        // owns it. The main process re-enforces this guard server-side too.
        deleteBranch: !wt.isExternal && !!wt.branch,
        branchName: wt.branch ?? null,
        initiatingWorktreePath: activeWorktree?.path ?? null,
        afterRemoveWorktreePath,
      });

      toast("Worktree removed", "success");
    } catch (err) {
      toast(`Failed to remove worktree: ${String(err)}`, "error");
    } finally {
      closeDeleteDialog();
    }
  }

  // after_worktree_create hooks never fire retroactively for a worktree we
  // adopted rather than created — this lets the user opt in explicitly
  // (e.g. to run a dependency install) from the worktree's context menu.
  async function runCreateHooksFor(wt: WorktreeInfo) {
    try {
      await api.runCreateHooks({
        workspacePath,
        newWorktreePath: wt.path,
        initiatingWorktreePath: activeWorktree?.path ?? null,
      });
      toast("Create hooks ran", "success");
    } catch (err) {
      toast(`Create hooks failed: ${String(err)}`, "error");
    }
  }

  return {
    setPendingNewWorktreePath,
    handleWorktreeSwitch,
    doDeleteWorktree,
    runCreateHooksFor,
  };
}
