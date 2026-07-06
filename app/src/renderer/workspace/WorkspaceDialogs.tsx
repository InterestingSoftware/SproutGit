import { WorkspaceHooksModal } from "@sproutgit/ui";
import { api } from "../api.js";
import { NewWorktreeDialog } from "./dialogs/NewWorktreeDialog.js";
import { DeleteWorktreeDialog } from "./dialogs/DeleteWorktreeDialog.js";
import { PublishDialog } from "./dialogs/PublishDialog.js";
import { RunHookDialog } from "./dialogs/RunHookDialog.js";
import { CreatePrDialog } from "./dialogs/CreatePrDialog.js";
import type {
  RefInfo,
  WorktreeInfo,
  WorktreePushStatus,
  IssueTrackerPattern,
} from "@sproutgit/types";
import type { ToastFn } from "../toast-context.js";

type Props = {
  workspacePath: string;
  activeWorktree: WorktreeInfo | null;
  gitRepoPath: string;
  defaultShell: string;
  refs: RefInfo[];
  issueTrackerPatterns: IssueTrackerPattern[];
  pushStatus: WorktreePushStatus | null | undefined;
  managedWorktreesPath: string | undefined;
  toast: ToastFn;

  hooksModalOpen: boolean;
  onCloseHooksModal: () => void;

  showNewWorktree: boolean;
  onCloseNewWorktree: () => void;
  onWorktreeCreated: (newWorktreePath: string) => void;

  showPublishModal: boolean;
  onClosePublishModal: () => void;
  onPublished: () => void;

  createPrTarget: WorktreeInfo | null;
  onCloseCreatePr: () => void;
  onPrCreated: () => void;

  runHookTarget: WorktreeInfo | null;
  onCloseRunHookModal: () => void;

  deleteTarget: WorktreeInfo | null;
  deleteLoading: boolean;
  onConfirmDelete: (wt: WorktreeInfo) => void;
  onCancelDelete: () => void;
};

/** Bundles the workspace's modal dialogs (hooks, new/delete worktree, publish, run-hook). */
export function WorkspaceDialogs({
  workspacePath,
  activeWorktree,
  gitRepoPath,
  defaultShell,
  refs,
  issueTrackerPatterns,
  pushStatus,
  managedWorktreesPath,
  toast,
  hooksModalOpen,
  onCloseHooksModal,
  showNewWorktree,
  onCloseNewWorktree,
  onWorktreeCreated,
  showPublishModal,
  onClosePublishModal,
  onPublished,
  createPrTarget,
  onCloseCreatePr,
  onPrCreated,
  runHookTarget,
  onCloseRunHookModal,
  deleteTarget,
  deleteLoading,
  onConfirmDelete,
  onCancelDelete,
}: Props) {
  return (
    <>
      {/* Hooks settings modal */}
      <WorkspaceHooksModal
        open={hooksModalOpen}
        workspacePath={workspacePath}
        worktreePath={activeWorktree?.path ?? null}
        onClose={onCloseHooksModal}
        {...(defaultShell ? { defaultShell } : {})}
        api={{
          listHooks: (p, wt) => api.listHooks(p, wt),
          createHook: (args) => api.createHook(args),
          updateHook: (args) => api.updateHook(args),
          deleteHook: (p, id) => api.deleteHook(p, id),
          toggleHook: (p, id, enabled) => api.toggleHook(p, id, enabled),
          trustHook: (wt, hookId) => api.trustHook(wt, hookId),
        }}
      />

      {/* New worktree dialog */}
      <NewWorktreeDialog
        open={showNewWorktree}
        workspacePath={workspacePath}
        gitRepoPath={gitRepoPath}
        managedWorktreesPath={managedWorktreesPath ?? ""}
        refs={refs}
        issueTrackerPatterns={issueTrackerPatterns}
        initiatingWorktreePath={activeWorktree?.path ?? null}
        onClose={onCloseNewWorktree}
        onCreated={onWorktreeCreated}
        onToast={(msg, v) => toast(msg, v)}
      />

      {/* Publish branch dialog */}
      <PublishDialog
        open={showPublishModal}
        activeWorktree={activeWorktree}
        pushStatus={pushStatus ?? null}
        onClose={onClosePublishModal}
        onToast={(msg, v) => toast(msg, v)}
        onPublished={onPublished}
      />

      {/* Create PR dialog */}
      <CreatePrDialog
        open={!!createPrTarget}
        worktree={createPrTarget}
        refs={refs}
        onClose={onCloseCreatePr}
        onToast={(msg, v) => toast(msg, v)}
        onCreated={onPrCreated}
      />

      {/* Run hook dialog */}
      <RunHookDialog
        target={runHookTarget}
        workspacePath={workspacePath}
        activeWorktreePath={activeWorktree?.path ?? null}
        onClose={onCloseRunHookModal}
        onToast={(msg, v) => toast(msg, v)}
      />

      {/* Delete worktree dialog */}
      <DeleteWorktreeDialog
        target={deleteTarget}
        loading={deleteLoading}
        onConfirm={onConfirmDelete}
        onCancel={onCancelDelete}
      />
    </>
  );
}
