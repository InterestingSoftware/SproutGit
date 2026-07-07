import { api } from './api.js';
/**
 * Centralised query keys and custom useQuery/useMutation hooks for all
 * workspace data that comes from the Electron main process via IPC.
 *
 * Server state lives here.  UI state (activeWorktree, activeTab, terminals,
 * hook progress, etc.) stays in Zustand (workspace-store.ts).
 */

import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CommitEntry, RefInfo, WorktreeInfo, WorkspaceStatus, WorktreePushStatus, IssueTrackerPattern, FetchSummary, FileTreeNode, WorktreeHealth, GitHubAuthStatus, PullRequestStatus, PullRequestInfo, MergeMethod, MergePullRequestResult } from '@sproutgit/types';

// ── Query key factory ─────────────────────────────────────────────────────────

export const qk = {
  workspace: (workspacePath: string) => ['workspace', workspacePath] as const,
  worktrees: (gitRepoPath: string) => ['worktrees', gitRepoPath] as const,
  commits: (gitRepoPath: string) => ['commits', gitRepoPath] as const,
  commitCount: (gitRepoPath: string) => ['commitCount', gitRepoPath] as const,
  refs: (gitRepoPath: string) => ['refs', gitRepoPath] as const,
  pushStatus: (worktreePath: string) => ['pushStatus', worktreePath] as const,
  worktreeStatus: (worktreePath: string) => ['worktreeStatus', worktreePath] as const,
  worktreeChangeCounts: (gitRepoPath: string) => ['worktreeChangeCounts', gitRepoPath] as const,
  worktreeHealth: (gitRepoPath: string) => ['worktreeHealth', gitRepoPath] as const,
  diffFiles: (repoPath: string, range: string) => ['diffFiles', repoPath, range] as const,
  diffContent: (repoPath: string, range: string, file: string, staged?: boolean) =>
    ['diffContent', repoPath, range, file, staged] as const,
  issueTrackerPatterns: (worktreePath: string) => ['issueTrackerPatterns', worktreePath] as const,
  fileTree: (worktreePath: string) => ['fileTree', worktreePath] as const,
  githubAuthStatus: () => ['githubAuthStatus'] as const,
  prStatus: (worktreePath: string) => ['prStatus', worktreePath] as const,
} as const;

// ── Workspace inspection ──────────────────────────────────────────────────────

export function useWorkspaceStatus(workspacePath: string) {
  return useQuery({
    queryKey: qk.workspace(workspacePath),
    queryFn: () => api.inspectWorkspace(workspacePath) as Promise<WorkspaceStatus>,
    enabled: !!workspacePath,
    staleTime: Infinity, // workspace layout doesn't change at runtime
  });
}

// ── Worktrees ─────────────────────────────────────────────────────────────────

export function useWorktrees(gitRepoPath: string, managedWorktreesPath?: string) {
  return useQuery({
    queryKey: qk.worktrees(gitRepoPath),
    queryFn: () => api.listWorktrees(gitRepoPath, managedWorktreesPath) as Promise<WorktreeInfo[]>,
    enabled: !!gitRepoPath,
  });
}

// ── Commits ───────────────────────────────────────────────────────────────────

const COMMIT_PAGE_SIZE = 500;

export function useCommits(gitRepoPath: string) {
  return useQuery({
    queryKey: qk.commits(gitRepoPath),
    queryFn: () =>
      api.getCommitGraph({ repoPath: gitRepoPath, limit: COMMIT_PAGE_SIZE, skip: 0 }) as Promise<CommitEntry[]>,
    enabled: !!gitRepoPath,
  });
}

export function useCommitCount(gitRepoPath: string) {
  return useQuery({
    queryKey: qk.commitCount(gitRepoPath),
    queryFn: () => api.countCommits(gitRepoPath) as Promise<number>,
    enabled: !!gitRepoPath,
    staleTime: 30_000,
  });
}

// ── Refs ──────────────────────────────────────────────────────────────────────

export function useRefs(gitRepoPath: string) {
  return useQuery({
    queryKey: qk.refs(gitRepoPath),
    queryFn: async () => {
      const result = await api.listRefs(gitRepoPath) as { refs: RefInfo[] };
      return result.refs;
    },
    enabled: !!gitRepoPath,
  });
}

