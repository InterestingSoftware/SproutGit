/**
 * File browser + file editor IPC: list a worktree's file tree (gitignore-aware),
 * read/write file contents, and watch a worktree for external file changes so
 * open editor tabs can live-sync.
 *
 * Security: every handler resolves the incoming path against the worktree
 * root and rejects anything that escapes it (symlink traversal, `..`, or an
 * absolute path outside the root) before touching the filesystem.
 */
import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '@sproutgit/types';
import type { FileTreeNode, FileReadResult, FileChangedEvent } from '@sproutgit/types';
import { promises as fs } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { canonicalize, isPathWithin } from '@sproutgit/paths';
import { watchRecursive, closeWatcher, type RecursiveWatchEvent } from '../lib/recursive-watch.js';

type Closable = { close: () => void | Promise<void> };

// Directories that are never shown in the tree / never watched, regardless of
// .gitignore contents — keeps VCS internals and dependency trees out of view.
const ALWAYS_IGNORED_DIRS = new Set(['.git', 'node_modules']);

const MAX_TREE_ENTRIES = 20_000;

// ── Path safety ───────────────────────────────────────────────────────────────

/**
 * Resolves `relativePath` against `worktreeRoot` and throws if the result
 * escapes the root. Returns the absolute, resolved path on success.
 *
 * Compares canonicalized (realpath'd) paths rather than a plain lexical
 * `resolve()`, so a symlink that lives inside the root but points outside it
 * (e.g. `<root>/escape-link -> /etc`) is rejected instead of silently
 * followed — same approach as the worktree-path checks in ipc/git.ts and
 * ipc/hooks.ts (see `@sproutgit/paths`).
 */
function resolveSafePath(worktreeRoot: string, relativePath: string): string {
  const root = resolve(worktreeRoot);
  // Reject absolute paths / drive letters passed as "relative" — always join
  // from the root rather than trusting an absolute-looking input.
  const candidate = resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw new Error(`Path escapes worktree root: ${relativePath}`);
  }
  const canonicalRoot = canonicalize(root);
  const canonicalCandidate = canonicalize(candidate);
  if (!isPathWithin(canonicalCandidate, canonicalRoot)) {
    throw new Error(`Path escapes worktree root: ${relativePath}`);
  }
  return candidate;
}

function toRelative(worktreeRoot: string, absolutePath: string): string {
  return relative(resolve(worktreeRoot), absolutePath).split(sep).join('/');
}

// ── Minimal .gitignore matcher ────────────────────────────────────────────────
// Not a full gitignore implementation (no negation-with-directory-reinclusion
// edge cases, no **-in-the-middle nuance beyond a straightforward glob-to-regex
// conversion) — good enough to keep node_modules/build noise out of the tree.

type IgnoreRule = { regex: RegExp; negate: boolean; dirOnly: boolean };

function globToRegExp(pattern: string): RegExp {
  let p = pattern;
  const anchored = p.startsWith('/');
  if (anchored) p = p.slice(1);
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        out += '.*';
        i++;
        if (p[i + 1] === '/') i++;
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if (c && '.+^${}()|[]\\'.includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  const prefix = anchored ? '^' : '^(?:.*/)?';
  return new RegExp(`${prefix}${out}$`);
}

function parseGitignore(content: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    let pattern = line;
    let negate = false;
    if (pattern.startsWith('!')) {
      negate = true;
      pattern = pattern.slice(1);
    }
    let dirOnly = false;
    if (pattern.endsWith('/')) {
      dirOnly = true;
      pattern = pattern.slice(0, -1);
    }
    if (!pattern) continue;
    rules.push({ regex: globToRegExp(pattern), negate, dirOnly });
  }
  return rules;
}

function isIgnored(rules: IgnoreRule[], relPath: string, isDirectory: boolean): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDirectory) continue;
    if (rule.regex.test(relPath)) {
      ignored = !rule.negate;
    }
  }
  return ignored;
}

async function loadGitignore(worktreeRoot: string): Promise<IgnoreRule[]> {
  try {
    const content = await fs.readFile(join(worktreeRoot, '.gitignore'), 'utf8');
    return parseGitignore(content);
  } catch {
    return [];
  }
}

// ── Tree listing ──────────────────────────────────────────────────────────────

async function buildTree(worktreeRoot: string): Promise<FileTreeNode[]> {
  const rules = await loadGitignore(worktreeRoot);
  let entryCount = 0;

  async function walk(dirAbs: string): Promise<FileTreeNode[]> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return [];
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const nodes: FileTreeNode[] = [];
    for (const entry of entries) {
      if (entryCount >= MAX_TREE_ENTRIES) break;
      if (ALWAYS_IGNORED_DIRS.has(entry.name)) continue;

      const abs = join(dirAbs, entry.name);
      const rel = toRelative(worktreeRoot, abs);
      const isDir = entry.isDirectory();
      if (isIgnored(rules, rel, isDir)) continue;

      entryCount++;
      if (isDir) {
        nodes.push({
          relativePath: rel,
          name: entry.name,
          kind: 'directory',
          children: await walk(abs),
        });
      } else if (entry.isFile()) {
        nodes.push({ relativePath: rel, name: entry.name, kind: 'file' });
      }
    }
    return nodes;
  }

  return walk(resolve(worktreeRoot));
}

