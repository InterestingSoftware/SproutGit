export type GitInfo = {
  installed: boolean;
  version: string | null;
};

export type WorktreeInfo = {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  /**
   * True when the worktree is neither the repo root nor nested under the
   * managed worktrees directory passed to `listWorktrees` — e.g. one
   * registered by an external tool such as Claude Code. Defaults to `false`
   * when no managed directory was supplied (can't be classified safely).
   * Computed once in the main process so renderer and main agree.
   */
  isExternal: boolean;
};

export type WorktreeListResult = {
  repoPath: string;
  worktrees: WorktreeInfo[];
};

/**
 * State captured from a worktree removal so it can be undone: the exact
 * path it lived at, the branch it was on (if any), and — only when that
 * branch's ref was actually deleted — the SHA it pointed at, since that's
 * the one piece `git worktree remove`/`git branch -D` don't leave any other
 * trace of.
 */
export type WorktreeDeleteResult = {
  worktreePath: string;
  branch: string | null;
  branchSha: string | null;
};

export type RefInfo = {
  name: string;
  fullName: string;
  kind: 'branch' | 'remote' | 'tag';
  target: string;
};

export type RefsResult = {
  repoPath: string;
  refs: RefInfo[];
  /** Short name of the default remote branch (e.g. `origin/main`), if discoverable. */
  defaultRemoteBranch: string | undefined;
};

export type CommitEntry = {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: string;
  subject: string;
  refs: string[];
};

export type CommitGraphResult = {
  repoPath: string;
  commits: CommitEntry[];
};

export type CheckoutResult = {
  worktreePath: string;
  previousBranch: string | null;
  newBranch: string;
  stashed: boolean;
};

export type PushBranchResult = {
  worktreePath: string;
  branch: string;
  upstream: string | null;
  published: boolean;
};

export type WorktreePushStatus = {
  worktreePath: string;
  branch: string | null;
  upstream: string | null;
  remotes: string[];
  suggestedRemote: string | null;
  detached: boolean;
};

/**
 * Summary of what a `git fetch --all --prune` actually did, so the caller
 * can tell "nothing to do because there are no remotes" apart from
 * "nothing to do because everything was already up to date" apart from
 * "fetched N updated ref(s)" — all three look identical as a bare resolved
 * promise, which is what made fetch look like it silently did nothing.
 */
export type FetchSummary = {
  worktreePath: string;
  /** True when the repo has no remotes at all — fetch is skipped entirely. */
  hadNoRemotes: boolean;
  /** Number of remote-tracking branches created or fast-forwarded. */
  updatedRefCount: number;
  /** Number of stale remote-tracking refs removed by `--prune`. */
  prunedRefCount: number;
};

export type StatusFileEntry = {
  path: string;
  originalPath: string | null;
  staged: boolean;
  status: string;
  /** Raw index (staged) status character from git porcelain output. */
  indexStatus: string;
  /** Raw working-tree status character from git porcelain output. */
  workTreeStatus: string;
  /** True for an unmerged path (e.g. `UU`, `AA`, `DD`) — an active merge/rebase conflict. */
  conflicted: boolean;
};

export type WorktreeStatusResult = {
  worktreePath: string;
  files: StatusFileEntry[];
};

/** Content of one git index stage — absent when that side didn't touch the file (e.g. added on only one side). */
export type ConflictStageContent = {
  exists: boolean;
  content: string;
};

export type ConflictFileContentResult = {
  worktreePath: string;
  path: string;
  /** Stage 1 — the common ancestor. */
  base: ConflictStageContent;
  /** Stage 2 — our side of the conflict. */
  ours: ConflictStageContent;
  /** Stage 3 — their side of the conflict. */
  theirs: ConflictStageContent;
};

export type DiffFileEntry = {
  path: string;
  status: string;
  oldPath: string | null;
};

export type DiffFilesResult = {
  commit: string;
  base: string | null;
  files: DiffFileEntry[];
};

export type DiffContentResult = {
  commit: string;
  base: string | null;
  filePath: string | null;
  diff: string;
};

export type GitOpProgressEvent = {
  phase: string;
  message: string;
  percent: number | null;
};

export type StashEntry = {
  /** 0-based position in `git stash list` — newest first. */
  index: number;
  /** Ref usable with apply/pop/drop, e.g. `stash@{0}`. */
  ref: string;
  hash: string;
  message: string;
  date: string;
};

export type StashListResult = {
  worktreePath: string;
  stashes: StashEntry[];
};
