import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type IpcMap } from '@sproutgit/types';
import type {
  GitInfo,
  WorktreeInfo,
  CommitEntry,
  RefInfo,
  RefsResult,
  WorktreeStatusResult,
  DiffFileEntry,
  WorktreePushStatus,
  FetchSummary,
  DeviceCodeResponse,
  GitHubPollResult,
  GitHubAuthStatus,
  GitHubEmailSuggestion,
  GitHubRepo,
  PullRequestStatus,
  PullRequestInfo,
  EditorInfo,
  GitToolInfo,
  WorkspaceInitResult,
  WorkspaceStatus,
  ImportRepoMode,
  HookProgressEvent,
  HookTerminalLaunchEvent,
  HookListResult,
  HookUpsertInput,
  WorkspaceHookTrigger,
  WorktreeChangedEvent,
  GitOpProgressEvent,
  TerminalInfo,
  WorktreeMetaRow,
  WorktreeProvenance,
  NestedRepoSyncRule,
  RecentWorkspace,
  CreateWorktreeResult,
  WorktreeSwitchHookSource,
  AgentConfig,
  AgentTerminalLaunchEvent,
  AcpAdapterStatus,
  AcpAdapterInstallEvent,
  CommitMessageGeneratorSettings,
  CommitMessageGenerateResult,
  IssueTrackerPattern,
  ProviderIssue,
  ToolTestResult,
  ChatSessionEvent,
  ChatSessionExitEvent,
  ChatConfigOption,
  FileTreeNode,
  FileReadResult,
  FileChangedEvent,
  McpClientId,
  McpServerStatus,
  McpConfigWriteResult,
  GlobalErrorEvent,
  ProjectIdeaGenerateResult,
} from '@sproutgit/types';

/**
 * Typed invoke: enforces that args and result match the IpcMap contract.
 * This is the ONLY place ipcRenderer.invoke is called for request/response
 * channels — it prevents the preload from lying about return types.
 */
function invoke<K extends keyof IpcMap>(
  channel: K,
  ...args: IpcMap[K]['args']
): Promise<IpcMap[K]['result']> {
  // ipcRenderer.invoke accepts (channel, ...args); spread is safe here.
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcMap[K]['result']>;
}

/**
 * Exposes a typed `window.api` object to the renderer via contextBridge.
 * All Electron IPC channels are proxied here — the renderer has no access
 * to Node.js or the Electron internals.
 */
