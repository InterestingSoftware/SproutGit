import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { IPC } from '@sproutgit/types';
import type { FileTreeNode, FileReadResult } from '@sproutgit/types';

const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }));
// fromWebContents is mocked as the identity function — tests pass the "window"
// they want a handler to resolve to directly as the event's `sender`.
vi.mock('electron', () => ({
  ipcMain: { handle: handleMock },
  BrowserWindow: { fromWebContents: (sender: unknown) => sender ?? null },
}));

const { watchRecursiveMock, closeWatcherMock } = vi.hoisted(() => ({
  watchRecursiveMock: vi.fn(),
  closeWatcherMock: vi.fn(),
}));
vi.mock('@sproutgit/fs-watch', () => ({
  watchRecursive: (...args: unknown[]) => watchRecursiveMock(...args),
  closeWatcher: (...args: unknown[]) => closeWatcherMock(...args),
}));

import { registerFileHandlers } from '../files.js';

type AnyHandler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Registers the file IPC handlers and returns a lookup function for grabbing
 * one by channel name. Throws immediately (rather than returning `undefined`)
 * if a test asks for a channel that didn't get registered, so a broken
 * registration fails loudly at the call site instead of surfacing later as a
 * confusing "not a function" error.
 */
function registerAndGetHandlers(): (channel: string) => AnyHandler {
  handleMock.mockClear();
  registerFileHandlers();
  return (channel: string) => {
    const call = handleMock.mock.calls.find(c => c[0] === channel);
    if (!call) throw new Error(`${channel} handler was not registered`);
    return call[1] as AnyHandler;
  };
}

function tempWorktree(prefix: string): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
}

// ── file:listTree (buildTree + gitignore matcher) ────────────────────────────

