import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type GitInfo = {
  installed: boolean;
  version?: string | null;
};

export type WorktreeInfo = {
  path: string;
  head?: string | null;
  branch?: string | null;
  detached: boolean;
};

export type WorktreeListResult = {
  repoPath: string;
  worktrees: WorktreeInfo[];
};

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

export type RecentWorkspace = {
  workspacePath: string;
  lastOpenedAt: number;
};

export type RefInfo = {
  name: string;
  fullName: string;
  kind: 'branch' | 'tag';
  target: string;
};

export type RefsResult = {
  repoPath: string;
  refs: RefInfo[];
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

export type CreateWorktreeResult = {
  worktreePath: string;
  branch: string;
  fromRef: string;
};

export type WorkspaceHookTrigger =
  | 'before_worktree_create'
  | 'after_worktree_create'
  | 'before_worktree_remove'
  | 'after_worktree_remove'
  | 'before_worktree_switch'
  | 'after_worktree_switch';

export type WorkspaceHookShell = 'bash' | 'zsh' | 'pwsh';

export type WorkspaceHook = {
  id: string;
  name: string;
  trigger: WorkspaceHookTrigger;
  shell: WorkspaceHookShell;
  script: string;
  enabled: boolean;
  critical: boolean;
  timeoutSeconds: number;
  createdAt: number;
  updatedAt: number;
  dependencyIds: string[];
};

export type HookUpsertInput = {
  name: string;
  trigger: WorkspaceHookTrigger;
  shell: WorkspaceHookShell;
  script: string;
  enabled: boolean;
  critical: boolean;
  timeoutSeconds: number;
  dependencyIds: string[];
};

export type CheckoutResult = {
  worktreePath: string;
  previousBranch: string | null;
  newBranch: string;
  stashed: boolean;
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

export type HookProgressEvent = {
  trigger: string;
  hookId: string;
  hookName: string;
  phase: 'start' | 'end' | 'skipped';
  status: string;
  stdoutSnippet?: string | null;
  stderrSnippet?: string | null;
  errorMessage?: string | null;
};

export type DeviceCodeResponse = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
};

export type GitHubPollResult = {
  status: 'pending' | 'complete' | 'expired' | 'error';
  username?: string | null;
  error?: string | null;
};

export type GitHubAuthStatus = {
  authenticated: boolean;
  username?: string | null;
  provider: string;
};

export type GitHubRepo = {
  fullName: string;
  cloneUrl: string;
  private: boolean;
  description?: string | null;
};

export type EditorInfo = {
  id: string;
  name: string;
  command: string;
  installed: boolean;
};

export const getGitInfo = () => invoke<GitInfo>('git_info');

export const createWorkspace = (workspacePath: string, repoUrl?: string | null) =>
  invoke<WorkspaceInitResult>('create_sproutgit_workspace', {
    workspacePath,
    repoUrl: repoUrl?.trim() ? repoUrl : null,
  });

export const importGitRepoWorkspace = (workspacePath: string, sourceRepoPath: string) =>
  invoke<WorkspaceInitResult>('import_git_repo_workspace', {
    workspacePath,
    sourceRepoPath,
  });

export const inspectWorkspace = (workspacePath: string) =>
  invoke<WorkspaceStatus>('inspect_sproutgit_workspace', { workspacePath });

export const listRecentWorkspaces = () => invoke<RecentWorkspace[]>('list_recent_workspaces');

export const touchRecentWorkspace = (workspacePath: string) =>
  invoke<void>('touch_recent_workspace', { workspacePath });

export const removeRecentWorkspace = (workspacePath: string) =>
  invoke<void>('remove_recent_workspace', { workspacePath });

export const getAppSetting = (key: string) => invoke<string | null>('get_app_setting', { key });

export const setAppSetting = (key: string, value?: string | null) =>
  invoke<void>('set_app_setting', {
    key,
    value: value?.trim() ? value : null,
  });

export const listWorktrees = (repoPath: string) =>
  invoke<WorktreeListResult>('list_worktrees', { repoPath });

export const listRefs = (repoPath: string) => invoke<RefsResult>('list_refs', { repoPath });

export const getCommitGraph = (repoPath: string, limit = 120) =>
  invoke<CommitGraphResult>('get_commit_graph', { repoPath, limit });

export const createManagedWorktree = (
  rootRepoPath: string,
  managedWorktreesPath: string,
  fromRef: string,
  newBranch: string
) =>
  invoke<CreateWorktreeResult>('create_managed_worktree', {
    rootRepoPath,
    managedWorktreesPath,
    fromRef,
    newBranch,
  });

export const deleteManagedWorktree = (
  rootRepoPath: string,
  worktreePath: string,
  deleteBranch = true
) =>
  invoke<string>('delete_managed_worktree', {
    rootRepoPath,
    worktreePath,
    deleteBranch,
  });

export const checkoutWorktree = (worktreePath: string, targetRef: string, autoStash = true) =>
  invoke<CheckoutResult>('checkout_worktree', {
    worktreePath,
    targetRef,
    autoStash,
  });

export const resetWorktreeBranch = (
  worktreePath: string,
  targetRef: string,
  mode: 'soft' | 'mixed' | 'hard'
) =>
  invoke<string>('reset_worktree_branch', {
    worktreePath,
    targetRef,
    mode,
  });

export const listWorkspaceHooks = (workspacePath: string, trigger?: WorkspaceHookTrigger) =>
  invoke<WorkspaceHook[]>('list_workspace_hooks', {
    workspacePath,
    trigger: trigger ?? null,
  });

export const createWorkspaceHook = (workspacePath: string, input: HookUpsertInput) =>
  invoke<WorkspaceHook>('create_workspace_hook', { workspacePath, input });

export const updateWorkspaceHook = (
  workspacePath: string,
  hookId: string,
  input: HookUpsertInput
) =>
  invoke<WorkspaceHook>('update_workspace_hook', {
    workspacePath,
    hookId,
    input,
  });

export const deleteWorkspaceHook = (workspacePath: string, hookId: string) =>
  invoke<void>('delete_workspace_hook', { workspacePath, hookId });

export const toggleWorkspaceHook = (workspacePath: string, hookId: string, enabled: boolean) =>
  invoke<void>('toggle_workspace_hook', { workspacePath, hookId, enabled });

export const openInEditor = (worktreePath: string) =>
  invoke<string>('open_in_editor', { worktreePath });

export const getDiffFiles = (repoPath: string, commit: string, base?: string | null) =>
  invoke<DiffFilesResult>('get_diff_files', {
    repoPath,
    commit,
    base: base ?? null,
  });

export const getDiffContent = (
  repoPath: string,
  commit: string,
  base?: string | null,
  filePath?: string | null
) =>
  invoke<DiffContentResult>('get_diff_content', {
    repoPath,
    commit,
    base: base ?? null,
    filePath: filePath ?? null,
  });

export const onCloneProgress = (callback: (message: string) => void): Promise<UnlistenFn> =>
  listen<string>('clone-progress', event => callback(event.payload));

export const onHookProgress = (
  callback: (payload: HookProgressEvent) => void
): Promise<UnlistenFn> =>
  listen<HookProgressEvent>('hook-progress', event => callback(event.payload));

export const githubDeviceFlowStart = () => invoke<DeviceCodeResponse>('github_device_flow_start');

export const githubDeviceFlowPoll = (deviceCode: string) =>
  invoke<GitHubPollResult>('github_device_flow_poll', { deviceCode });

export const getGithubAuthStatus = () => invoke<GitHubAuthStatus>('get_github_auth_status');

export const githubLogout = () => invoke<void>('github_logout');

export const listGithubRepos = () => invoke<GitHubRepo[]>('list_github_repos');

export const getHomeDir = () => invoke<string>('get_home_dir');

export const detectEditors = () => invoke<EditorInfo[]>('detect_editors');

export const getGitConfig = (key: string) => invoke<string>('get_git_config', { key });

export const setGitConfig = (key: string, value: string) =>
  invoke<void>('set_git_config', { key, value });