// ── Per-worktree external-change watcher ─────────────────────────────────────
// Uses the same cross-platform watchRecursive() helper as ipc/watcher.ts
// (which watches .git/* for ref changes) rather than native
// fs.watch({recursive: true}), which throws on Linux. This watcher instead
// covers the working tree's file *content* so open editor tabs can detect
// external edits (e.g. an AI agent or another tool writing to a file).

// Multiple windows can watch the same worktree (e.g. the same workspace open
// in two windows), so each entry tracks every subscribing window and
// broadcasts to all of them rather than a single one.
type FileWatchEntry = { watcher: Closable; windows: Set<BrowserWindow> };

const activeFileWatchers = new Map<string, FileWatchEntry>();

// A window that's abruptly closed (not navigated away from first) never
// calls FILE_WATCH_STOP, which would otherwise leave the recursive watcher
// running with no live subscriber — on Windows that also holds a handle
// blocking anything that needs to delete/rename the watched worktree. Sweep
// it out of every entry on 'closed', tearing down any left with zero
// subscribers. Each window only needs this wired up once, regardless of how
// many worktrees it ends up watching over its lifetime.
const windowsWithCloseCleanup = new WeakSet<BrowserWindow>();

function ensureCleanupOnClose(win: BrowserWindow): void {
  if (windowsWithCloseCleanup.has(win)) return;
  windowsWithCloseCleanup.add(win);
  win.once('closed', () => {
    for (const [worktreePath, entry] of activeFileWatchers) {
      if (entry.windows.delete(win) && entry.windows.size === 0) {
        closeWatcher(entry.watcher);
        activeFileWatchers.delete(worktreePath);
      }
    }
  });
}

function isAlwaysIgnoredPath(path: string): boolean {
  return path.split(/[\\/]+/).some(segment => ALWAYS_IGNORED_DIRS.has(segment));
}

function startFileWatch(worktreePath: string, win: BrowserWindow): void {
  const root = resolve(worktreePath);
  const existing = activeFileWatchers.get(root);
  if (existing) {
    // Already watching this worktree (e.g. from another window) — just add
    // this window as another subscriber to the same underlying watcher.
    existing.windows.add(win);
    ensureCleanupOnClose(win);
    return;
  }

  const windows = new Set([win]);
  const watcher = watchRecursive(
    root,
    (event: RecursiveWatchEvent, absolutePath: string) => {
      if (event === 'addDir' || event === 'unlinkDir') return; // only file content changes matter here
      if (isAlwaysIgnoredPath(absolutePath)) return;

      const relPath = toRelative(root, absolutePath);
      const type: FileChangedEvent['type'] = event === 'unlink' ? 'deleted' : event === 'add' ? 'created' : 'changed';
      const fileEvent: FileChangedEvent = { worktreePath: root, relativePath: relPath, absolutePath, type };
      for (const w of windows) {
        if (w.isDestroyed()) { windows.delete(w); continue; }
        w.webContents.send(IPC.EVENT_FILE_CHANGED, fileEvent);
      }
    },
    isAlwaysIgnoredPath,
  );
  if (watcher) {
    activeFileWatchers.set(root, { watcher, windows }); // null if the worktree path doesn't exist (yet) on macOS/Windows
    ensureCleanupOnClose(win);
  }
}

function stopFileWatch(worktreePath: string, win?: BrowserWindow): void {
  const root = resolve(worktreePath);
  const entry = activeFileWatchers.get(root);
  if (!entry) return;

  if (win) entry.windows.delete(win);
  if (!win || entry.windows.size === 0) {
    closeWatcher(entry.watcher);
    activeFileWatchers.delete(root);
  }
}

// ── IPC registration ──────────────────────────────────────────────────────────

export function registerFileHandlers(): void {
  ipcMain.handle(IPC.FILE_LIST_TREE, (_e, worktreePath: string) => buildTree(worktreePath));

  ipcMain.handle(IPC.FILE_READ, async (_e, args: { worktreePath: string; relativePath: string }): Promise<FileReadResult> => {
    const abs = resolveSafePath(args.worktreePath, args.relativePath);
    const [content, stat] = await Promise.all([
      fs.readFile(abs, 'utf8'),
      fs.stat(abs),
    ]);
    return { relativePath: args.relativePath, content, mtimeMs: stat.mtimeMs };
  });

  ipcMain.handle(IPC.FILE_WRITE, async (_e, args: { worktreePath: string; relativePath: string; content: string }) => {
    const abs = resolveSafePath(args.worktreePath, args.relativePath);
    await fs.writeFile(abs, args.content, 'utf8');
    const stat = await fs.stat(abs);
    return { mtimeMs: stat.mtimeMs };
  });

  ipcMain.handle(IPC.FILE_WATCH_START, (_e, worktreePath: string) => {
    const win = BrowserWindow.fromWebContents(_e.sender);
    if (!win) return;
    startFileWatch(worktreePath, win);
  });

  ipcMain.handle(IPC.FILE_WATCH_STOP, (_e, worktreePath: string) => {
    stopFileWatch(worktreePath, BrowserWindow.fromWebContents(_e.sender) ?? undefined);
  });
}
