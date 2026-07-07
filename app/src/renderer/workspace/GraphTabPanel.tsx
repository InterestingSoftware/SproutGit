import { CommitGraph } from "@sproutgit/ui";
import { CommitDiffPanel } from "./CommitDiffPanel.js";
import { api } from "../api.js";
import { qk } from "../queries.js";
import type { useQueryClient } from "@tanstack/react-query";
import type {
  CommitEntry,
  DiffFileEntry,
  IssueTrackerPattern,
  WorktreeInfo,
} from "@sproutgit/types";
import type { ToastFn } from "../toast-context.js";

type Props = {
  commits: CommitEntry[];
  worktrees: WorktreeInfo[];
  activeWorktree: WorktreeInfo | null;
  commitTotal: number;
  commitsFetching: boolean;
  gitRepoPath: string;
  issueTrackerPatterns: IssueTrackerPattern[];
  qc: ReturnType<typeof useQueryClient>;
  toast: ToastFn;
  onCreateWorktree: () => void;

  selectedCommits: CommitEntry[];
  selectedCommit: CommitEntry | null;
  commitDiffFiles: DiffFileEntry[];
  commitDiffContent: string;
  commitDiffFile: DiffFileEntry | null;
  commitDiffLoading: boolean;
  commitDiffFileLoading: boolean;
  onSelectCommit: (commit: CommitEntry) => void;
  onSelectCommitRange: (from: CommitEntry, to: CommitEntry) => void;
  onClearCommitSelection: () => void;
  onSelectDiffFile: (file: DiffFileEntry) => void;
};

/** Graph tab: commit graph plus, when a commit/range is selected, its diff panel. */
export function GraphTabPanel({
  commits,
  worktrees,
  activeWorktree,
  commitTotal,
  commitsFetching,
  gitRepoPath,
  issueTrackerPatterns,
  qc,
  toast,
  onCreateWorktree,
  selectedCommits,
  selectedCommit,
  commitDiffFiles,
  commitDiffContent,
  commitDiffFile,
  commitDiffLoading,
  commitDiffFileLoading,
  onSelectCommit,
  onSelectCommitRange,
  onClearCommitSelection,
  onSelectDiffFile,
}: Props) {
  return (
    <div className="flex flex-col h-full">
      <div
        className={
          selectedCommit
            ? "h-1/2 min-h-0 overflow-hidden flex flex-col"
            : "flex-1 min-h-0 overflow-hidden flex flex-col"
        }
      >
        <CommitGraph
          commits={commits}
          worktrees={worktrees}
          activeWorktree={activeWorktree}
          hasMore={commits.length < commitTotal}
          loadingMore={commitsFetching && commits.length > 0}
          onLoadMore={async () => {
            const more = (await api.getCommitGraph({
              repoPath: gitRepoPath,
              limit: 500,
              skip: commits.length,
            })) as CommitEntry[];
            qc.setQueryData<CommitEntry[]>(qk.commits(gitRepoPath), (prev) => [
              ...(prev ?? []),
              ...more,
            ]);
          }}
          onSelect={(selected) => {
            const nextSelectionKey = selected.map((c) => c.hash).join(",");
            const currentSelectionKey = selectedCommits
              .map((c) => c.hash)
              .join(",");
            if (nextSelectionKey === currentSelectionKey) {
              return;
            }
            if (selected.length === 1 && selected[0]) {
              onSelectCommit(selected[0]);
            } else if (selected.length === 2 && selected[0] && selected[1]) {
              onSelectCommitRange(selected[0], selected[1]);
            } else {
              onClearCommitSelection();
            }
          }}
          onCreateWorktree={() => {
            onCreateWorktree();
          }}
          onCheckout={(ref) => {
            if (activeWorktree) {
              void api
                .checkout(activeWorktree.path, ref)
                .then(() => {
                  toast("Checked out", "success");
                  void qc.invalidateQueries({
                    queryKey: qk.commits(gitRepoPath),
                  });
                  void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
                })
                .catch((err: unknown) => toast(String(err), "error"));
            }
          }}
          onReset={(ref, mode) => {
            if (activeWorktree) {
              void api
                .reset(activeWorktree.path, ref, mode)
                .then(() => {
                  toast(`Reset (${mode}) complete`, "success");
                  void qc.invalidateQueries({
                    queryKey: qk.commits(gitRepoPath),
                  });
                  void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
                })
                .catch((err: unknown) => toast(String(err), "error"));
            }
          }}
          issueTrackerPatterns={issueTrackerPatterns}
        />
      </div>
      {selectedCommit && (
        <CommitDiffPanel
          commit={selectedCommit}
          files={commitDiffFiles}
          loading={commitDiffLoading}
          selectedFile={commitDiffFile}
          diffContent={commitDiffContent}
          issueTrackerPatterns={issueTrackerPatterns}
          diffLoading={commitDiffFileLoading}
          onSelectFile={onSelectDiffFile}
          onClose={onClearCommitSelection}
        />
      )}
    </div>
  );
}
