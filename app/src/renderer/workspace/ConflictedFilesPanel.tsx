import { AlertTriangle } from 'lucide-react';
import type { StatusFileEntry } from '@sproutgit/types';

type Props = {
  files: StatusFileEntry[];
  activeRelativePath: string | null;
  onSelectFile: (relativePath: string) => void;
};

export function ConflictedFilesPanel({ files, activeRelativePath, onSelectFile }: Props) {
  const conflicted = files.filter(f => f.conflicted);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-(--sg-border-subtle) px-2 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-(--sg-text-faint)">Conflicted Files</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1" data-testid="conflict-file-list">
        {conflicted.length === 0 ? (
          <p className="px-3 py-4 text-center text-[11px] text-(--sg-text-faint)">No conflicted files.</p>
        ) : (
          conflicted.map(f => (
            <button
              key={f.path}
              type="button"
              data-testid="conflict-file-item"
              data-path={f.path}
              className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs cursor-pointer border-none bg-transparent transition-colors hover:bg-(--sg-surface-raised) ${f.path === activeRelativePath ? 'bg-(--sg-surface-raised) text-(--sg-primary) font-medium' : 'text-(--sg-text)'}`}
              onClick={() => onSelectFile(f.path)}
            >
              <AlertTriangle size={12} className="shrink-0 text-(--sg-warning)" />
              <span className="truncate">{f.path}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
