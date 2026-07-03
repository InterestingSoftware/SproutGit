export { getGitInfo, gitForPath } from './client.js';
export { getGitConfig, setGitConfig } from './config.js';
export {
  listWorktrees,
  createManagedWorktree,
  addWorktreeForExistingBranch,
  deleteManagedWorktree,
} from './worktrees.js';
export { getCommitGraph, countCommits, listRefs, getRecentCommitSubjects } from './commits.js';
export {
  getWorktreeStatus,
  stageFiles,
  unstageFiles,
  createCommit,
  checkoutWorktree,
  resetWorktreeBranch,
} from './staging.js';
export {
  fetchWorktree,
  pullWorktree,
  pushWorktreeBranch,
  getWorktreePushStatus,
} from './remote.js';
export { getDiffFiles, getDiffContent, getWorkingDiff, getStagedDiff } from './diff.js';
export { initBareRepo, cloneBareRepo } from './init.js';
export { convertToBareWithWorktree, DirtyWorkingTreeError, DetachedHeadError } from './convert.js';
export { isBareRepoPath } from './bare.js';
export { readIssueTrackerFile } from './issuetracker.js';
