import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * True when `path` is itself a bare repo directory (objects/refs/HEAD
 * present directly, no nested `.git`) rather than a working tree.
 * Cheap filesystem check — no git process spawned.
 */
export function isBareRepoPath(path: string): boolean {
  return existsSync(join(path, 'HEAD'))
    && existsSync(join(path, 'objects'))
    && existsSync(join(path, 'refs'))
    && !existsSync(join(path, '.git'));
}
