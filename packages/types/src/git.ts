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
   * True when the worktree lives outside `<workspace>/.sproutgit/worktrees/`
   * (and isn't the root) — e.g. one registered by an external tool such as
   * Claude Code. Computed once in the main process so renderer and main agree.
   */
  isExternal: boolean;
};

export type WorktreeListResult = {
  repoPath: string;
  worktrees: WorktreeInfo[];
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

export type StatusFileEntry = {
  path: string;
  originalPath: string | null;
  staged: boolean;
  status: string;
  /** Raw index (staged) status character from git porcelain output. */
  indexStatus: string;
  /** Raw working-tree status character from git porcelain output. */
  workTreeStatus: string;
};

export type WorktreeStatusResult = {
  worktreePath: string;
  files: StatusFileEntry[];
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
