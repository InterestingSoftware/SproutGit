import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { openNodeSqlite } from './node-sqlite-compat.js';
import * as workspaceSchema from './schema/workspace.js';

export type WorkspaceDb = ReturnType<typeof openWorkspaceDb>;

/**
 * Opens (or creates) a workspace-scoped database.
 *
 * The database file lives at `<workspace>/.sproutgit/state.db`.
 * All migrations in `migrations/workspace` are applied on every open.
 */
export function openWorkspaceDb(dbPath: string) {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sqlite = openNodeSqlite(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // ── Pre-migration guard for hook_dependencies ────────────────────────────
  // Handles two legacy schema states that cannot be fixed inside a Drizzle
  // migration transaction (PRAGMA foreign_keys=OFF is a no-op there):
  //   1. Missing composite PRIMARY KEY  (pre-0002 databases)
  //   2. Column 'depends_on_hook_id'    (old Tauri/early-Electron schema)
  //      — the column was renamed to 'depends_on_id' in migration 0002,
  //        but that migration was replaced with a no-op before the rename ran.
  sqlite.exec('DROP TABLE IF EXISTS `__new_hook_dependencies`');
  {
    const depRow = sqlite.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='hook_dependencies'"
    ).get() as { sql?: string } | undefined;
    const currentSql = depRow?.sql ?? '';
    const hasOldColName = currentSql.includes('depends_on_hook_id');
    const hasPrimaryKey = currentSql.includes('PRIMARY KEY');

    if (hasOldColName || !hasPrimaryKey) {
      sqlite.exec('PRAGMA foreign_keys=OFF');
      sqlite.exec(
        'CREATE TABLE `__new_hook_dependencies` (`hook_id` text NOT NULL, `depends_on_id` text NOT NULL, PRIMARY KEY(`hook_id`, `depends_on_id`))'
      );
      if (currentSql !== '') {
        // Copy existing rows; if the old column name was used, rename on the fly.
        if (hasOldColName) {
          sqlite.exec(
            'INSERT OR IGNORE INTO `__new_hook_dependencies`("hook_id","depends_on_id") SELECT "hook_id","depends_on_hook_id" FROM `hook_dependencies`'
          );
        } else {
          sqlite.exec(
            'INSERT OR IGNORE INTO `__new_hook_dependencies`("hook_id","depends_on_id") SELECT "hook_id","depends_on_id" FROM `hook_dependencies`'
          );
        }
      }
      sqlite.exec('DROP TABLE IF EXISTS `hook_dependencies`');
      sqlite.exec('ALTER TABLE `__new_hook_dependencies` RENAME TO `hook_dependencies`');
      sqlite.exec('PRAGMA foreign_keys=ON');
    }
  }

  // openNodeSqlite() returns a CompatDatabase shim, not a real better-sqlite3
  // Database — drizzle-orm/better-sqlite3 only wants the type for its public
  // API surface (prepare/exec/pragma/transaction/close), all of which
  // CompatDatabase implements, so this bridge is safe despite not being
  // structurally identical.
  const db = drizzle(sqlite as unknown as Database, { schema: workspaceSchema });

  // Use fileURLToPath so the path is valid on Windows.
  migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations/workspace', import.meta.url)) });

  // Expose close() so callers (e.g. tests) can release the file lock.
  return Object.assign(db, { close: () => sqlite.close() });
}
