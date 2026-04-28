import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

function parseArgs(argv) {
  return {
    delete: argv.includes('--delete'),
    json: argv.includes('--json'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function usage() {
  console.log(
    `Usage: node scripts/cleanup-rust-targets.mjs [--delete] [--json]\n\n` +
      `Scans all Git worktrees for this repository and reports per-worktree src-tauri/target directories.\n` +
      `By default it only reports. Pass --delete to remove the discovered target directories.`
  );
}

function getWorktrees() {
  const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: resolve('.'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const worktrees = [];
  let current = null;

  for (const line of output.split(/\r?\n/)) {
    if (!line) {
      if (current) worktrees.push(current);
      current = null;
      continue;
    }

    if (line.startsWith('worktree ')) {
      if (current) worktrees.push(current);
      current = { path: line.slice('worktree '.length) };
    }
  }

  if (current) worktrees.push(current);
  return worktrees;
}

function directorySizeBytes(path) {
  const stats = lstatSync(path);

  if (stats.isSymbolicLink()) {
    return 0;
  }

  if (stats.isFile()) {
    return stats.size;
  }

  if (!stats.isDirectory()) {
    return 0;
  }

  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    total += directorySizeBytes(join(path, entry.name));
  }
  return total;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  const digits = value >= 10 || exponent === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[exponent]}`;
}

function scanWorktreeTargets(worktrees) {
  return worktrees.map(({ path }) => {
    const targetPath = join(path, 'src-tauri', 'target');
    const exists = existsSync(targetPath);
    const bytes = exists ? directorySizeBytes(targetPath) : 0;

    return {
      worktreePath: path,
      targetPath,
      exists,
      bytes,
    };
  });
}

function removeTargets(entries) {
  let removedCount = 0;
  let removedBytes = 0;

  for (const entry of entries) {
    if (!entry.exists) continue;
    rmSync(entry.targetPath, { recursive: true, force: true });
    removedCount += 1;
    removedBytes += entry.bytes;
  }

  return { removedCount, removedBytes };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const entries = scanWorktreeTargets(getWorktrees());
  const existing = entries.filter(entry => entry.exists);
  const totalBytes = existing.reduce((sum, entry) => sum + entry.bytes, 0);

  if (args.json) {
    const payload = {
      mode: args.delete ? 'delete' : 'dry-run',
      worktrees: entries,
      totalBytes,
    };

    if (args.delete) {
      payload.removed = removeTargets(existing);
    }

    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(
    args.delete
      ? 'Deleting worktree-local Rust target directories:'
      : 'Worktree-local Rust target directories:'
  );

  if (entries.length === 0) {
    console.log('  No Git worktrees found.');
    return;
  }

  for (const entry of entries) {
    const status = entry.exists ? formatBytes(entry.bytes) : 'missing';
    console.log(`  ${entry.worktreePath}`);
    console.log(`    ${entry.targetPath} (${status})`);
  }

  console.log(`\nTotal existing target size: ${formatBytes(totalBytes)}`);

  if (!args.delete) {
    console.log('Dry run only. Re-run with --delete to remove these directories.');
    return;
  }

  const removed = removeTargets(existing);
  console.log(
    `Removed ${removed.removedCount} target director${removed.removedCount === 1 ? 'y' : 'ies'} (${formatBytes(removed.removedBytes)}).`
  );
}

main();
