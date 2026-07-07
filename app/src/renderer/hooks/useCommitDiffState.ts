import { useState } from "react";
import { api } from "../api.js";
import type { CommitEntry, DiffFileEntry } from "@sproutgit/types";
import type { ToastFn } from "../toast-context.js";

/** Commit/range diff selection state for the Graph tab's diff panel. */
export function useCommitDiffState(params: {
  gitRepoPath: string;
  toast: ToastFn;
}) {
  const { gitRepoPath, toast } = params;

  const [selectedCommits, setSelectedCommits] = useState<CommitEntry[]>([]);
  const [commitDiffRange, setCommitDiffRange] = useState<string | null>(null);
  const [commitDiffFiles, setCommitDiffFiles] = useState<DiffFileEntry[]>([]);
  const [commitDiffContent, setCommitDiffContent] = useState("");
  const [commitDiffFile, setCommitDiffFile] = useState<DiffFileEntry | null>(
    null,
  );
  const [commitDiffLoading, setCommitDiffLoading] = useState(false);
  const [commitDiffFileLoading, setCommitDiffFileLoading] = useState(false);

  const selectedCommit = selectedCommits[0] ?? null;

  function clearCommitDiff() {
    setSelectedCommits([]);
    setCommitDiffFiles([]);
    setCommitDiffContent("");
    setCommitDiffFile(null);
  }

  async function loadCommitDiff(commit: CommitEntry) {
    setSelectedCommits([commit]);
    setCommitDiffFile(null);
    setCommitDiffContent("");
    setCommitDiffLoading(true);
    try {
      const range =
        commit.parents.length > 0
          ? `${commit.parents[0]}..${commit.hash}`
          : commit.hash;
      setCommitDiffRange(range);
      const files = await api.getDiffFiles(gitRepoPath, range);
      setCommitDiffFiles(files as DiffFileEntry[]);
    } catch (err) {
      toast(`Failed to load commit diff: ${String(err)}`, "error");
      setCommitDiffFiles([]);
    } finally {
      setCommitDiffLoading(false);
    }
  }

  async function loadCommitRangeDiff(from: CommitEntry, to: CommitEntry) {
    setSelectedCommits([from, to]);
    setCommitDiffFile(null);
    setCommitDiffContent("");
    setCommitDiffLoading(true);
    try {
      const range = `${from.hash}..${to.hash}`;
      setCommitDiffRange(range);
      const files = await api.getDiffFiles(gitRepoPath, range);
      setCommitDiffFiles(files as DiffFileEntry[]);
    } catch (err) {
      toast(`Failed to load range diff: ${String(err)}`, "error");
      setCommitDiffFiles([]);
    } finally {
      setCommitDiffLoading(false);
    }
  }

  async function loadCommitDiffFile(file: DiffFileEntry) {
    if (!selectedCommit) return;
    setCommitDiffFile(file);
    setCommitDiffFileLoading(true);
    try {
      const range =
        commitDiffRange ??
        (selectedCommit.parents.length > 0
          ? `${selectedCommit.parents[0]}..${selectedCommit.hash}`
          : selectedCommit.hash);
      const content = await api.getDiffContent(gitRepoPath, range, file.path);
      setCommitDiffContent(content as string);
    } catch (err) {
      toast(`Failed to load diff: ${String(err)}`, "error");
      setCommitDiffContent("");
    } finally {
      setCommitDiffFileLoading(false);
    }
  }

  return {
    selectedCommits,
    selectedCommit,
    commitDiffFiles,
    commitDiffContent,
    commitDiffFile,
    commitDiffLoading,
    commitDiffFileLoading,
    loadCommitDiff,
    loadCommitRangeDiff,
    loadCommitDiffFile,
    clearCommitDiff,
  };
}
