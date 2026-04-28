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
  | 'after_worktree_switch'
  | 'manual';

export type WorkspaceHookScope = 'worktree' | 'workspace';

export type WorkspaceHookShell = 'bash' | 'zsh' | 'pwsh' | 'powershell';

export type WorkspaceHook = {
  id: string;
  name: string;
  scope: WorkspaceHookScope;
  trigger: WorkspaceHookTrigger;
  shell: WorkspaceHookShell;
  script: string;
  enabled: boolean;
  critical: boolean;
  keepOpenOnCompletion: boolean;
  timeoutSeconds: number;
  createdAt: number;
  updatedAt: number;
  dependencyIds: string[];
};

export type HookUpsertInput = {
  name: string;
  scope: WorkspaceHookScope;
  trigger: WorkspaceHookTrigger;
  shell: WorkspaceHookShell;
  script: string;
  enabled: boolean;
  critical: boolean;
  keepOpenOnCompletion: boolean;
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
  keepOpenOnCompletion?: boolean;
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

export type GitHubAuthStorageMigration = {
  migrated: boolean;
  storageBackend: 'keychain' | 'file' | 'none';
  hadLegacyFileToken: boolean;
  error?: string | null;
};

export type GitHubRepo = {
  fullName: string;
  cloneUrl: string;
  private: boolean;
  description?: string | null;
};

export type GitHubEmailSuggestion = {
  label: string;
  email: string;
  kind: string;
  primary: boolean;
  verified: boolean;
};

export type EditorInfo = {
  id: string;
  name: string;
  command: string;
  installed: boolean;
};

export type GitToolInfo = {
  id: string;
  name: string;
  command: string;
  installed: boolean;
  supportsDiff: boolean;
  supportsMerge: boolean;
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

export type ImportRepoMode = 'inPlace' | 'move' | 'copy';

export const importGitRepoWorkspaceWithMode = (
  sourceRepoPath: string,
  mode: ImportRepoMode,
  workspacePath?: string | null
) =>
  invoke<WorkspaceInitResult>('import_git_repo_workspace_with_mode', {
    sourceRepoPath,
    mode,
    workspacePath: workspacePath?.trim() ? workspacePath : null,
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

export const getCommitGraph = (repoPath: string, limit?: number | null, skip?: number | null) =>
  invoke<CommitGraphResult>('get_commit_graph', {
    repoPath,
    limit: limit ?? null,
    skip: skip ?? null,
  });

export const countCommits = (repoPath: string) =>
  invoke<number>('count_commits', { repoPath });

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

export const getAvailableHookShells = () =>
  invoke<WorkspaceHookShell[]>('get_available_hook_shells');

export const runWorkspaceHook = (workspacePath: string, hookId: string, worktreePath: string) =>
  invoke<void>('run_workspace_hook', { workspacePath, hookId, worktreePath });

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

export const onImportProgress = (callback: (message: string) => void): Promise<UnlistenFn> =>
  listen<string>('import-progress', event => callback(event.payload));

export const onHookProgress = (
  callback: (payload: HookProgressEvent) => void
): Promise<UnlistenFn> =>
  listen<HookProgressEvent>('hook-progress', event => callback(event.payload));

export const githubDeviceFlowStart = () => invoke<DeviceCodeResponse>('github_device_flow_start');

export const githubDeviceFlowPoll = (deviceCode: string) =>
  invoke<GitHubPollResult>('github_device_flow_poll', { deviceCode });

export const migrateGithubAuthStorage = () =>
  invoke<GitHubAuthStorageMigration>('migrate_github_auth_storage');

export const getGithubAuthStatus = () => invoke<GitHubAuthStatus>('get_github_auth_status');

export const githubLogout = () => invoke<void>('github_logout');

export const listGithubRepos = () => invoke<GitHubRepo[]>('list_github_repos');

export const listGithubEmailSuggestions = () =>
  invoke<GitHubEmailSuggestion[]>('list_github_email_suggestions');

export const getHomeDir = () => invoke<string>('get_home_dir');

export const detectEditors = () => invoke<EditorInfo[]>('detect_editors');

export const detectGitTools = () => invoke<GitToolInfo[]>('detect_git_tools');

export const getGitConfig = (key: string) => invoke<string>('get_git_config', { key });

export const setGitConfig = (key: string, value: string) =>
  invoke<void>('set_git_config', { key, value });

export type StatusFileEntry = {
  path: string;
  origPath?: string;
  indexStatus: string;
  workTreeStatus: string;
};

export type WorktreeStatusResult = {
  worktreePath: string;
  files: StatusFileEntry[];
};

export type CommitResult = {
  hash: string;
  shortHash: string;
  subject: string;
};

export type WorkingDiffResult = {
  worktreePath: string;
  filePath: string | null;
  staged: boolean;
  diff: string;
};

export const getWorktreeStatus = (worktreePath: string) =>
  invoke<WorktreeStatusResult>('get_worktree_status', { worktreePath });

export const stageFiles = (worktreePath: string, paths: string[]) =>
  invoke<WorktreeStatusResult>('stage_files', { worktreePath, paths });

export const unstageFiles = (worktreePath: string, paths: string[]) =>
  invoke<WorktreeStatusResult>('unstage_files', { worktreePath, paths });

export const createCommit = (worktreePath: string, message: string) =>
  invoke<CommitResult>('create_commit', { worktreePath, message });

export const getWorkingDiff = (worktreePath: string, staged: boolean, filePath?: string) =>
  invoke<WorkingDiffResult>('get_working_diff', {
    worktreePath,
    staged,
    filePath: filePath || null,
  });

// ── File Watcher ──

export const startWatchingWorktrees = (paths: string[], rootPath?: string | null) =>
  invoke<void>('start_watching_worktrees', { paths, rootPath: rootPath ?? null });

export const stopWatchingWorktrees = () => invoke<void>('stop_watching_worktrees');

export const onWorktreeChanged = (callback: (worktreePath: string) => void): Promise<UnlistenFn> =>
  listen<string>('worktree-changed', event => callback(event.payload));

// ── Terminal ──

export const listAvailableShells = () => invoke<string[]>('list_available_shells');

export const spawnTerminal = (shell: string, cwd: string, cols: number, rows: number) =>
  invoke<string>('spawn_terminal', { shell, cwd, cols, rows });

export const terminalInput = (ptyId: string, data: string) =>
  invoke<void>('terminal_input', { ptyId, data });

export const terminalResize = (ptyId: string, cols: number, rows: number) =>
  invoke<void>('terminal_resize', { ptyId, cols, rows });

export const closeTerminal = (ptyId: string) => invoke<void>('close_terminal', { ptyId });

export const onTerminalOutput = (
  ptyId: string,
  callback: (data: string) => void
): Promise<UnlistenFn> =>
  listen<string>(`terminal-output-${ptyId}`, event => callback(event.payload));

export const onTerminalClosed = (ptyId: string, callback: () => void): Promise<UnlistenFn> =>
  listen<void>(`terminal-closed-${ptyId}`, () => callback());