describe('file:listTree', () => {
  let root: string;

  beforeEach(() => {
    vi.clearAllMocks();
    root = tempWorktree('sg-files-tree-');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function findNode(nodes: FileTreeNode[], relativePath: string): FileTreeNode | undefined {
    for (const n of nodes) {
      if (n.relativePath === relativePath) return n;
      if (n.children) {
        const found = findNode(n.children, relativePath);
        if (found) return found;
      }
    }
    return undefined;
  }

  it('lists files and directories, sorted directories-first then alphabetically', async () => {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'index.ts'), '');
    writeFileSync(join(root, 'zeta.txt'), '');
    writeFileSync(join(root, 'alpha.txt'), '');

    const getHandler = registerAndGetHandlers();
    const listTree = getHandler(IPC.FILE_LIST_TREE);
    const tree = (await listTree({}, root)) as FileTreeNode[];

    expect(tree.map(n => n.name)).toEqual(['src', 'alpha.txt', 'zeta.txt']);
    expect(tree[0]!.kind).toBe('directory');
    expect(tree[0]!.children?.[0]).toMatchObject({ name: 'index.ts', kind: 'file', relativePath: 'src/index.ts' });
  });

  it('always excludes .git and node_modules regardless of .gitignore contents', async () => {
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git', 'HEAD'), '');
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'node_modules', 'pkg.js'), '');
    writeFileSync(join(root, '.gitignore'), '!.git\n!node_modules\n');
    writeFileSync(join(root, 'kept.txt'), '');

    const getHandler = registerAndGetHandlers();
    const listTree = getHandler(IPC.FILE_LIST_TREE);
    const tree = (await listTree({}, root)) as FileTreeNode[];

    expect(tree.some(n => n.name === '.git')).toBe(false);
    expect(tree.some(n => n.name === 'node_modules')).toBe(false);
    expect(tree.some(n => n.name === 'kept.txt')).toBe(true);
  });

  it('excludes files/directories matched by .gitignore', async () => {
    writeFileSync(join(root, '.gitignore'), 'dist\n*.log\n');
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist', 'bundle.js'), '');
    writeFileSync(join(root, 'debug.log'), '');
    writeFileSync(join(root, 'keep.ts'), '');

    const getHandler = registerAndGetHandlers();
    const listTree = getHandler(IPC.FILE_LIST_TREE);
    const tree = (await listTree({}, root)) as FileTreeNode[];

    expect(tree.some(n => n.name === 'dist')).toBe(false);
    expect(tree.some(n => n.name === 'debug.log')).toBe(false);
    expect(tree.some(n => n.name === 'keep.ts')).toBe(true);
  });

  it('supports ** globs in .gitignore', async () => {
    writeFileSync(join(root, '.gitignore'), '**/*.snap\n');
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    writeFileSync(join(root, 'a', 'b', 'x.snap'), '');
    writeFileSync(join(root, 'a', 'keep.ts'), '');

    const getHandler = registerAndGetHandlers();
    const listTree = getHandler(IPC.FILE_LIST_TREE);
    const tree = (await listTree({}, root)) as FileTreeNode[];

    expect(findNode(tree, 'a/b/x.snap')).toBeUndefined();
    expect(findNode(tree, 'a/keep.ts')).toBeDefined();
  });

  it('treats a /-suffixed pattern as directory-only, leaving a same-named file alone', async () => {
    writeFileSync(join(root, '.gitignore'), 'build/\n');
    mkdirSync(join(root, 'build'));
    writeFileSync(join(root, 'build', 'output.txt'), '');
    writeFileSync(join(root, 'build'.concat('.txt')), ''); // "build.txt" - not the "build" dir pattern
    // Create a *file* literally named "build" alongside a differently-named dir to
    // prove dirOnly rules don't match files named exactly "build".
    mkdirSync(join(root, 'other'));
    writeFileSync(join(root, 'other', 'build'), 'not a directory');

    const getHandler = registerAndGetHandlers();
    const listTree = getHandler(IPC.FILE_LIST_TREE);
    const tree = (await listTree({}, root)) as FileTreeNode[];

    expect(tree.some(n => n.name === 'build' && n.kind === 'directory')).toBe(false);
    expect(tree.some(n => n.name === 'build.txt')).toBe(true);
    const otherDir = tree.find(n => n.name === 'other');
    expect(otherDir?.children?.some(n => n.name === 'build' && n.kind === 'file')).toBe(true);
  });

  it('supports negation to re-include a path excluded by an earlier pattern', async () => {
    writeFileSync(join(root, '.gitignore'), '*.log\n!important.log\n');
    writeFileSync(join(root, 'debug.log'), '');
    writeFileSync(join(root, 'important.log'), '');

    const getHandler = registerAndGetHandlers();
    const listTree = getHandler(IPC.FILE_LIST_TREE);
    const tree = (await listTree({}, root)) as FileTreeNode[];

    expect(tree.some(n => n.name === 'debug.log')).toBe(false);
    expect(tree.some(n => n.name === 'important.log')).toBe(true);
  });

  it('ignores comments and blank lines in .gitignore', async () => {
    writeFileSync(join(root, '.gitignore'), '# a comment\n\n   \n*.tmp\n');
    writeFileSync(join(root, 'scratch.tmp'), '');
    writeFileSync(join(root, 'keep.txt'), '');

    const getHandler = registerAndGetHandlers();
    const listTree = getHandler(IPC.FILE_LIST_TREE);
    const tree = (await listTree({}, root)) as FileTreeNode[];

    expect(tree.some(n => n.name === 'scratch.tmp')).toBe(false);
    expect(tree.some(n => n.name === 'keep.txt')).toBe(true);
  });

  it('returns an empty tree with no .gitignore present (falls back to no rules)', async () => {
    writeFileSync(join(root, 'a.txt'), '');

    const getHandler = registerAndGetHandlers();
    const listTree = getHandler(IPC.FILE_LIST_TREE);
    const tree = (await listTree({}, root)) as FileTreeNode[];

    expect(tree).toEqual([{ relativePath: 'a.txt', name: 'a.txt', kind: 'file' }]);
  });

  it('caps total entries at MAX_TREE_ENTRIES (20_000) without throwing', async () => {
    // Create more than the cap in a single flat directory. Use a modest
    // over-the-cap count so the test still runs quickly while still
    // proving the cap is enforced (not just "happens to fit").
    const count = 20_050;
    for (let i = 0; i < count; i++) {
      writeFileSync(join(root, `f${i}.txt`), '');
    }

    const getHandler = registerAndGetHandlers();
    const listTree = getHandler(IPC.FILE_LIST_TREE);
    const tree = (await listTree({}, root)) as FileTreeNode[];

    expect(tree.length).toBeLessThanOrEqual(20_000);
    expect(tree.length).toBeGreaterThan(0);
  }, 30_000);
});

