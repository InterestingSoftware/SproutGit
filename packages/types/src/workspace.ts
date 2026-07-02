export type WorkspaceInitResult = {
  workspacePath: string;
  rootPath: string;
  worktreesPath: string;
  metadataPath: string;
  stateDbPath: string;
  cloned: boolean;
};

export type WorkspaceStatus = {
  workspacePath: string;
  /** Path to use for all git operations — always the bare repo at
   * .sproutgit/root (equal to `rootPath`) once a workspace is recognised. */
  gitRepoPath: string;
  rootPath: string;
  worktreesPath: string;
  metadataPath: string;
  stateDbPath: string;
  isSproutgitProject: boolean;
  rootExists: boolean;
  worktreesExists: boolean;
  metadataExists: boolean;
  stateDbExists: boolean;
};

export type ImportRepoMode = 'inPlace' | 'move' | 'copy';

export type RecentWorkspace = {
  workspacePath: string;
  lastOpenedAt: number;
};

export type CreateWorktreeResult = {
  worktreePath: string;
  branch: string;
  fromRef: string;
};

export type WorktreeProvenance = {
  worktreePath: string;
  branch: string;
  sourceRef: string;
  initiatingWorktreePath: string | null;
  rootRepoPath: string;
  createdAt: number;
  updatedAt: number;
};

export type NestedRepoSyncRule = {
  repoRelativePath: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type NestedRepoSyncRuleInput = {
  repoRelativePath: string;
  enabled: boolean;
};

export type WorktreeChangedEvent = {
  worktreePath: string;
  repoPath: string;
};
