/**
 * All IPC channel names used in the app.
 * Having them here prevents typos and makes refactoring safe.
 */
export const IPC = {
  // ── Git ─────────────────────────────────────────────────────────────────
  GIT_INFO: 'git:info',
  GIT_LIST_WORKTREES: 'git:listWorktrees',
  GIT_LIST_REFS: 'git:listRefs',
  GIT_COMMIT_GRAPH: 'git:commitGraph',
  GIT_COUNT_COMMITS: 'git:countCommits',
  GIT_STATUS: 'git:status',
  GIT_STAGE: 'git:stage',
  GIT_UNSTAGE: 'git:unstage',
  GIT_COMMIT: 'git:commit',
  GIT_CHECKOUT: 'git:checkout',
  GIT_RESET: 'git:reset',
  GIT_FETCH: 'git:fetch',
  GIT_PULL: 'git:pull',
  GIT_PUSH: 'git:push',
  GIT_PUSH_STATUS: 'git:pushStatus',
  GIT_DIFF_FILES: 'git:diffFiles',
  GIT_DIFF_CONTENT: 'git:diffContent',
  GIT_WORKING_DIFF: 'git:workingDiff',
  // ── Worktrees ────────────────────────────────────────────────────────────
  WORKTREE_CREATE: 'worktree:create',
  WORKTREE_DELETE: 'worktree:delete',
  WORKTREE_GET_META: 'worktree:getMeta',
  WORKTREE_SET_META: 'worktree:setMeta',
  WORKTREE_PRUNE_METADATA: 'worktree:pruneMetadata',
  // ── Workspace / recent ───────────────────────────────────────────────────
  WORKSPACE_LIST_RECENT: 'workspace:listRecent',
  WORKSPACE_ADD_RECENT: 'workspace:addRecent',
  WORKSPACE_REMOVE_RECENT: 'workspace:removeRecent',
  WORKSPACE_GET_STATE: 'workspace:getState',
  WORKSPACE_SET_STATE: 'workspace:setState',
  WORKSPACE_CLOSE: 'workspace:close',
  // ── Hooks ────────────────────────────────────────────────────────────────
  HOOK_LIST: 'hook:list',
  HOOK_CREATE: 'hook:create',
  HOOK_UPDATE: 'hook:update',
  HOOK_DELETE: 'hook:delete',
  HOOK_RUN_LOG: 'hook:runLog',
  // ── Terminal ─────────────────────────────────────────────────────────────
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_CLOSE: 'terminal:close',
  TERMINAL_LIST: 'terminal:list',
  TERMINAL_CLOSE_ALL: 'terminal:closeAll',
  // ── Settings ─────────────────────────────────────────────────────────────
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_DELETE: 'settings:delete',
  SETTINGS_GET_ALL: 'settings:getAll',
  // ── Coding agents ────────────────────────────────────────────────────────
  AGENT_LIST: 'agent:list',
  AGENT_SAVE: 'agent:save',
  AGENT_LAUNCH: 'agent:launch',
  EVENT_AGENT_TERMINAL_LAUNCH: 'event:agentTerminalLaunch',
  // ── Git config ───────────────────────────────────────────────────────────
  GIT_GET_CONFIG: 'git:getConfig',
  GIT_SET_CONFIG: 'git:setConfig',
  // ── Workspace init / import ──────────────────────────────────────────────
  WORKSPACE_CREATE: 'workspace:create',
  WORKSPACE_IMPORT: 'workspace:import',
  WORKSPACE_INSPECT: 'workspace:inspect',
  // ── Worktree provenance ──────────────────────────────────────────────────
  WORKTREE_LIST_PROVENANCE: 'worktree:listProvenance',
  WORKTREE_GET_PROVENANCE: 'worktree:getProvenance',
  // ── Nested repos ─────────────────────────────────────────────────────────
  NESTED_REPO_LIST: 'nestedRepo:list',
  NESTED_REPO_UPSERT: 'nestedRepo:upsert',
  NESTED_REPO_DELETE: 'nestedRepo:delete',
  // ── Hook execution ───────────────────────────────────────────────────────
  HOOK_RUN: 'hook:run',
  HOOK_RUN_SWITCH: 'hook:runSwitch',
  HOOK_RUN_CREATE: 'hook:runCreate',
  HOOK_RUN_TRIGGER: 'hook:runTrigger',
  HOOK_TOGGLE: 'hook:toggle',
  // ── Commit message generator ─────────────────────────────────────────────
  COMMITMSG_GENERATE: 'commitmsg:generate',
  // ── System / editors / shells ─────────────────────────────────────────────
  SYSTEM_DETECT_EDITORS: 'system:detectEditors',
  SYSTEM_DETECT_GIT_TOOLS: 'system:detectGitTools',
  SYSTEM_LIST_SHELLS: 'system:listShells',
  SYSTEM_OPEN_IN_EDITOR: 'system:openInEditor',
  SYSTEM_REVEAL_IN_FINDER: 'system:revealInFinder',
  SYSTEM_OPEN_URL: 'system:openUrl',
  SYSTEM_APP_VERSION: 'system:appVersion',
  SYSTEM_GET_HOME_DIR: 'system:getHomeDir',
  // ── GitHub OAuth ──────────────────────────────────────────────────────────
  GITHUB_AUTH_STATUS: 'github:authStatus',
  GITHUB_DEVICE_FLOW_START: 'github:deviceFlowStart',
  GITHUB_DEVICE_FLOW_POLL: 'github:deviceFlowPoll',
  GITHUB_LOGOUT: 'github:logout',
  GITHUB_LIST_EMAILS: 'github:listEmails',
  GITHUB_LIST_REPOS: 'github:listRepos',
  // ── File watcher ─────────────────────────────────────────────────────────
  WATCH_START: 'watch:start',
  WATCH_STOP: 'watch:stop',
  // ── Push events (main → renderer) ────────────────────────────────────────
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_EXIT: 'terminal:exit',
  TERMINAL_CLOSE_FOR_PATH: 'terminal:closeForPath',
  EVENT_HOOK_PROGRESS: 'event:hookProgress',
  EVENT_HOOK_TERMINAL_LAUNCH: 'event:hookTerminalLaunch',
  EVENT_WORKTREE_CHANGED: 'event:worktreeChanged',
  EVENT_GIT_REFS_CHANGED: 'event:gitRefsChanged',
  EVENT_GIT_OP_PROGRESS: 'event:gitOpProgress',
  // ── Auto-update (main → renderer push events + renderer invocations) ──────
  UPDATE_CHECK: 'update:check',
  UPDATE_INSTALL: 'update:install',
  EVENT_UPDATE_CHECKING: 'event:updateChecking',
  EVENT_UPDATE_AVAILABLE: 'event:updateAvailable',
  EVENT_UPDATE_NOT_AVAILABLE: 'event:updateNotAvailable',
  EVENT_UPDATE_DOWNLOADING: 'event:updateDownloading',
  EVENT_UPDATE_READY: 'event:updateReady',
  EVENT_UPDATE_ERROR: 'event:updateError',
  // ── Native dialogs ───────────────────────────────────────────────────────
  DIALOG_SHOW_OPEN: 'dialog:showOpen',
  // ── Window controls ──────────────────────────────────────────────────────
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:isMaximized',
  EVENT_WINDOW_MAXIMIZED: 'event:windowMaximized',
  EVENT_WINDOW_UNMAXIMIZED: 'event:windowUnmaximized',
  EVENT_WINDOW_ENTER_FULLSCREEN: 'event:windowEnterFullscreen',
  EVENT_WINDOW_LEAVE_FULLSCREEN: 'event:windowLeaveFullscreen',
  // Fired by main when the OS opens a file/URL that should navigate to a workspace.
  EVENT_OPEN_WORKSPACE: 'event:openWorkspace',
  // ── Issue tracker ────────────────────────────────────────────────────────
  ISSUETRACKER_LIST: 'issuetracker:list',
  // ── Providers ────────────────────────────────────────────────────────────
  PROVIDER_FETCH_ISSUE: 'provider:fetchIssue',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

// ── Typed IPC contract ───────────────────────────────────────────────────────
// Single source of truth: maps each invoke channel to its (args, result) types.
// Both the preload's `ipcInvoke` and the main's `ipcHandle` enforce this map,
// so a mismatch is a compile error rather than a runtime crash.

import type {
  GitInfo,
  WorktreeInfo,
  CommitEntry,
  RefInfo,
  WorktreeStatusResult,
  DiffFileEntry,
  WorktreePushStatus,
  RefsResult,
} from './git.js';
import type { WorkspaceInitResult, WorkspaceStatus, RecentWorkspace, WorktreeProvenance, NestedRepoSyncRule, ImportRepoMode, CreateWorktreeResult } from './workspace.js';
import type {
  WorkspaceHook,
  WorkspaceHookScope,
  WorkspaceHookTrigger,
  HookExecutionTarget,
  WorkspaceHookShell,
  WorktreeSwitchHookSource,
} from './hooks.js';
import type { EditorInfo, GitToolInfo } from './tools.js';
import type { GitHubAuthStatus, DeviceCodeResponse, GitHubPollResult, GitHubEmailSuggestion, GitHubRepo } from './github.js';
import type { TerminalInfo } from './terminal.js';
import type { AgentRoster } from './agents.js';
import type { CommitMessageGeneratorSettings, CommitMessageGenerateResult } from './commit-message-generator.js';
import type { IssueTrackerPattern } from './issuetracker.js';
import type { ProviderIssue } from './providers.js';

/** Shape of one row returned by WORKTREE_GET_META / WORKTREE_SET_META. */
export type WorktreeMetaRow = {
  worktreePath: string;
  branch: string;
  sourceRef: string;
  rootRepoPath: string;
  initiatingWorktreePath: string | null;
  issueRef: string | null;
  issueTitle: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Shape of one worktree-hook-run-log row (HOOK_RUN_LOG args). */
export type HookRunLogArgs = {
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
};

/**
 * Maps every invoke-able IPC channel to `{ args: [...], result: T }`.
 * `args` is a rest-tuple matching the positional parameters after `_event`.
 *
 * Channels that are push-only (main → renderer, no invoke) are excluded.
 */
export type IpcMap = {
  // ── Git ──────────────────────────────────────────────────────────────────
  'git:info':        { args: [];                                                              result: GitInfo };
  'git:listWorktrees': { args: [repoPath: string, managedWorktreesPath?: string];            result: WorktreeInfo[] };
  'git:commitGraph': { args: [args: { repoPath: string; limit?: number; skip?: number }];    result: CommitEntry[] };
  'git:countCommits':{ args: [repoPath: string];                                             result: number };
  'git:listRefs':    { args: [repoPath: string];                                             result: RefsResult };
  'git:status':      { args: [worktreePath: string];                                         result: WorktreeStatusResult };
  'git:stage':       { args: [args: { worktreePath: string; paths: string[] }];              result: void };
  'git:unstage':     { args: [args: { worktreePath: string; paths: string[] }];              result: void };
  'git:commit':      { args: [args: { worktreePath: string; message: string }];              result: void };
  'git:checkout':    { args: [args: { worktreePath: string; targetRef: string }];            result: void };
  'git:reset':       { args: [args: { worktreePath: string; targetRef: string; mode: 'soft'|'mixed'|'hard' }]; result: void };
  'git:fetch':       { args: [worktreePath: string];                                         result: void };
  'git:pull':        { args: [worktreePath: string];                                         result: void };
  'git:push':        { args: [args: { worktreePath: string; remote?: string }];              result: void };
  'git:pushStatus':  { args: [worktreePath: string];                                         result: WorktreePushStatus };
  'git:diffFiles':   { args: [args: { repoPath: string; range: string }];                    result: DiffFileEntry[] };
  'git:diffContent': { args: [args: { repoPath: string; range: string; file?: string }];     result: string };
  'git:workingDiff': { args: [args: { worktreePath: string; file?: string }];                result: string };
  'git:getConfig':   { args: [key: string];                                                  result: string | null };
  'git:setConfig':   { args: [args: { key: string; value: string }];                         result: void };
  // ── Worktrees ─────────────────────────────────────────────────────────────
  'worktree:create': { args: [args: { rootRepoPath: string; managedWorktreesPath: string; fromRef: string; newBranch: string }]; result: CreateWorktreeResult };
  'worktree:delete': { args: [args: { rootRepoPath: string; managedWorktreesPath?: string; worktreePath: string; deleteBranch: boolean; branchName?: string | null }];                      result: void };
  'worktree:getMeta':    { args: [args: { workspacePath: string; worktreePath: string }]; result: WorktreeMetaRow | null };
  'worktree:setMeta':    { args: [args: { workspacePath: string; worktreePath: string; branch?: string; sourceRef?: string; rootRepoPath?: string; issueRef?: string | null; issueTitle?: string | null }]; result: void };
  'worktree:pruneMetadata': { args: [args: { workspacePath: string; activeWorktreePaths: string[] }]; result: void };
  'worktree:listProvenance': { args: [workspacePath: string]; result: WorktreeProvenance[] };
  'worktree:getProvenance':  { args: [args: { workspacePath: string; worktreePath: string }]; result: WorktreeProvenance | null };
  // ── Workspace ─────────────────────────────────────────────────────────────
  'workspace:listRecent':  { args: [];                          result: RecentWorkspace[] };
  'workspace:addRecent':   { args: [workspacePath: string];     result: void };
  'workspace:removeRecent':{ args: [workspacePath: string];     result: void };
  'workspace:getState':    { args: [args: { workspacePath: string; key: string }]; result: string | null };
  'workspace:setState':    { args: [args: { workspacePath: string; key: string; value: string }]; result: void };
  'workspace:close':       { args: [workspacePath: string];                                    result: void };
  'workspace:create':      { args: [args: { workspacePath: string; repoUrl?: string | null }]; result: WorkspaceInitResult };
  'workspace:import':      { args: [args: { sourceRepoPath: string; mode: ImportRepoMode; workspacePath?: string | null }]; result: WorkspaceInitResult };
  'workspace:inspect':     { args: [workspacePath: string];                                    result: WorkspaceStatus };
  // ── Nested repos ──────────────────────────────────────────────────────────
  'nestedRepo:list':   { args: [workspacePath: string];                                                                    result: NestedRepoSyncRule[] };
  'nestedRepo:upsert': { args: [args: { workspacePath: string; repoRelativePath: string; enabled: boolean }];              result: void };
  'nestedRepo:delete': { args: [args: { workspacePath: string; repoRelativePath: string }];                                result: void };
  // ── Hooks ─────────────────────────────────────────────────────────────────
  'hook:list':      { args: [workspacePath: string];                                                         result: WorkspaceHook[] };
  'hook:create':    { args: [args: { workspacePath: string; id: string; name: string; scope: WorkspaceHookScope; trigger: WorkspaceHookTrigger; executionTarget: HookExecutionTarget; shell: WorkspaceHookShell; script: string; enabled?: boolean; critical?: boolean; switchOncePerSession?: boolean; switchRunOnCreate?: boolean; switchRunOnDelete?: boolean; keepOpenOnCompletion?: boolean; timeoutSeconds?: number; dependencyIds?: string[] }]; result: void };
  'hook:update':    { args: [args: { workspacePath: string; id: string; name?: string; scope?: WorkspaceHookScope; trigger?: WorkspaceHookTrigger; executionTarget?: HookExecutionTarget; shell?: WorkspaceHookShell; script?: string; enabled?: boolean; critical?: boolean; switchOncePerSession?: boolean; switchRunOnCreate?: boolean; switchRunOnDelete?: boolean; keepOpenOnCompletion?: boolean; timeoutSeconds?: number; dependencyIds?: string[] }]; result: void };
  'hook:delete':    { args: [args: { workspacePath: string; id: string }];                                   result: void };
  'hook:toggle':    { args: [args: { workspacePath: string; id: string; enabled: boolean }];                 result: void };
  'hook:run':       { args: [args: { workspacePath: string; hookId: string; worktreePath: string; trigger: WorkspaceHookTrigger; initiatingWorktreePath?: string | null }]; result: void };
  'hook:runSwitch':   { args: [args: { workspacePath: string; targetWorktreePath: string; initiatingWorktreePath?: string | null; source?: WorktreeSwitchHookSource }]; result: void };
  'hook:runCreate':   { args: [args: { workspacePath: string; newWorktreePath: string; initiatingWorktreePath?: string | null }]; result: void };
  'hook:runTrigger':  { args: [args: { workspacePath: string; trigger: WorkspaceHookTrigger; worktreePath: string; initiatingWorktreePath?: string | null; source?: WorktreeSwitchHookSource }]; result: void };
  'hook:runLog':      { args: [args: HookRunLogArgs]; result: void };
  // ── Commit message generator ─────────────────────────────────────────────
  'commitmsg:generate': { args: [args: { workspacePath: string; worktreePath: string; settings: CommitMessageGeneratorSettings }]; result: CommitMessageGenerateResult };
  // ── Terminal ──────────────────────────────────────────────────────────────
  'terminal:create': { args: [args: { cwd: string; shell?: string; label?: string; cols?: number; rows?: number }]; result: string };
  'terminal:write':  { args: [args: { id: string; data: string }];           result: void };
  'terminal:resize': { args: [args: { id: string; cols: number; rows: number }]; result: void };
  'terminal:close':  { args: [id: string];                                   result: void };
  'terminal:closeForPath': { args: [pathPrefix: string];                     result: void };
  'terminal:closeAll': { args: [];                                           result: void };
  'terminal:list':   { args: [];                                             result: TerminalInfo[] };
  // ── Settings ──────────────────────────────────────────────────────────────
  'settings:get':    { args: [key: string];                                  result: string | null };
  'settings:set':    { args: [args: { key: string; value: string }];        result: void };
  'settings:delete': { args: [key: string];                                  result: void };
  'settings:getAll': { args: [];                                             result: { key: string; value: string }[] };
  // ── Coding agents ─────────────────────────────────────────────────────────
  'agent:list':   { args: [];                                                          result: AgentRoster };
  'agent:save':   { args: [roster: AgentRoster];                                       result: void };
  'agent:launch': { args: [args: { workspacePath: string; worktreePath: string; agentId?: string }]; result: string };
  // ── System ────────────────────────────────────────────────────────────────
  'system:appVersion':    { args: [];             result: string };
  'system:listShells':    { args: [];             result: { name: string; path: string }[] };
  'system:detectEditors': { args: [];             result: EditorInfo[] };
  'system:detectGitTools':{ args: [];             result: GitToolInfo[] };
  'system:openInEditor':  { args: [path: string]; result: void };
  'system:revealInFinder':{ args: [path: string]; result: void };
  'system:openUrl':       { args: [url: string];  result: void };
  'system:getHomeDir':    { args: [];             result: string };
  // ── GitHub OAuth ───────────────────────────────────────────────────────────
  'github:authStatus':      { args: [];                    result: GitHubAuthStatus };
  'github:deviceFlowStart': { args: [];                    result: DeviceCodeResponse };
  'github:deviceFlowPoll':  { args: [deviceCode: string]; result: GitHubPollResult };
  'github:logout':          { args: [];                    result: void };
  'github:listEmails':      { args: [];                    result: GitHubEmailSuggestion[] };
  'github:listRepos':       { args: [];                    result: GitHubRepo[] };
  // ── Watcher ───────────────────────────────────────────────────────────────
  'watch:start': { args: [repoPath: string]; result: void };
  'watch:stop':  { args: [repoPath: string]; result: void };
  // ── Auto-update ───────────────────────────────────────────────────────────
  'update:check':   { args: []; result: void };
  'update:install': { args: []; result: void };
  // ── Native dialogs ────────────────────────────────────────────────────────
  'dialog:showOpen': { args: [opts: { title?: string; defaultPath?: string; properties?: string[] }]; result: string[] };
  // ── Window controls ───────────────────────────────────────────────────────
  'window:minimize':    { args: []; result: void };
  'window:maximize':    { args: []; result: void };
  'window:close':       { args: []; result: void };
  'window:isMaximized': { args: []; result: boolean };
  // ── Issue tracker ─────────────────────────────────────────────────────────
  'issuetracker:list':  { args: [worktreePath: string]; result: IssueTrackerPattern[] };
  // ── Providers ─────────────────────────────────────────────────────────────
  'provider:fetchIssue': { args: [url: string]; result: ProviderIssue | null };
};

/** Union of all invoke-able channel strings. */
export type InvokeChannel = keyof IpcMap;

/** Typed helper: call in preload to get the correct arg/result types. */
export type IpcInvoke = <K extends InvokeChannel>(
  channel: K,
  ...args: IpcMap[K]['args']
) => Promise<IpcMap[K]['result']>;