// ── file:read / file:write ───────────────────────────────────────────────────

describe('file:read and file:write', () => {
  let root: string;

  beforeEach(() => {
    vi.clearAllMocks();
    root = tempWorktree('sg-files-rw-');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads a file and returns its content plus mtimeMs', async () => {
    writeFileSync(join(root, 'hello.txt'), 'hello world');

    const getHandler = registerAndGetHandlers();
    const read = getHandler(IPC.FILE_READ);
    const result = (await read({}, { worktreePath: root, relativePath: 'hello.txt' })) as FileReadResult;

    expect(result.content).toBe('hello world');
    expect(result.relativePath).toBe('hello.txt');
    expect(typeof result.mtimeMs).toBe('number');
  });

  it('reads a nested file by relative path', async () => {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.ts'), 'export {}');

    const getHandler = registerAndGetHandlers();
    const read = getHandler(IPC.FILE_READ);
    const result = (await read({}, { worktreePath: root, relativePath: 'src/a.ts' })) as FileReadResult;

    expect(result.content).toBe('export {}');
  });

  it('rejects reading a path that escapes the worktree root via ../', async () => {
    const outside = tempWorktree('sg-files-outside-');
    writeFileSync(join(outside, 'secret.txt'), 'top secret');

    const getHandler = registerAndGetHandlers();
    const read = getHandler(IPC.FILE_READ);
    await expect(
      read({}, { worktreePath: root, relativePath: `../${join(outside).split(sep).pop()}/secret.txt` })
    ).rejects.toThrow(/escapes worktree root/);

    rmSync(outside, { recursive: true, force: true });
  });

  it('writes a file and returns the new mtimeMs, persisting content to disk', async () => {
    writeFileSync(join(root, 'note.txt'), 'old');

    const getHandler = registerAndGetHandlers();
    const write = getHandler(IPC.FILE_WRITE);
    const read = getHandler(IPC.FILE_READ);
    const writeResult = (await write({}, { worktreePath: root, relativePath: 'note.txt', content: 'new content' })) as { mtimeMs: number };
    expect(typeof writeResult.mtimeMs).toBe('number');

    const readResult = (await read({}, { worktreePath: root, relativePath: 'note.txt' })) as FileReadResult;
    expect(readResult.content).toBe('new content');
  });

  it('rejects writing a path that escapes the worktree root via an absolute path', async () => {
    const outside = tempWorktree('sg-files-outside-write-');

    const getHandler = registerAndGetHandlers();
    const write = getHandler(IPC.FILE_WRITE);
    await expect(
      write({}, { worktreePath: root, relativePath: join(outside, 'evil.txt'), content: 'pwned' })
    ).rejects.toThrow(/escapes worktree root/);

    rmSync(outside, { recursive: true, force: true });
  });
});

// ── file:watchStart / file:watchStop ─────────────────────────────────────────

