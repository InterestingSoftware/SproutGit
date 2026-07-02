import { api } from './api.js';
/**
 * Centralised query keys and custom useQuery/useMutation hooks for all
 * workspace data that comes from the Electron main process via IPC.
 *
 * Server state lives here.  UI state (activeWorktree, activeTab, terminals,
 * hook progress, etc.) stays in Zustand (workspace-store.ts).
 */

import {
  useQuery,
  useQueries,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import type { CommitEntry, RefInfo, WorktreeInfo, WorkspaceStatus, WorktreePushStatus, IssueTrackerPattern } from '@sproutgit/types';

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
  diffFiles: (repoPath: string, range: string) => ['diffFiles', repoPath, range] as const,
  diffContent: (repoPath: string, range: string, file: string, staged?: boolean) =>
    ['diffContent', repoPath, range, file, staged] as const,
  issueTrackerPatterns: (worktreePath: string) => ['issueTrackerPatterns', worktreePath] as const,
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

// ── Push status ───────────────────────────────────────────────────────────────

export function usePushStatus(worktreePath: string | undefined) {
  return useQuery({
    queryKey: qk.pushStatus(worktreePath ?? ''),
    queryFn: () => api.getPushStatus(worktreePath!) as Promise<WorktreePushStatus>,
    enabled: !!worktreePath,
    staleTime: 10_000,
  });
}

// ── Worktree file status ──────────────────────────────────────────────────────

export function useWorktreeStatus(worktreePath: string | undefined) {
  return useQuery({
    queryKey: qk.worktreeStatus(worktreePath ?? ''),
    queryFn: async () => {
      const result = await api.getStatus(worktreePath!) as { files: import('@sproutgit/types').StatusFileEntry[] };
      return result.files;
    },
    enabled: !!worktreePath,
    staleTime: 0, // always fresh for the staging panel
    retry: 0,
    // Don't bubble status errors to the global QueryCache.onError toast —
    // transient failures (e.g. worktree deleted mid-flight) are self-healing.
    throwOnError: false,
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

// ── Diff ──────────────────────────────────────────────────────────────────────

export function useDiffFiles(repoPath: string, range: string | null) {
  return useQuery({
    queryKey: qk.diffFiles(repoPath, range ?? ''),
    queryFn: () =>
      api.getDiffFiles(repoPath, range!) as Promise<import('@sproutgit/types').DiffFileEntry[]>,
    enabled: !!repoPath && !!range,
    staleTime: Infinity,
  });
}

export function useDiffContent(
  repoPath: string,
  range: string | null,
  file: string | null,
  staged?: boolean,
  opts?: Partial<UseQueryOptions<string>>,
) {
  return useQuery({
    queryKey: qk.diffContent(repoPath, range ?? '', file ?? '', staged),
    queryFn: async () => {
      if (staged !== undefined) {
        // Working-tree diff (unstaged)
        if (!staged) return api.getWorkingDiff(repoPath, file!) as Promise<string>;
        // Staged diff
        return api.getDiffContent(repoPath, 'HEAD', file!) as Promise<string>;
      }
      return api.getDiffContent(repoPath, range!, file!) as Promise<string>;
    },
    enabled: !!repoPath && !!range && !!file,
    staleTime: Infinity,
    ...opts,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useStageFiles(worktreePath: string, gitRepoPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paths: string[]) => api.stageFiles(worktreePath, paths) as Promise<void>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.worktreeStatus(worktreePath) });
      void qc.invalidateQueries({ queryKey: qk.worktreeChangeCounts(gitRepoPath) });
    },
  });
}

export function useUnstageFiles(worktreePath: string, gitRepoPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paths: string[]) => api.unstageFiles(worktreePath, paths) as Promise<void>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.worktreeStatus(worktreePath) });
      void qc.invalidateQueries({ queryKey: qk.worktreeChangeCounts(gitRepoPath) });
    },
  });
}

export function useCreateCommit(worktreePath: string, gitRepoPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => api.createCommit(worktreePath, message) as Promise<void>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.worktreeStatus(worktreePath) });
      void qc.invalidateQueries({ queryKey: qk.commits(gitRepoPath) });
      void qc.invalidateQueries({ queryKey: qk.commitCount(gitRepoPath) });
      void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
    },
  });
}

export function useFetch(worktreePath: string, gitRepoPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.fetch(worktreePath) as Promise<void>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.commits(gitRepoPath) });
      void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
      void qc.invalidateQueries({ queryKey: qk.pushStatus(worktreePath) });
    },
  });
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
    mutationFn: (args: { rootRepoPath: string; managedWorktreesPath?: string; worktreePath: string; deleteBranch: boolean; branchName?: string | null }) =>
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
