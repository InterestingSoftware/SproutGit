import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { openNodeSqlite } from './node-sqlite-compat.js';
import * as configSchema from './schema/config.js';

export type ConfigDb = ReturnType<typeof openConfigDb>;

/**
 * Opens (or creates) the app-global config database.
 *
 * The database file lives in the platform user-data directory
 * (e.g. ~/Library/Application Support/SproutGit/config.db on macOS).
 * All migrations in `migrations/config` are applied on every open so the
 * schema is always up to date.
 */
export function openConfigDb(dbPath: string) {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Use the built-in node:sqlite adapter (compatible with Electron 32+ / Node 22.5+).
  const sqlite = openNodeSqlite(dbPath);
  // WAL mode for better concurrent read performance (Electron main + watcher).
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // openNodeSqlite() returns a CompatDatabase shim, not a real better-sqlite3
  // Database — drizzle-orm/better-sqlite3 only wants the type for its public
  // API surface (prepare/exec/pragma/transaction/close), all of which
  // CompatDatabase implements, so this bridge is safe despite not being
  // structurally identical.
  const db = drizzle(sqlite as unknown as Database, { schema: configSchema });

  // Apply all pending migrations from the embedded migrations folder.
  // Use fileURLToPath so the path is valid on Windows (new URL().pathname
  // produces a leading slash on Windows paths like /C:/...).
  migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations/config', import.meta.url)) });

  // Expose close() so callers (e.g. tests) can release the file lock.
  return Object.assign(db, { close: () => sqlite.close() });
}
