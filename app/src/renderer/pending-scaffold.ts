/**
 * Carries the one-time "scaffold this project" kickoff prompt from the
 * homescreen's "New from idea" flow to the workspace view for the project
 * it just created. In-memory only (no persistence) — TanStack Router's hash
 * navigation doesn't reload the page, so this module-level map survives the
 * navigate() call, and there's no reason for a scaffold kickoff to survive
 * an app restart.
 *
 * Keyed by `workspacePath`, not the worktree path — `workspacePath` is a
 * renderer-constructed string passed unchanged through both call sites (the
 * dialog builds it, then hands it to the router as a search param, which
 * workspace.tsx reads right back). The worktree path, in contrast, gets
 * reported back by `git worktree list` after going through git's own
 * realpath resolution (e.g. macOS's /var → /private/var) — comparing a
 * locally-constructed worktree path against that would silently never match.
 */
const pendingScaffolds = new Map<string, string>();

export function setPendingScaffold(workspacePath: string, prompt: string): void {
  pendingScaffolds.set(workspacePath, prompt);
}

/** Returns and clears the pending prompt for `workspacePath`, if any — callers should only ever consume it once. */
export function consumePendingScaffold(workspacePath: string): string | undefined {
  const prompt = pendingScaffolds.get(workspacePath);
  pendingScaffolds.delete(workspacePath);
  return prompt;
}