// ── Issue tracker ─────────────────────────────────────────────────────────────

export function useIssueTrackerPatterns(worktreePath: string | undefined) {
  return useQuery({
    queryKey: qk.issueTrackerPatterns(worktreePath ?? ''),
    queryFn: () => api.listIssueTrackerPatterns(worktreePath ?? '') as Promise<IssueTrackerPattern[]>,
    enabled: !!worktreePath,
  });
}

// ── File tree ─────────────────────────────────────────────────────────────────

export function useFileTree(worktreePath: string | undefined) {
  return useQuery({
    queryKey: qk.fileTree(worktreePath ?? ''),
    queryFn: () => api.listFileTree(worktreePath ?? '') as Promise<FileTreeNode[]>,
    enabled: !!worktreePath,
  });
}

// ── Push status ───────────────────────────────────────────────────────────────

export function usePushStatus(worktreePath: string | undefined) {
  return useQuery({
    queryKey: qk.pushStatus(worktreePath ?? ''),
    queryFn: () => api.getPushStatus(worktreePath!) as Promise<WorktreePushStatus>,
    enabled: !!worktreePath,
    staleTime: 10_000,
  });
}

// ── Worktree change counts (badge numbers in sidebar) ─────────────────────────

/**
 * Actively fetches git status for every non-root worktree and returns a map
 * of { [worktreePath]: changedFileCount }.  Uses useQueries so each worktree
 * gets its own TanStack Query entry (shared cache with the staging panel).
 */
export function useWorktreeChangeCounts(
  worktrees: WorktreeInfo[],
  rootPath?: string,
) {
  const targets = worktrees.filter(w => w.path !== rootPath && !!w.path);

  const results = useQueries({
    queries: targets.map(wt => ({
      queryKey: qk.worktreeStatus(wt.path),
      queryFn: async () => {
        const result = await api.getStatus(wt.path) as { files: import('@sproutgit/types').StatusFileEntry[] };
        return result.files;
      },
      staleTime: 5_000,
      refetchInterval: 15_000,
      retry: 0,
      throwOnError: false,
    })),
  });

  const counts: Record<string, number> = {};
  for (let i = 0; i < targets.length; i++) {
    counts[targets[i]!.path] = results[i]?.data?.length ?? 0;
  }
  return counts;
}

// ── Worktree health (ahead/behind, dirty count, last-commit age) ─────────────

/**
 * Fetches ahead/behind counts, dirty count, and last-commit age for every
 * non-root worktree in a single batched IPC call (the main process runs the
 * underlying git commands with a concurrency limit — see
 * `getWorktreesHealth` in `@sproutgit/git`).
 */
export function useWorktreeHealth(
  gitRepoPath: string,
  worktrees: WorktreeInfo[],
  rootPath?: string,
) {
  const targets = worktrees.filter(w => w.path !== rootPath && !!w.path).map(w => w.path);

  return useQuery({
    queryKey: qk.worktreeHealth(gitRepoPath),
    queryFn: () => api.getWorktreesHealth({ repoPath: gitRepoPath, worktreePaths: targets }) as Promise<Partial<Record<string, WorktreeHealth>>>,
    enabled: !!gitRepoPath && targets.length > 0,
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
}

// ── GitHub PR status ─────────────────────────────────────────────────────────

export function useGithubAuthStatus() {
  return useQuery({
    queryKey: qk.githubAuthStatus(),
    queryFn: () => api.githubAuthStatus() as Promise<GitHubAuthStatus>,
    staleTime: 30_000,
    retry: 0,
  });
}

/**
 * Fetches PR + combined check status for every non-root worktree, one query
 * per worktree (mirrors useWorktreeChangeCounts). Gated on GitHub being
 * connected — when it's not, no IPC calls fire and every entry is null,
 * which the sidebar treats as "no PR info" rather than an error.
 */
export function usePrStatuses(
  worktrees: WorktreeInfo[],
  rootPath: string | undefined,
  githubConnected: boolean,
) {
  // Waits for rootPath to resolve (rather than just excluding `undefined`)
  // so the still-unknown root worktree doesn't get a wasted PR-status IPC
  // call/refetch cycle before workspaceStatus has loaded.
  const targets = rootPath ? worktrees.filter(w => w.path !== rootPath && !!w.path) : [];

  const results = useQueries({
    queries: targets.map(wt => ({
      queryKey: qk.prStatus(wt.path),
      queryFn: () => api.githubGetPrStatus(wt.path) as Promise<PullRequestStatus | null>,
      enabled: githubConnected && !!rootPath,
      staleTime: 30_000,
      refetchInterval: 60_000,
      retry: 0,
      throwOnError: false,
    })),
  });

  const statuses: Record<string, PullRequestStatus | null> = {};
  for (let i = 0; i < targets.length; i++) {
    statuses[targets[i]!.path] = results[i]?.data ?? null;
  }
  return statuses;
}

/** Toggles a PR between draft and ready for review, refetching its PR status on success. */
export function useSetPrReady(worktreePath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ready: boolean) => api.githubSetPrReady({ worktreePath, ready }) as Promise<PullRequestInfo>,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.prStatus(worktreePath) }),
  });
}

