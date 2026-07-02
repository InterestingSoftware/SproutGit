import { IPC } from '@sproutgit/types';
import { readIssueTrackerFile } from '@sproutgit/git';
import { handle } from './handle.js';

export function registerIssueTrackerHandlers(): void {
  handle(IPC.ISSUETRACKER_LIST, (_e, worktreePath: string) => readIssueTrackerFile(worktreePath));
}