describe('file:watchStart and file:watchStop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    watchRecursiveMock.mockReturnValue({ close: vi.fn() });
  });

  it('starts a watcher for a worktree path and does not start a second one for the same path', async () => {
    const win = { webContents: { send: vi.fn() }, isDestroyed: () => false, once: vi.fn() };
    const getHandler = registerAndGetHandlers();
    const watchStart = getHandler(IPC.FILE_WATCH_START);

    await watchStart({ sender: win }, '/some/worktree');
    await watchStart({ sender: win }, '/some/worktree');

    expect(watchRecursiveMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no window is available', async () => {
    const getHandler = registerAndGetHandlers();
    const watchStart = getHandler(IPC.FILE_WATCH_START);

    await watchStart({ sender: null }, '/some/worktree');

    expect(watchRecursiveMock).not.toHaveBeenCalled();
  });

  it('stops a watcher and closes it via closeWatcher', async () => {
    const win = { webContents: { send: vi.fn() }, isDestroyed: () => false, once: vi.fn() };
    const getHandler = registerAndGetHandlers();
    const watchStart = getHandler(IPC.FILE_WATCH_START);
    const watchStop = getHandler(IPC.FILE_WATCH_STOP);

    await watchStart({ sender: win }, '/another/worktree');
    await watchStop({ sender: win }, '/another/worktree');

    expect(closeWatcherMock).toHaveBeenCalledTimes(1);
  });

  it('stopping a path with no active watcher is a harmless no-op', async () => {
    const getHandler = registerAndGetHandlers();
    const watchStop = getHandler(IPC.FILE_WATCH_STOP);

    await watchStop({ sender: null }, '/never/watched');

    expect(closeWatcherMock).not.toHaveBeenCalled();
  });

  it('forwards file change events to the renderer, translating chokidar event names', async () => {
    let capturedCallback: ((event: string, path: string) => void) | undefined;
    watchRecursiveMock.mockImplementation((_root: string, onEvent: (event: string, path: string) => void) => {
      capturedCallback = onEvent;
      return { close: vi.fn() };
    });

    const win = { webContents: { send: vi.fn() }, isDestroyed: () => false, once: vi.fn() };
    const getHandler = registerAndGetHandlers();
    const watchStart = getHandler(IPC.FILE_WATCH_START);
    await watchStart({ sender: win }, '/watched/root');

    expect(capturedCallback).toBeDefined();
    capturedCallback!('change', join('/watched/root', 'a.txt'));
    capturedCallback!('add', join('/watched/root', 'b.txt'));
    capturedCallback!('unlink', join('/watched/root', 'c.txt'));
    capturedCallback!('addDir', join('/watched/root', 'newdir'));

    const sent = win.webContents.send.mock.calls.map(c => c[1]);
    expect(sent).toEqual([
      expect.objectContaining({ type: 'changed', relativePath: 'a.txt' }),
      expect.objectContaining({ type: 'created', relativePath: 'b.txt' }),
      expect.objectContaining({ type: 'deleted', relativePath: 'c.txt' }),
    ]);
    // addDir is filtered out — only file content changes are forwarded.
    expect(sent).toHaveLength(3);
  });

  it('the ignored predicate passed to watchRecursive filters out .git and node_modules paths', async () => {
    const win = { webContents: { send: vi.fn() }, isDestroyed: () => false, once: vi.fn() };
    const getHandler = registerAndGetHandlers();
    const watchStart = getHandler(IPC.FILE_WATCH_START);
    await watchStart({ sender: win }, '/watched/root2');

    const ignoredPredicate = watchRecursiveMock.mock.calls[0]![2] as (path: string) => boolean;
    expect(ignoredPredicate(join('/watched/root2', '.git', 'HEAD'))).toBe(true);
    expect(ignoredPredicate(join('/watched/root2', 'node_modules', 'pkg', 'index.js'))).toBe(true);
    expect(ignoredPredicate(join('/watched/root2', 'src', 'index.ts'))).toBe(false);
  });
});

// ── resolveSafePath (exercised indirectly via file:read / file:write) ───────
// resolveSafePath itself is module-private; these tests hit it through the
// public IPC handlers (matching the house style used elsewhere in this repo
// — see workspace-init.test.ts / git.test.ts), while packages/paths' own
// unit tests cover the equivalent isPathWithin() helper in isolation.

