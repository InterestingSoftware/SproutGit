import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, CircleCheck, Save } from 'lucide-react';
import { MonacoEditor, languageForPath, Spinner } from '@sproutgit/ui';
import { api } from '../api.js';
import { parseConflictMarkers, resolveConflictBlock, type ConflictResolution } from './conflict-blocks.js';

type Props = {
  worktreePath: string;
  relativePath: string;
  onResolved: () => void;
  onToast: (message: string, variant: 'success' | 'error' | 'info') => void;
};

const paneLabel = 'shrink-0 border-b border-(--sg-border-subtle) bg-(--sg-surface) px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-(--sg-text-faint)';

export function ConflictResolutionPanel({ worktreePath, relativePath, onResolved, onToast }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resultText, setResultText] = useState('');
  const [savedText, setSavedText] = useState('');
  const [oursText, setOursText] = useState('');
  const [theirsText, setTheirsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const [file, sides] = await Promise.all([
          api.readFile(worktreePath, relativePath),
          api.getConflictFileContent(worktreePath, relativePath),
        ]);
        if (cancelled) return;
        setResultText(file.content);
        setSavedText(file.content);
        setOursText(sides.ours.exists ? sides.ours.content : '(no content — not present on this side)');
        setTheirsText(sides.theirs.exists ? sides.theirs.content : '(no content — not present on this side)');
      } catch (err) {
        if (!cancelled) setError(`Failed to load conflict: ${String(err)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [worktreePath, relativePath]);

  const parsed = useMemo(() => parseConflictMarkers(resultText), [resultText]);
  const remaining = parsed.blocks.length;
  const dirty = resultText !== savedText;
  const language = languageForPath(relativePath);

  function acceptBlock(blockId: string, resolution: ConflictResolution) {
    const block = parsed.blocks.find(b => b.id === blockId);
    if (!block) return;
    setResultText(t => resolveConflictBlock(t, block, resolution));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.writeFile(worktreePath, relativePath, resultText);
      setSavedText(resultText);
      onToast('Saved', 'success');
    } catch (err) {
      onToast(`Failed to save: ${String(err)}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkResolved() {
    if (remaining > 0) {
      onToast(`Resolve ${remaining} remaining conflict${remaining === 1 ? '' : 's'} first`, 'error');
      return;
    }
    setResolving(true);
    try {
      if (dirty) {
        await api.writeFile(worktreePath, relativePath, resultText);
        setSavedText(resultText);
      }
      await api.stageFiles(worktreePath, [relativePath]);
      onToast(`${relativePath} marked resolved`, 'success');
      onResolved();
    } catch (err) {
      onToast(`Failed to mark resolved: ${String(err)}`, 'error');
    } finally {
      setResolving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return <div className="flex h-full items-center justify-center text-xs text-(--sg-danger)">{error}</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="conflict-resolution-panel">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-(--sg-border) bg-(--sg-surface) px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-(--sg-text)" title={relativePath}>
          {relativePath}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${remaining > 0 ? 'bg-(--sg-warning)/20 text-(--sg-warning)' : 'bg-(--sg-primary)/20 text-(--sg-primary)'}`}
          data-testid="conflict-remaining-count"
        >
          {remaining > 0 ? `${remaining} conflict${remaining === 1 ? '' : 's'} remaining` : 'All conflicts resolved'}
        </span>
        <button
          type="button"
          data-testid="btn-save-conflict-file"
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-(--sg-text-dim) transition-colors hover:bg-(--sg-surface-raised) hover:text-(--sg-text) disabled:opacity-40 disabled:cursor-not-allowed border-none bg-transparent cursor-pointer"
          disabled={!dirty || saving}
          onClick={() => void handleSave()}
        >
          <Save size={12} /> Save
        </button>
        <button
          type="button"
          data-testid="btn-mark-resolved"
          className="inline-flex items-center gap-1 rounded bg-(--sg-primary) px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-(--sg-primary-hover) disabled:opacity-40 disabled:cursor-not-allowed border-none cursor-pointer"
          disabled={remaining > 0 || resolving || saving}
          onClick={() => void handleMarkResolved()}
        >
          <CircleCheck size={12} /> Mark Resolved
        </button>
      </div>

      {/* Per-block accept toolbar */}
      {remaining > 0 && (
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-(--sg-border-subtle) bg-(--sg-surface) px-3 py-1.5" data-testid="conflict-block-toolbar">
          {parsed.blocks.map((block, idx) => (
            <div
              key={block.id}
              className="flex shrink-0 items-center gap-1 rounded border border-(--sg-border) px-1.5 py-1"
              data-testid="conflict-block-actions"
              data-block-id={block.id}
            >
              <AlertTriangle size={11} className="shrink-0 text-(--sg-warning)" />
              <span className="text-[10px] font-medium text-(--sg-text-dim)">Conflict {idx + 1}</span>
              <button
                type="button"
                data-testid={`btn-accept-ours-${block.id}`}
                className="rounded border-none bg-(--sg-surface-raised) px-1.5 py-0.5 text-[10px] font-medium text-(--sg-text) cursor-pointer hover:bg-(--sg-primary)/15 hover:text-(--sg-primary)"
                onClick={() => acceptBlock(block.id, 'ours')}
              >
                Accept Ours
              </button>
              <button
                type="button"
                data-testid={`btn-accept-theirs-${block.id}`}
                className="rounded border-none bg-(--sg-surface-raised) px-1.5 py-0.5 text-[10px] font-medium text-(--sg-text) cursor-pointer hover:bg-(--sg-primary)/15 hover:text-(--sg-primary)"
                onClick={() => acceptBlock(block.id, 'theirs')}
              >
                Accept Theirs
              </button>
              <button
                type="button"
                data-testid={`btn-accept-both-${block.id}`}
                className="rounded border-none bg-(--sg-surface-raised) px-1.5 py-0.5 text-[10px] font-medium text-(--sg-text) cursor-pointer hover:bg-(--sg-primary)/15 hover:text-(--sg-primary)"
                onClick={() => acceptBlock(block.id, 'both')}
              >
                Accept Both
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Three-pane view: ours / theirs / result */}
      <div className="grid flex-1 min-h-0 grid-cols-3 divide-x divide-(--sg-border)">
        <div className="flex min-w-0 flex-col overflow-hidden">
          <div className={paneLabel}>Ours</div>
          <div className="min-h-0 flex-1">
            <MonacoEditor value={oursText} language={language} height="100%" readOnly />
          </div>
        </div>
        <div className="flex min-w-0 flex-col overflow-hidden">
          <div className={paneLabel}>Theirs</div>
          <div className="min-h-0 flex-1">
            <MonacoEditor value={theirsText} language={language} height="100%" readOnly />
          </div>
        </div>
        <div className="flex min-w-0 flex-col overflow-hidden">
          <div className={paneLabel}>
            Result
            {remaining === 0 && <Check size={11} className="ml-1 inline text-(--sg-primary)" />}
          </div>
          <div className="min-h-0 flex-1">
            <MonacoEditor value={resultText} language={language} height="100%" onChange={setResultText} />
          </div>
        </div>
      </div>
    </div>
  );
}
