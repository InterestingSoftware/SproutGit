import { useState } from 'react';
import { File, Folder, FolderOpen, RefreshCw } from 'lucide-react';
import type { FileTreeNode } from '@sproutgit/types';
import { Spinner } from '@sproutgit/ui';

type Props = {
  tree: FileTreeNode[];
  loading: boolean;
  activeRelativePath: string | null;
  onOpenFile: (relativePath: string) => void;
  onRefresh: () => void;
};

function TreeRow({
  node,
  depth,
  activeRelativePath,
  onOpenFile,
}: {
  node: FileTreeNode;
  depth: number;
  activeRelativePath: string | null;
  onOpenFile: (relativePath: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isDir = node.kind === 'directory';
  const isActive = !isDir && node.relativePath === activeRelativePath;

  return (
    <div>
      <button
        type="button"
        data-testid={isDir ? 'file-tree-dir' : 'file-tree-file'}
        data-path={node.relativePath}
        className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs cursor-pointer border-none bg-transparent transition-colors hover:bg-(--sg-surface-raised) ${isActive ? 'bg-(--sg-surface-raised) text-(--sg-primary) font-medium' : 'text-(--sg-text)'}`}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        onClick={() => (isDir ? setExpanded(v => !v) : onOpenFile(node.relativePath))}
      >
        {isDir ? (
          expanded ? (
            <FolderOpen size={13} className="shrink-0 text-(--sg-text-faint)" />
          ) : (
            <Folder size={13} className="shrink-0 text-(--sg-text-faint)" />
          )
        ) : (
          <File size={13} className="shrink-0 text-(--sg-text-faint)" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isDir && expanded && node.children && (
        <div>
          {node.children.map(child => (
            <TreeRow
              key={child.relativePath}
              node={child}
              depth={depth + 1}
              activeRelativePath={activeRelativePath}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTreePanel({ tree, loading, activeRelativePath, onOpenFile, onRefresh }: Props) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-(--sg-border-subtle) px-2 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-(--sg-text-faint)">Files</span>
        <button
          type="button"
          title="Refresh file tree"
          data-testid="btn-refresh-file-tree"
          className="inline-flex items-center justify-center rounded p-1 text-(--sg-text-faint) hover:bg-(--sg-surface-raised) hover:text-(--sg-text) border-none bg-transparent cursor-pointer"
          onClick={onRefresh}
        >
          <RefreshCw size={12} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1" data-testid="file-tree">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Spinner size="sm" />
          </div>
        ) : tree.length === 0 ? (
          <p className="px-3 py-4 text-center text-[11px] text-(--sg-text-faint)">No files found.</p>
        ) : (
          tree.map(node => (
            <TreeRow
              key={node.relativePath}
              node={node}
              depth={0}
              activeRelativePath={activeRelativePath}
              onOpenFile={onOpenFile}
            />
          ))
        )}
      </div>
    </div>
  );
}
