/**
 * Types for the file browser / file editor feature (tree listing, read/write,
 * and live-sync-on-external-change).
 */

export type FileTreeNodeKind = 'file' | 'directory';

export type FileTreeNode = {
  /** Path relative to the worktree root, using forward slashes. */
  relativePath: string;
  name: string;
  kind: FileTreeNodeKind;
  /** Only present for kind: 'directory'. Omitted for files. */
  children?: FileTreeNode[];
};

/** Result of reading a file's contents over IPC. */
export type FileReadResult = {
  /** Path relative to the worktree root, using forward slashes. */
  relativePath: string;
  content: string;
  /** mtimeMs from fs.stat at read time — used to detect external changes. */
  mtimeMs: number;
};

/** Event emitted when a file inside a watched worktree changes on disk. */
export type FileChangedEvent = {
  worktreePath: string;
  /** Path relative to the worktree root, using forward slashes. */
  relativePath: string;
  /** Absolute path on disk. */
  absolutePath: string;
  type: 'created' | 'changed' | 'deleted';
};
