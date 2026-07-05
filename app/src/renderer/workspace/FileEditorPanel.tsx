import { X, AlertTriangle, RotateCcw, FileWarning, Save } from 'lucide-react';
import { MonacoEditor, languageForPath } from '@sproutgit/ui';
import type { FileTab } from '../stores/editor-store.js';

type Props = {
  tabs: FileTab[];
  activeTabKey: string | null;
  keyOf: (tab: FileTab) => string;
  onSelectTab: (key: string) => void;
  onCloseTab: (key: string) => void;
  onChange: (key: string, content: string) => void;
  onSave: (key: string) => void;
  onReloadFromDisk: (key: string) => void;
  onKeepMine: (key: string) => void;
};

export function FileEditorPanel({
  tabs,
  activeTabKey,
  keyOf,
  onSelectTab,
  onCloseTab,
  onChange,
  onSave,
  onReloadFromDisk,
  onKeepMine,
}: Props) {
  const activeTab = tabs.find(t => keyOf(t) === activeTabKey) ?? null;

  if (tabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-(--sg-text-faint)">
        Select a file from the tree to start editing.
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      onKeyDownCapture={e => {
        const isSaveShortcut = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's';
        if (isSaveShortcut && activeTab) {
          e.preventDefault();
          onSave(keyOf(activeTab));
        }
      }}
    >
      {/* Tab strip */}
      <div className="flex min-h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-(--sg-border) bg-(--sg-bg) px-1.5 py-0.5" role="tablist" aria-label="Open files">
        {tabs.map(tab => {
          const key = keyOf(tab);
          const isActive = key === activeTabKey;
          const name = tab.relativePath.split('/').pop() ?? tab.relativePath;
          return (
            <div
              key={key}
              className={`group relative flex shrink-0 items-center gap-1 overflow-hidden rounded px-2 py-1 ${isActive ? 'bg-(--sg-surface-raised)' : 'hover:bg-(--sg-surface)'}`}
            >
              <button
                type="button"
                data-testid="file-editor-tab"
                data-path={tab.relativePath}
                role="tab"
                aria-selected={isActive}
                className={`flex items-center gap-1.5 border-none bg-transparent text-[11px] font-medium cursor-pointer ${isActive ? 'text-(--sg-primary)' : 'text-(--sg-text)'}`}
                onClick={() => onSelectTab(key)}
                title={tab.relativePath}
              >
                {tab.conflict && <FileWarning size={11} className="shrink-0 text-(--sg-warning)" />}
                <span className="max-w-40 truncate">{name}</span>
                {tab.dirty && !tab.conflict && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--sg-warning)" title="Unsaved changes" />
                )}
              </button>
              <button
                type="button"
                className="flex items-center px-0.5 text-(--sg-text-dim) transition-colors hover:text-(--sg-danger) border-none bg-transparent cursor-pointer"
                title={`Close ${name}`}
                onClick={e => {
                  e.stopPropagation();
                  onCloseTab(key);
                }}
              >
                <X size={10} />
              </button>
            </div>
          );
        })}
        <div className="flex-1" />
        {activeTab && (
          <button
            type="button"
            data-testid="btn-save-file"
            title="Save (Cmd/Ctrl+S)"
            disabled={!activeTab.dirty}
            className="mr-1 inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-(--sg-text-dim) transition-colors hover:bg-(--sg-surface-raised) hover:text-(--sg-text) disabled:opacity-40 border-none bg-transparent cursor-pointer disabled:cursor-not-allowed"
            onClick={() => onSave(keyOf(activeTab))}
          >
            <Save size={12} /> Save
          </button>
        )}
      </div>

      {/* Active tab body */}
      {activeTab && (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {activeTab.conflict && (
            <div
              className="flex shrink-0 items-center gap-2 border-b border-(--sg-warning)/30 bg-(--sg-warning)/10 px-3 py-1.5 text-xs text-(--sg-text)"
              data-testid="file-conflict-banner"
            >
              <AlertTriangle size={13} className="shrink-0 text-(--sg-warning)" />
              <span className="flex-1">File changed on disk — you have unsaved changes here.</span>
              <button
                type="button"
                data-testid="btn-conflict-reload"
                className="inline-flex items-center gap-1 rounded border-none bg-(--sg-warning)/20 px-2 py-1 text-[11px] font-medium text-(--sg-text) cursor-pointer hover:bg-(--sg-warning)/30"
                onClick={() => onReloadFromDisk(keyOf(activeTab))}
              >
                <RotateCcw size={11} /> Reload
              </button>
              <button
                type="button"
                data-testid="btn-conflict-keep-mine"
                className="rounded border-none bg-transparent px-2 py-1 text-[11px] font-medium text-(--sg-text-dim) cursor-pointer hover:bg-(--sg-surface-raised) hover:text-(--sg-text)"
                onClick={() => onKeepMine(keyOf(activeTab))}
              >
                Keep mine
              </button>
            </div>
          )}
          {activeTab.error ? (
            <div className="flex flex-1 items-center justify-center text-xs text-(--sg-danger)">{activeTab.error}</div>
          ) : activeTab.loading ? (
            <div className="flex flex-1 items-center justify-center text-xs text-(--sg-text-faint)">Loading…</div>
          ) : (
            <div className="flex-1 min-h-0">
              <MonacoEditor
                key={keyOf(activeTab)}
                value={activeTab.content}
                language={languageForPath(activeTab.relativePath)}
                height="100%"
                onChange={next => onChange(keyOf(activeTab), next)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