const api = {
  // ── Git info ──────────────────────────────────────────────────────────────
  gitInfo: (): Promise<GitInfo> =>
    invoke(IPC.GIT_INFO),

  // ── Git config ────────────────────────────────────────────────────────────
  getGitConfig: (key: string): Promise<string | null> =>
    invoke(IPC.GIT_GET_CONFIG, key),

  setGitConfig: (key: string, value: string): Promise<void> =>
    invoke(IPC.GIT_SET_CONFIG, { key, value }),

  // ── Worktrees ─────────────────────────────────────────────────────────────
  listWorktrees: (repoPath: string, managedWorktreesPath?: string): Promise<WorktreeInfo[]> =>
    invoke(IPC.GIT_LIST_WORKTREES, repoPath, managedWorktreesPath),

  createWorktree: (args: {
    workspacePath: string;
    rootRepoPath: string;
    managedWorktreesPath: string;
    fromRef: string;
    newBranch: string;
    initiatingWorktreePath?: string | null;
    issueRef?: string | null;
    issueTitle?: string | null;
    orphan?: boolean;
  }): Promise<CreateWorktreeResult> =>
    invoke(IPC.WORKTREE_CREATE, args),

  deleteWorktree: (args: {
    workspacePath: string;
    rootRepoPath: string;
    managedWorktreesPath?: string;
    worktreePath: string;
    deleteBranch: boolean;
    branchName?: string | null;
    initiatingWorktreePath?: string | null;
    afterRemoveWorktreePath?: string | null;
  }): Promise<void> =>
    invoke(IPC.WORKTREE_DELETE, args),

  pruneWorktreeMetadata: (args: { workspacePath: string; activeWorktreePaths: string[] }): Promise<void> =>
    invoke(IPC.WORKTREE_PRUNE_METADATA, args),

  // ── Commits ───────────────────────────────────────────────────────────────
  getCommitGraph: (args: {
    repoPath: string;
    limit?: number;
    skip?: number;
  }): Promise<CommitEntry[]> =>
    invoke(IPC.GIT_COMMIT_GRAPH, args),

  countCommits: (repoPath: string): Promise<number> =>
    invoke(IPC.GIT_COUNT_COMMITS, repoPath),

  listRefs: (repoPath: string): Promise<RefsResult> =>
    invoke(IPC.GIT_LIST_REFS, repoPath),

  // ── Staging ───────────────────────────────────────────────────────────────
  getStatus: (worktreePath: string): Promise<WorktreeStatusResult> =>
    invoke(IPC.GIT_STATUS, worktreePath),

  stageFiles: (worktreePath: string, paths: string[]): Promise<void> =>
    invoke(IPC.GIT_STAGE, { worktreePath, paths }),

  unstageFiles: (worktreePath: string, paths: string[]): Promise<void> =>
    invoke(IPC.GIT_UNSTAGE, { worktreePath, paths }),

  createCommit: (worktreePath: string, message: string): Promise<void> =>
    invoke(IPC.GIT_COMMIT, { worktreePath, message }),

  checkout: (worktreePath: string, targetRef: string): Promise<void> =>
    invoke(IPC.GIT_CHECKOUT, { worktreePath, targetRef }),

  reset: (worktreePath: string, targetRef: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> =>
    invoke(IPC.GIT_RESET, { worktreePath, targetRef, mode }),

  // ── Remote ────────────────────────────────────────────────────────────────
  fetch: (worktreePath: string): Promise<FetchSummary> =>
    invoke(IPC.GIT_FETCH, worktreePath),

  pull: (worktreePath: string): Promise<void> =>
    invoke(IPC.GIT_PULL, worktreePath),

  push: (worktreePath: string, remote?: string): Promise<void> =>
    invoke(IPC.GIT_PUSH, remote ? { worktreePath, remote } : { worktreePath }),

  getPushStatus: (worktreePath: string): Promise<WorktreePushStatus> =>
    invoke(IPC.GIT_PUSH_STATUS, worktreePath),

  // ── Diff ─────────────────────────────────────────────────────────────────
  getDiffFiles: (repoPath: string, range: string): Promise<DiffFileEntry[]> =>
    invoke(IPC.GIT_DIFF_FILES, { repoPath, range }),

  getDiffContent: (repoPath: string, range: string, file?: string): Promise<string> =>
    invoke(IPC.GIT_DIFF_CONTENT, file ? { repoPath, range, file } : { repoPath, range }),

  getWorkingDiff: (worktreePath: string, file?: string): Promise<string> =>
    invoke(IPC.GIT_WORKING_DIFF, file ? { worktreePath, file } : { worktreePath }),

  // ── Terminal ──────────────────────────────────────────────────────────────
  createTerminal: (args: {
    cwd: string;
    shell?: string;
    label?: string;
    cols?: number;
    rows?: number;
  }): Promise<string> =>
    invoke(IPC.TERMINAL_CREATE, args),

  writeTerminal: (id: string, data: string): Promise<void> =>
    invoke(IPC.TERMINAL_WRITE, { id, data }),

  resizeTerminal: (id: string, cols: number, rows: number): Promise<void> =>
    invoke(IPC.TERMINAL_RESIZE, { id, cols, rows }),

  closeTerminal: (id: string): Promise<void> =>
    invoke(IPC.TERMINAL_CLOSE, id),

  closeTerminalsForPath: (pathPrefix: string): Promise<void> =>
    invoke(IPC.TERMINAL_CLOSE_FOR_PATH, pathPrefix),
  closeAllTerminals: (): Promise<void> =>
    invoke(IPC.TERMINAL_CLOSE_ALL),

  listTerminals: (): Promise<TerminalInfo[]> =>
    invoke(IPC.TERMINAL_LIST),

  onTerminalData: (callback: (id: string, data: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { id: string; data: string }) => {
      callback(payload.id, payload.data);
    };
    ipcRenderer.on(IPC.TERMINAL_DATA, handler);
    return () => ipcRenderer.off(IPC.TERMINAL_DATA, handler);
  },

  onTerminalExit: (callback: (id: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { id: string }) => {
      callback(payload.id);
    };
    ipcRenderer.on(IPC.TERMINAL_EXIT, handler);
    return () => ipcRenderer.off(IPC.TERMINAL_EXIT, handler);
  },

  // ── Workspace / recent ────────────────────────────────────────────────────
  listRecentWorkspaces: (): Promise<RecentWorkspace[]> =>
    invoke(IPC.WORKSPACE_LIST_RECENT),

  addRecentWorkspace: (workspacePath: string): Promise<void> =>
    invoke(IPC.WORKSPACE_ADD_RECENT, workspacePath),

  removeRecentWorkspace: (workspacePath: string): Promise<void> =>
    invoke(IPC.WORKSPACE_REMOVE_RECENT, workspacePath),

  getWorkspaceState: (workspacePath: string, key: string): Promise<string | null> =>
    invoke(IPC.WORKSPACE_GET_STATE, { workspacePath, key }),

  setWorkspaceState: (workspacePath: string, key: string, value: string): Promise<void> =>
    invoke(IPC.WORKSPACE_SET_STATE, { workspacePath, key, value }),

  closeWorkspace: (workspacePath: string): Promise<void> =>
    invoke(IPC.WORKSPACE_CLOSE, workspacePath),

  createWorkspace: (args: {
    workspacePath: string;
    repoUrl?: string | null;
  }): Promise<WorkspaceInitResult> =>
    invoke(IPC.WORKSPACE_CREATE, args),

  importWorkspace: (args: {
    sourceRepoPath: string;
    mode: ImportRepoMode;
    workspacePath?: string | null;
  }): Promise<WorkspaceInitResult> =>
    invoke(IPC.WORKSPACE_IMPORT, args),

  inspectWorkspace: (workspacePath: string): Promise<WorkspaceStatus> =>
    invoke(IPC.WORKSPACE_INSPECT, workspacePath),

  getWorktreeMeta: (workspacePath: string, worktreePath: string): Promise<WorktreeMetaRow | null> =>
    invoke(IPC.WORKTREE_GET_META, { workspacePath, worktreePath }),

  setWorktreeMeta: (args: {
    workspacePath: string;
    worktreePath: string;
    branch?: string;
    sourceRef?: string;
    rootRepoPath?: string;
    issueRef?: string | null;
    issueTitle?: string | null;
  }): Promise<void> =>
    invoke(IPC.WORKTREE_SET_META, args),

  listWorktreeProvenance: (workspacePath: string): Promise<WorktreeProvenance[]> =>
    invoke(IPC.WORKTREE_LIST_PROVENANCE, workspacePath),

  getWorktreeProvenance: (workspacePath: string, worktreePath: string): Promise<WorktreeProvenance | null> =>
    invoke(IPC.WORKTREE_GET_PROVENANCE, { workspacePath, worktreePath }),

  // ── Nested repos ──────────────────────────────────────────────────────────
  listNestedRepos: (workspacePath: string): Promise<NestedRepoSyncRule[]> =>
    invoke(IPC.NESTED_REPO_LIST, workspacePath),

  upsertNestedRepo: (args: {
    workspacePath: string;
    repoRelativePath: string;
    enabled: boolean;
  }): Promise<void> =>
    invoke(IPC.NESTED_REPO_UPSERT, args),

  deleteNestedRepo: (workspacePath: string, repoRelativePath: string): Promise<void> =>
    invoke(IPC.NESTED_REPO_DELETE, { workspacePath, repoRelativePath }),

  // ── Hooks ─────────────────────────────────────────────────────────────────
  listHooks: (workspacePath: string, worktreePath: string | null): Promise<HookListResult> =>
    invoke(IPC.HOOK_LIST, { workspacePath, worktreePath }),

  createHook: (args: { workspacePath: string } & HookUpsertInput): Promise<void> =>
    invoke(IPC.HOOK_CREATE, args),

  updateHook: (args: { workspacePath: string; id: string } & Partial<HookUpsertInput>): Promise<void> =>
    invoke(IPC.HOOK_UPDATE, args),

  deleteHook: (workspacePath: string, id: string): Promise<void> =>
    invoke(IPC.HOOK_DELETE, { workspacePath, id }),

  toggleHook: (workspacePath: string, id: string, enabled: boolean): Promise<void> =>
    invoke(IPC.HOOK_TOGGLE, { workspacePath, id, enabled }),

  trustHook: (worktreePath: string, hookId: string): Promise<void> =>
    invoke(IPC.HOOK_TRUST, { worktreePath, hookId }),

  runHook: (args: {
    workspacePath: string;
    hookId: string;
    worktreePath: string;
    trigger: WorkspaceHookTrigger;
    initiatingWorktreePath?: string | null;
  }): Promise<void> =>
    invoke(IPC.HOOK_RUN, args),

  runSwitchHooks: (args: {
    workspacePath: string;
    targetWorktreePath: string;
    initiatingWorktreePath?: string | null;
    source?: WorktreeSwitchHookSource;
  }): Promise<void> =>
    invoke(IPC.HOOK_RUN_SWITCH, args),

  runCreateHooks: (args: {
    workspacePath: string;
    newWorktreePath: string;
    initiatingWorktreePath?: string | null;
  }): Promise<void> =>
    invoke(IPC.HOOK_RUN_CREATE, args),

  runTriggerHooks: (args: {
    workspacePath: string;
    trigger: WorkspaceHookTrigger;
    worktreePath: string;
    initiatingWorktreePath?: string | null;
    source?: WorktreeSwitchHookSource;
  }): Promise<void> =>
    invoke(IPC.HOOK_RUN_TRIGGER, args),

  logHookRun: (args: {
    workspacePath: string;
    id: string;
    hookId: string;
    hookName: string;
    trigger: string;
    worktreePath: string;
    status: 'success' | 'failure' | 'skipped' | 'timeout';
    stdoutSnippet?: string;
    stderrSnippet?: string;
    errorMessage?: string;
  }): Promise<void> =>
    invoke(IPC.HOOK_RUN_LOG, args),

  onHookProgress: (callback: (event: HookProgressEvent) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: HookProgressEvent) => callback(payload);
    ipcRenderer.on(IPC.EVENT_HOOK_PROGRESS, handler);
    return () => ipcRenderer.off(IPC.EVENT_HOOK_PROGRESS, handler);
  },

  onHookTerminalLaunch: (callback: (event: HookTerminalLaunchEvent) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: HookTerminalLaunchEvent) => callback(payload);
    ipcRenderer.on(IPC.EVENT_HOOK_TERMINAL_LAUNCH, handler);
    return () => ipcRenderer.off(IPC.EVENT_HOOK_TERMINAL_LAUNCH, handler);
  },

  // ── Coding agents ─────────────────────────────────────────────────────────
  getAgentConfig: (): Promise<AgentConfig> =>
    invoke(IPC.AGENT_GET),

  saveAgentConfig: (config: AgentConfig): Promise<void> =>
    invoke(IPC.AGENT_SAVE, config),

  launchAgent: (args: {
    workspacePath: string;
    worktreePath: string;
  }): Promise<string> =>
    invoke(IPC.AGENT_LAUNCH, args),

  testAgent: (): Promise<ToolTestResult> =>
    invoke(IPC.AGENT_TEST),

  getAcpAdapterStatus: (): Promise<AcpAdapterStatus | null> =>
    invoke(IPC.AGENT_ACP_ADAPTER_STATUS),

  installAcpAdapter: (npmPackage: string): Promise<void> =>
    invoke(IPC.AGENT_ACP_ADAPTER_INSTALL, npmPackage),

  onAcpAdapterInstallProgress: (callback: (event: AcpAdapterInstallEvent) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: AcpAdapterInstallEvent) => callback(payload);
    ipcRenderer.on(IPC.EVENT_AGENT_ACP_ADAPTER_INSTALL, handler);
    return () => ipcRenderer.off(IPC.EVENT_AGENT_ACP_ADAPTER_INSTALL, handler);
  },

  onAgentTerminalLaunch: (callback: (event: AgentTerminalLaunchEvent) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: AgentTerminalLaunchEvent) => callback(payload);
    ipcRenderer.on(IPC.EVENT_AGENT_TERMINAL_LAUNCH, handler);
    return () => ipcRenderer.off(IPC.EVENT_AGENT_TERMINAL_LAUNCH, handler);
  },

  // ── Chat (Integrated agent mode) ─────────────────────────────────────────
  chatStart: (args: { worktreePath: string; initialPrompt?: string }): Promise<{ sessionId: string; configOptions: ChatConfigOption[] }> =>
    invoke(IPC.CHAT_START, args),

  chatSend: (args: { sessionId: string; prompt: string }): Promise<void> =>
    invoke(IPC.CHAT_SEND, args),

  chatStop: (sessionId: string): Promise<void> =>
    invoke(IPC.CHAT_STOP, sessionId),

  chatRespondPermission: (args: { sessionId: string; requestId: string; optionId: string }): Promise<void> =>
    invoke(IPC.CHAT_RESPOND_PERMISSION, args),

  chatSetConfigOption: (args: { sessionId: string; configId: string; value: string | boolean }): Promise<ChatConfigOption[]> =>
    invoke(IPC.CHAT_SET_CONFIG_OPTION, args),

  onChatStream: (callback: (event: ChatSessionEvent) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: ChatSessionEvent) => callback(payload);
    ipcRenderer.on(IPC.EVENT_CHAT_STREAM, handler);
    return () => ipcRenderer.off(IPC.EVENT_CHAT_STREAM, handler);
  },

  onChatExit: (callback: (event: ChatSessionExitEvent) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: ChatSessionExitEvent) => callback(payload);
    ipcRenderer.on(IPC.EVENT_CHAT_EXIT, handler);
    return () => ipcRenderer.off(IPC.EVENT_CHAT_EXIT, handler);
  },

  // ── Commit message generator ──────────────────────────────────────────────
  generateCommitMessage: (args: {
    workspacePath: string;
    worktreePath: string;
    settings: CommitMessageGeneratorSettings;
  }): Promise<CommitMessageGenerateResult> =>
    invoke(IPC.COMMITMSG_GENERATE, args),

  // ── New-project-from-idea generator ───────────────────────────────────────
  generateProjectIdea: (pitch: string): Promise<ProjectIdeaGenerateResult> =>
    invoke(IPC.PROJECT_IDEA_GENERATE, { pitch }),

  // ── Settings tool tests ───────────────────────────────────────────────────
  testEditor: (command: string): Promise<ToolTestResult> =>
    invoke(IPC.TOOLTEST_EDITOR, command),

  testDiffTool: (command: string): Promise<ToolTestResult> =>
    invoke(IPC.TOOLTEST_DIFF_TOOL, command),

  testMergeTool: (command: string): Promise<ToolTestResult> =>
    invoke(IPC.TOOLTEST_MERGE_TOOL, command),

  testShell: (shellPath: string): Promise<ToolTestResult> =>
    invoke(IPC.TOOLTEST_SHELL, shellPath),

  testCommitMessageGenerator: (settings: CommitMessageGeneratorSettings): Promise<ToolTestResult> =>
    invoke(IPC.TOOLTEST_COMMIT_MESSAGE_GENERATOR, settings),

  // ── File watcher ──────────────────────────────────────────────────────────
  startWatching: (repoPath: string): Promise<void> =>
    invoke(IPC.WATCH_START, repoPath),

  stopWatching: (repoPath: string): Promise<void> =>
    invoke(IPC.WATCH_STOP, repoPath),

  onWorktreeChanged: (callback: (event: WorktreeChangedEvent) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: WorktreeChangedEvent) => callback(payload);
    ipcRenderer.on(IPC.EVENT_WORKTREE_CHANGED, handler);
    return () => ipcRenderer.off(IPC.EVENT_WORKTREE_CHANGED, handler);
  },

  onGitRefsChanged: (callback: (event: { repoPath: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: { repoPath: string }) => callback(payload);
    ipcRenderer.on(IPC.EVENT_GIT_REFS_CHANGED, handler);
    return () => ipcRenderer.off(IPC.EVENT_GIT_REFS_CHANGED, handler);
  },

  onGitOpProgress: (callback: (event: GitOpProgressEvent) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: GitOpProgressEvent) => callback(payload);
    ipcRenderer.on(IPC.EVENT_GIT_OP_PROGRESS, handler);
    return () => ipcRenderer.off(IPC.EVENT_GIT_OP_PROGRESS, handler);
  },

  // ── Settings ──────────────────────────────────────────────────────────────
  getSetting: (key: string): Promise<string | null> =>
    invoke(IPC.SETTINGS_GET, key),

  setSetting: (key: string, value: string): Promise<void> =>
    invoke(IPC.SETTINGS_SET, { key, value }),

  deleteSetting: (key: string): Promise<void> =>
    invoke(IPC.SETTINGS_DELETE, key),

  getAllSettings: (): Promise<{ key: string; value: string }[]> =>
    invoke(IPC.SETTINGS_GET_ALL),

  // ── System ────────────────────────────────────────────────────────────────
  appVersion: (): Promise<string> =>
    invoke(IPC.SYSTEM_APP_VERSION),

  listShells: (): Promise<{ name: string; path: string }[]> =>
    invoke(IPC.SYSTEM_LIST_SHELLS),

  detectEditors: (): Promise<EditorInfo[]> =>
    invoke(IPC.SYSTEM_DETECT_EDITORS),

  detectGitTools: (): Promise<GitToolInfo[]> =>
    invoke(IPC.SYSTEM_DETECT_GIT_TOOLS),

  openInEditor: (path: string): Promise<void> =>
    invoke(IPC.SYSTEM_OPEN_IN_EDITOR, path),

  revealInFinder: (path: string): Promise<void> =>
    invoke(IPC.SYSTEM_REVEAL_IN_FINDER, path),

  openUrl: (url: string): Promise<void> =>
    invoke(IPC.SYSTEM_OPEN_URL, url),

  getHomeDir: (): Promise<string> =>
    invoke(IPC.SYSTEM_GET_HOME_DIR),

  openNewWindow: (): Promise<void> =>
    invoke(IPC.SYSTEM_NEW_WINDOW),

  // ── Native dialogs ────────────────────────────────────────────────────────
  showOpenDialog: (opts: {
    title?: string;
    defaultPath?: string;
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>;
  }): Promise<string[]> =>
    invoke(IPC.DIALOG_SHOW_OPEN, opts),

  // ── Window controls ───────────────────────────────────────────────────────
  windowMinimize: (): Promise<void> => invoke(IPC.WINDOW_MINIMIZE),
  windowMaximize: (): Promise<void> => invoke(IPC.WINDOW_MAXIMIZE),
  windowClose: (): Promise<void> => invoke(IPC.WINDOW_CLOSE),
  windowIsMaximized: (): Promise<boolean> => invoke(IPC.WINDOW_IS_MAXIMIZED),

  onWindowMaximized: (cb: () => void) => {
    ipcRenderer.on(IPC.EVENT_WINDOW_MAXIMIZED, cb);
    return () => ipcRenderer.off(IPC.EVENT_WINDOW_MAXIMIZED, cb);
  },
  onWindowUnmaximized: (cb: () => void) => {
    ipcRenderer.on(IPC.EVENT_WINDOW_UNMAXIMIZED, cb);
    return () => ipcRenderer.off(IPC.EVENT_WINDOW_UNMAXIMIZED, cb);
  },

  onWindowEnterFullscreen: (cb: () => void) => {
    ipcRenderer.on(IPC.EVENT_WINDOW_ENTER_FULLSCREEN, cb);
    return () => ipcRenderer.off(IPC.EVENT_WINDOW_ENTER_FULLSCREEN, cb);
  },
  onWindowLeaveFullscreen: (cb: () => void) => {
    ipcRenderer.on(IPC.EVENT_WINDOW_LEAVE_FULLSCREEN, cb);
    return () => ipcRenderer.off(IPC.EVENT_WINDOW_LEAVE_FULLSCREEN, cb);
  },

  // ── OS open-file / recent items ───────────────────────────────────────────
  onOpenWorkspace: (cb: (workspacePath: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: string) => cb(p);
    ipcRenderer.on(IPC.EVENT_OPEN_WORKSPACE, listener);
    return () => ipcRenderer.removeListener(IPC.EVENT_OPEN_WORKSPACE, listener);
  },

  // ── GitHub OAuth ──────────────────────────────────────────────────────────
  githubAuthStatus: (): Promise<GitHubAuthStatus> =>
    invoke(IPC.GITHUB_AUTH_STATUS),

  githubDeviceFlowStart: (): Promise<DeviceCodeResponse> =>
    invoke(IPC.GITHUB_DEVICE_FLOW_START),

  githubDeviceFlowPoll: (deviceCode: string): Promise<GitHubPollResult> =>
    invoke(IPC.GITHUB_DEVICE_FLOW_POLL, deviceCode),

  githubLogout: (): Promise<void> =>
    invoke(IPC.GITHUB_LOGOUT),

  githubListEmails: (): Promise<GitHubEmailSuggestion[]> =>
    invoke(IPC.GITHUB_LIST_EMAILS),

  githubListRepos: (): Promise<GitHubRepo[]> =>
    invoke(IPC.GITHUB_LIST_REPOS),

  githubGetPrStatus: (worktreePath: string): Promise<PullRequestStatus | null> =>
    invoke(IPC.GITHUB_GET_PR_STATUS, worktreePath),

  githubCreatePr: (args: { worktreePath: string; title: string; body?: string; base: string; draft?: boolean }): Promise<PullRequestInfo> =>
    invoke(IPC.GITHUB_CREATE_PR, args),

  // ── Auto-update ─────────────────────────────────────────────────────────
  checkForUpdates: (): Promise<void> =>
    invoke(IPC.UPDATE_CHECK),

  installUpdate: (): Promise<void> =>
    invoke(IPC.UPDATE_INSTALL),

  onUpdateChecking: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.EVENT_UPDATE_CHECKING, listener);
    return () => ipcRenderer.removeListener(IPC.EVENT_UPDATE_CHECKING, listener);
  },

  onUpdateAvailable: (cb: (version: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, version: string) => cb(version);
    ipcRenderer.on(IPC.EVENT_UPDATE_AVAILABLE, listener);
    return () => ipcRenderer.removeListener(IPC.EVENT_UPDATE_AVAILABLE, listener);
  },

  onUpdateNotAvailable: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.EVENT_UPDATE_NOT_AVAILABLE, listener);
    return () => ipcRenderer.removeListener(IPC.EVENT_UPDATE_NOT_AVAILABLE, listener);
  },

  onUpdateDownloading: (cb: (progress: number) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, progress: number) => cb(progress);
    ipcRenderer.on(IPC.EVENT_UPDATE_DOWNLOADING, listener);
    return () => ipcRenderer.removeListener(IPC.EVENT_UPDATE_DOWNLOADING, listener);
  },

  onUpdateReady: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.EVENT_UPDATE_READY, listener);
    return () => ipcRenderer.removeListener(IPC.EVENT_UPDATE_READY, listener);
  },

  onUpdateError: (cb: (message: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, message: string) => cb(message);
    ipcRenderer.on(IPC.EVENT_UPDATE_ERROR, listener);
    return () => ipcRenderer.removeListener(IPC.EVENT_UPDATE_ERROR, listener);
  },

  // ── File browser / editor ─────────────────────────────────────────────────
  listFileTree: (worktreePath: string): Promise<FileTreeNode[]> =>
    invoke(IPC.FILE_LIST_TREE, worktreePath),

  readFile: (worktreePath: string, relativePath: string): Promise<FileReadResult> =>
    invoke(IPC.FILE_READ, { worktreePath, relativePath }),

  writeFile: (worktreePath: string, relativePath: string, content: string): Promise<{ mtimeMs: number }> =>
    invoke(IPC.FILE_WRITE, { worktreePath, relativePath, content }),

  startFileWatching: (worktreePath: string): Promise<void> =>
    invoke(IPC.FILE_WATCH_START, worktreePath),

  stopFileWatching: (worktreePath: string): Promise<void> =>
    invoke(IPC.FILE_WATCH_STOP, worktreePath),

  onFileChanged: (callback: (event: FileChangedEvent) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: FileChangedEvent) => callback(payload);
    ipcRenderer.on(IPC.EVENT_FILE_CHANGED, handler);
    return () => ipcRenderer.off(IPC.EVENT_FILE_CHANGED, handler);
  },

  // ── Issue tracker ──────────────────────────────────────────────────────────
  listIssueTrackerPatterns: (worktreePath: string): Promise<IssueTrackerPattern[]> =>
    invoke(IPC.ISSUETRACKER_LIST, worktreePath),

  // ── Providers ────────────────────────────────────────────────────────────
  fetchProviderIssue: (url: string): Promise<ProviderIssue | null> =>
    invoke(IPC.PROVIDER_FETCH_ISSUE, url),

  // ── MCP server ────────────────────────────────────────────────────────────
  mcpStatus: (workspacePath: string): Promise<McpServerStatus> =>
    invoke(IPC.MCP_STATUS, workspacePath),

  mcpEnsureStarted: (workspacePath: string): Promise<McpServerStatus> =>
    invoke(IPC.MCP_ENSURE_STARTED, workspacePath),

  mcpSetEnabled: (workspacePath: string, enabled: boolean): Promise<McpServerStatus> =>
    invoke(IPC.MCP_SET_ENABLED, { workspacePath, enabled }),

  mcpSetPort: (workspacePath: string, port: number | null): Promise<McpServerStatus> =>
    invoke(IPC.MCP_SET_PORT, { workspacePath, port }),

  mcpWriteClientConfig: (workspacePath: string, client: McpClientId): Promise<McpConfigWriteResult> =>
    invoke(IPC.MCP_WRITE_CLIENT_CONFIG, { workspacePath, client }),

  mcpGetManualSnippet: (workspacePath: string, client?: McpClientId): Promise<string> =>
    invoke(IPC.MCP_GET_MANUAL_SNIPPET, client ? { workspacePath, client } : { workspacePath }),

  // ── Global error reporting ────────────────────────────────────────────────
  onGlobalError: (callback: (event: GlobalErrorEvent) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: GlobalErrorEvent) => callback(payload);
    ipcRenderer.on(IPC.EVENT_GLOBAL_ERROR, handler);
    return () => ipcRenderer.off(IPC.EVENT_GLOBAL_ERROR, handler);
  },
};

contextBridge.exposeInMainWorld('api', api);

// Augment the Window type so the renderer gets full type-safety.
export type SproutGitApi = typeof api;
