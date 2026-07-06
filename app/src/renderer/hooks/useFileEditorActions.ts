import { api } from "../api.js";
import {
  useEditorStore,
  openOrFocusTab,
  setTabLoaded,
  setTabError,
  setTabSaved,
  resolveConflictReload,
} from "../stores/editor-store.js";
import { useWorkspaceStore } from "../stores/workspace-store.js";
import type { ToastFn } from "../toast-context.js";
import type { WorktreeInfo } from "@sproutgit/types";

/** File editor tab actions: open/read, save, and reload-from-disk (conflict resolution). */
export function useFileEditorActions(params: {
  activeWorktree: WorktreeInfo | null;
  toast: ToastFn;
}) {
  const { activeWorktree, toast } = params;

  async function openFile(relativePath: string) {
    if (!activeWorktree) return;
    const worktreePath = activeWorktree.path;
    const key = openOrFocusTab(worktreePath, relativePath);
    useWorkspaceStore.setState({ activeTab: "files" });
    const tab = useEditorStore.getState().tabs[key];
    if (!tab) return;
    // "already loaded" means a load previously succeeded, not that the
    // content happens to be non-empty — an actually-empty file would
    // otherwise get re-read every time the tab is reopened/focused.
    if (!tab.loading && !tab.error) return;
    try {
      const result = await api.readFile(worktreePath, relativePath);
      setTabLoaded(key, result.content, result.mtimeMs);
    } catch (err) {
      setTabError(key, `Failed to read file: ${String(err)}`);
    }
  }

  async function saveFile(key: string) {
    const tab = useEditorStore.getState().tabs[key];
    if (!tab || !tab.dirty) return;
    try {
      const result = await api.writeFile(
        tab.worktreePath,
        tab.relativePath,
        tab.content,
      );
      setTabSaved(key, tab.content, result.mtimeMs);
    } catch (err) {
      toast(`Failed to save ${tab.relativePath}: ${String(err)}`, "error");
    }
  }

  async function reloadFileFromDisk(key: string) {
    const tab = useEditorStore.getState().tabs[key];
    if (!tab) return;
    try {
      const result = await api.readFile(tab.worktreePath, tab.relativePath);
      resolveConflictReload(key, result.content, result.mtimeMs);
    } catch (err) {
      toast(`Failed to reload ${tab.relativePath}: ${String(err)}`, "error");
    }
  }

  return { openFile, saveFile, reloadFileFromDisk };
}
