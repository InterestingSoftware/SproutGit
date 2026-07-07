import {
  useFetch,
  usePull,
  usePush,
  describeFetchSummary,
} from "../queries.js";
import { useWorkspaceStore } from "../stores/workspace-store.js";
import type { ToastFn } from "../toast-context.js";
import type { WorktreePushStatus } from "@sproutgit/types";

/** Fetch/pull/push actions for the active worktree, mirroring their in-flight flags into the workspace store. */
export function useRemoteOps(params: {
  activeWorktreePath: string | undefined;
  gitRepoPath: string;
  pushStatus: WorktreePushStatus | undefined;
  toast: ToastFn;
  onPushNeedsPublish: () => void;
}) {
  const {
    activeWorktreePath,
    gitRepoPath,
    pushStatus,
    toast,
    onPushNeedsPublish,
  } = params;

  const fetchMutation = useFetch(activeWorktreePath ?? "", gitRepoPath);
  const pullMutation = usePull(activeWorktreePath ?? "", gitRepoPath);
  const pushMutation = usePush(activeWorktreePath ?? "");

  async function doFetch() {
    if (!activeWorktreePath) return;
    useWorkspaceStore.setState({ fetching: true });
    try {
      const summary = await fetchMutation.mutateAsync();
      toast(
        describeFetchSummary(summary),
        summary.hadNoRemotes ? "info" : "success",
      );
    } catch (err) {
      toast(`Fetch failed: ${String(err)}`, "error");
    } finally {
      useWorkspaceStore.setState({ fetching: false });
    }
  }

  async function doPull() {
    if (!activeWorktreePath) return;
    useWorkspaceStore.setState({ pulling: true });
    try {
      await pullMutation.mutateAsync();
      toast("Pulled", "success");
    } catch (err) {
      toast(`Pull failed: ${String(err)}`, "error");
    } finally {
      useWorkspaceStore.setState({ pulling: false });
    }
  }

  async function doPush() {
    if (!activeWorktreePath) return;
    if (!pushStatus?.upstream) {
      onPushNeedsPublish();
      return;
    }
    useWorkspaceStore.setState({ pushing: true });
    try {
      await pushMutation.mutateAsync();
      toast("Pushed", "success");
    } catch (err) {
      toast(`Push failed: ${String(err)}`, "error");
    } finally {
      useWorkspaceStore.setState({ pushing: false });
    }
  }

  return { doFetch, doPull, doPush };
}
