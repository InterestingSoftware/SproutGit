import { useEffect, useRef } from 'react';
import { Spinner } from '@sproutgit/ui';
import type { WorktreeInfo } from '@sproutgit/types';
import { secondaryBtn } from './dialog-classes.js';

type Props = {
  target: WorktreeInfo | null;
  loading: boolean;
  onConfirm: (wt: WorktreeInfo) => void;
  onCancel: () => void;
};

const dangerBtn = 'inline-flex items-center gap-[5px] px-3 py-[5px] rounded-[6px] border-none cursor-pointer text-xs font-medium transition-colors whitespace-nowrap bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed';

export function DeleteWorktreeDialog({ target, loading, onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (target) {
      dialog.showModal();
    } else {
      dialog.close();
    }
  }, [target]);

  if (!target) return <dialog ref={dialogRef} />;

  const label = target.branch ?? target.path.split('/').pop() ?? target.path;

  return (
    <dialog ref={dialogRef} onClose={onCancel} className="rounded-xl shadow-xl">
      <div className="bg-(--sg-surface) border border-(--sg-border) rounded-xl p-6 min-w-[340px] max-w-[480px] flex flex-col gap-4">
        <h2 className="text-[15px] font-semibold m-0 text-(--sg-text)">Remove Worktree</h2>
        <p className="text-xs text-(--sg-text-dim) m-0">
          Remove worktree <strong>"{label}"</strong>? This cannot be undone.
        </p>
        {target.isExternal && (
          <p className="text-xs text-(--sg-warning) m-0">
            This worktree was registered by an external tool — only the worktree registration will be removed
            {target.branch
              ? <> and its branch <strong>"{target.branch}"</strong> will not be deleted.</>
              : '.'}
          </p>
        )}
        <div className="flex gap-2 justify-end">
          <button className={secondaryBtn} onClick={onCancel} disabled={loading}>Cancel</button>
          <button className={dangerBtn} onClick={() => onConfirm(target)} disabled={loading} data-testid="btn-confirm-delete-worktree">
            {loading ? <Spinner size="sm" /> : 'Remove'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