describe('resolveSafePath security boundary (via file:read / file:write)', () => {
  let root: string;

  beforeEach(() => {
    vi.clearAllMocks();
    root = tempWorktree('sg-files-security-');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('allows a plain relative path inside the root', async () => {
    writeFileSync(join(root, 'ok.txt'), 'fine');
    const getHandler = registerAndGetHandlers();
    const read = getHandler(IPC.FILE_READ);
    await expect(read({}, { worktreePath: root, relativePath: 'ok.txt' })).resolves.toMatchObject({ content: 'fine' });
  });

  it('allows a nested relative path with an internal ../ that stays within the root', async () => {
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    writeFileSync(join(root, 'a', 'sibling.txt'), 'nested-ok');
    const getHandler = registerAndGetHandlers();
    const read = getHandler(IPC.FILE_READ);
    await expect(
      read({}, { worktreePath: root, relativePath: 'a/b/../sibling.txt' })
    ).resolves.toMatchObject({ content: 'nested-ok' });
  });

  it('rejects a single ../ that escapes the root', async () => {
    const getHandler = registerAndGetHandlers();
    const read = getHandler(IPC.FILE_READ);
    await expect(read({}, { worktreePath: root, relativePath: '../etc/passwd' })).rejects.toThrow(/escapes worktree root/);
  });

  it('rejects a deeply nested ../../../ escape', async () => {
    const getHandler = registerAndGetHandlers();
    const read = getHandler(IPC.FILE_READ);
    await expect(read({}, { worktreePath: root, relativePath: '../../../etc/passwd' })).rejects.toThrow(/escapes worktree root/);
  });

  it('rejects an absolute path pointing outside the root even though it looks like a "relative" arg', async () => {
    const getHandler = registerAndGetHandlers();
    const read = getHandler(IPC.FILE_READ);
    await expect(read({}, { worktreePath: root, relativePath: '/etc/passwd' })).rejects.toThrow(/escapes worktree root/);
  });

  it('rejects a sibling directory that merely shares a path prefix with the root', async () => {
    // e.g. root = /tmp/sg-files-security-abc, sibling = /tmp/sg-files-security-abc-evil
    const sibling = `${root}-evil`;
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'x.txt'), 'not yours');

    const getHandler = registerAndGetHandlers();
    const read = getHandler(IPC.FILE_READ);
    // Construct a "relative" path that resolves to the sibling by walking up
    // one level and back into the sibling directory name.
    const escapeAttempt = `../${sibling.split(sep).pop()}/x.txt`;
    await expect(read({}, { worktreePath: root, relativePath: escapeAttempt })).rejects.toThrow(/escapes worktree root/);

    rmSync(sibling, { recursive: true, force: true });
  });

  it('allows the root path itself (empty relative path resolves to the root)', async () => {
    // resolveSafePath(root, '') should resolve to root itself, not throw,
    // since candidate === root is the explicit equality escape hatch.
    writeFileSync(join(root, 'marker.txt'), 'root-dir-marker');
    const getHandler = registerAndGetHandlers();
    const read = getHandler(IPC.FILE_READ);
    // Reading the root itself as a "file" will fail at fs.readFile (EISDIR),
    // which proves resolveSafePath let it through rather than rejecting it
    // as an escape.
    await expect(read({}, { worktreePath: root, relativePath: '.' })).rejects.toThrow(/EISDIR|illegal operation/i);
  });

  it('rejects a symlink that traverses outside the worktree root', async () => {
    const outside = tempWorktree('sg-files-symlink-target-');
    writeFileSync(join(outside, 'secret.txt'), 'leaked!');
    const linkPath = join(root, 'escape-link');
    symlinkSync(outside, linkPath, 'dir');

    // The symlink's *name* lives inside root, so a plain lexical resolve()
    // would pass the string-prefix check — resolveSafePath additionally
    // canonicalizes (realpath) both sides before comparing, so the escape
    // through the symlink is rejected.
    const getHandler = registerAndGetHandlers();
    const read = getHandler(IPC.FILE_READ);
    await expect(
      read({}, { worktreePath: root, relativePath: 'escape-link/secret.txt' })
    ).rejects.toThrow(/escapes worktree root/);

    rmSync(outside, { recursive: true, force: true });
  });

  it('allows a symlink that stays within the worktree root', async () => {
    mkdirSync(join(root, 'real-dir'));
    writeFileSync(join(root, 'real-dir', 'file.txt'), 'inside');
    symlinkSync(join(root, 'real-dir'), join(root, 'link-dir'), 'dir');

    const getHandler = registerAndGetHandlers();
    const read = getHandler(IPC.FILE_READ);
    const result = (await read({}, { worktreePath: root, relativePath: 'link-dir/file.txt' })) as FileReadResult;
    expect(result.content).toBe('inside');
  });
});
