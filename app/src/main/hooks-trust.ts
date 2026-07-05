/**
 * Per-worktree, per-hook trust decisions for repo-tracked hooks
 * (`sproutgit.hooks.json`).
 *
 * A hook script arrives via `git checkout`, so it must never run just
 * because it's present — the user has to explicitly trust it first, same
 * idea as VS Code's workspace trust. Trust is scoped to one hook's exact
 * content (see hashHookDefinition in hooks-file.ts), not the whole file —
 * editing or adding one hook doesn't invalidate trust already granted to
 * the others, and reverting a hook back to a previously-trusted version
 * (e.g. switching branches) doesn't require re-approval.
 *
 * Persisted in the app-wide config DB (not the workspace DB) under a
 * `settings` row keyed per worktree path, since trust is a decision about
 * this machine/user, not something to share via the workspace DB.
 */
import { eq, type ConfigDb } from '@sproutgit/database';
import { settings } from '@sproutgit/database/schema/config';

// Per-hook trust means one file can accumulate many distinct hashes over
// its edit history — comfortably more than a single whole-file hash would.
const MAX_REMEMBERED_HASHES = 200;

function trustKey(worktreePath: string): string {
  return `repoHooksTrust:${worktreePath}`;
}

function readTrustedHashes(configDb: ConfigDb, worktreePath: string): string[] {
  const row = configDb.select().from(settings).where(eq(settings.key, trustKey(worktreePath))).get();
  if (!row) return [];
  try {
    const parsed: unknown = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function isHookTrusted(configDb: ConfigDb, worktreePath: string, hookHash: string): boolean {
  return readTrustedHashes(configDb, worktreePath).includes(hookHash);
}

export function trustHook(configDb: ConfigDb, worktreePath: string, hookHash: string): void {
  const existing = readTrustedHashes(configDb, worktreePath);
  if (existing.includes(hookHash)) return;
  const updated = [...existing, hookHash].slice(-MAX_REMEMBERED_HASHES);
  configDb
    .insert(settings)
    .values({ key: trustKey(worktreePath), value: JSON.stringify(updated) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(updated) } })
    .run();
}
