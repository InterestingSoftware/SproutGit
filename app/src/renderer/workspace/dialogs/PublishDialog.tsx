import { api } from '../../api.js';
import { useEffect, useRef, useState } from 'react';
import { Spinner } from '@sproutgit/ui';
import type { WorktreeInfo, WorktreePushStatus } from '@sproutgit/types';
import { primaryBtn, secondaryBtn, fieldLabel, fieldInput } from './dialog-classes.js';

type Props = {
  open: boolean;
  activeWorktree: WorktreeInfo | null;
  pushStatus: WorktreePushStatus | null;
  onClose: () => void;
  onToast: (msg: string, variant: 'success' | 'error') => void;
  onPublished: () => void;
};

export function PublishDialog({ open, activeWorktree, pushStatus, onClose, onToast, onPublished }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const remotes = pushStatus?.remotes && pushStatus.remotes.length > 0 ? pushStatus.remotes : ['origin'];

  const [remote, setRemote] = useState(pushStatus?.suggestedRemote ?? remotes[0] ?? 'origin');
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      dialog.showModal();
      setRemote(pushStatus?.suggestedRemote ?? remotes[0] ?? 'origin');
    } else {
      dialog.close();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handlePublish() {
    if (!activeWorktree) return;
    setPublishing(true);
    try {
      await api.push(activeWorktree.path, remote);
      onToast(`Published to ${remote}`, 'success');
      onClose();
      onPublished();
    } catch (err) {
      onToast(`Publish failed: ${String(err)}`, 'error');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <dialog ref={dialogRef} onClose={onClose} className="rounded-xl shadow-xl">
      <div className="bg-(--sg-surface) border border-(--sg-border) rounded-xl p-6 min-w-80 flex flex-col gap-4">
        <h2 className="text-[15px] font-semibold m-0 text-(--sg-text)">Publish Branch</h2>
        <p className="text-xs text-(--sg-text-dim) m-0">
          Choose a remote to publish <strong>{activeWorktree?.branch}</strong> to.
        </p>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Remote</span>
          {remotes.length > 1 ? (
            <select
              className={fieldInput}
              value={remote}
              onChange={e => setRemote(e.target.value)}
              disabled={publishing}
            >
              {remotes.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          ) : (
            <input
              className={fieldInput}
              value={remote}
              onChange={e => setRemote(e.target.value)}
              placeholder="origin"
              disabled={publishing}
              spellCheck={false}
            />
          )}
        </label>
        <div className="flex gap-2 justify-end">
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={publishing}>Cancel</button>
          <button
            type="button"
            className={primaryBtn}
            disabled={publishing || !remote.trim()}
            onClick={() => void handlePublish()}
          >
            {publishing ? <Spinner size="sm" /> : 'Publish'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