/** Merges the PR for `worktreePath`, refetching its PR status on success. */
export function useMergePr(worktreePath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (method: MergeMethod) => api.githubMergePr({ worktreePath, method }) as Promise<MergePullRequestResult>,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.prStatus(worktreePath) }),
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useFetch(worktreePath: string, gitRepoPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.fetch(worktreePath) as Promise<FetchSummary>,
    onSuccess: (summary) => {
      // No point invalidating anything when there was nothing to fetch
      // (no remotes) or nothing changed — avoids a pointless refetch storm
      // on every click of a no-op fetch.
      if (summary.hadNoRemotes || (summary.updatedRefCount === 0 && summary.prunedRefCount === 0)) return;
      void qc.invalidateQueries({ queryKey: qk.commits(gitRepoPath) });
      void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
      void qc.invalidateQueries({ queryKey: qk.pushStatus(worktreePath) });
    },
  });
}

/** Turns a `FetchSummary` into a single human-readable line for a toast. */
export function describeFetchSummary(summary: FetchSummary): string {
  if (summary.hadNoRemotes) return 'No remotes configured — nothing to fetch';
  if (summary.updatedRefCount === 0 && summary.prunedRefCount === 0) return 'Already up to date';
  const parts: string[] = [];
  if (summary.updatedRefCount > 0) {
    parts.push(`${summary.updatedRefCount} ref${summary.updatedRefCount === 1 ? '' : 's'} updated`);
  }
  if (summary.prunedRefCount > 0) {
    parts.push(`${summary.prunedRefCount} stale ref${summary.prunedRefCount === 1 ? '' : 's'} pruned`);
  }
  return `Fetched — ${parts.join(', ')}`;
}

export function usePull(worktreePath: string, gitRepoPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.pull(worktreePath) as Promise<void>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.commits(gitRepoPath) });
      void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
      void qc.invalidateQueries({ queryKey: qk.worktrees(gitRepoPath) });
      void qc.invalidateQueries({ queryKey: qk.pushStatus(worktreePath) });
    },
  });
}

export function usePush(worktreePath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.push(worktreePath) as Promise<void>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.pushStatus(worktreePath) });
    },
  });
}

export function useDeleteWorktree(gitRepoPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { workspacePath: string; rootRepoPath: string; managedWorktreesPath?: string; worktreePath: string; deleteBranch: boolean; branchName?: string | null; initiatingWorktreePath?: string | null; afterRemoveWorktreePath?: string | null }) =>
      api.deleteWorktree(args) as Promise<void>,
    onSuccess: (_data, args) => {
      // Remove cached status for the deleted worktree so no in-flight refetch
      // can fire against the now-missing directory and show an error toast.
      qc.removeQueries({ queryKey: qk.worktreeStatus(args.worktreePath) });
      void qc.invalidateQueries({ queryKey: qk.worktrees(gitRepoPath) });
      void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
    },
  });
}
