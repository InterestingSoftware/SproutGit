import { api } from '../../api.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from '@sproutgit/ui';
import type { RefInfo, WorktreeInfo, PullRequestInfo } from '@sproutgit/types';
import { primaryBtn, secondaryBtn, fieldLabel, fieldInput } from './dialog-classes.js';

type Props = {
  open: boolean;
  worktree: WorktreeInfo | null;
  refs: RefInfo[];
  onClose: () => void;
  onToast: (msg: string, variant: 'success' | 'error') => void;
  onCreated: (pr: PullRequestInfo) => void;
};

/** Prefers `main`, falls back to `master`, then the first non-remote branch that isn't the PR's own head. */
function guessBaseBranch(refs: RefInfo[], headBranch: string | null): string {
  const branches = refs.filter(r => r.kind === 'branch' && r.name !== headBranch).map(r => r.name);
  return branches.find(b => b === 'main') ?? branches.find(b => b === 'master') ?? branches[0] ?? 'main';
}

export function CreatePrDialog({ open, worktree, refs, onClose, onToast, onCreated }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const branches = useMemo(() => refs.filter(r => r.kind === 'branch').map(r => r.name), [refs]);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [base, setBase] = useState('main');
  const [draft, setDraft] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      dialog.showModal();
      setTitle(worktree?.branch ?? '');
      setBody('');
      setBase(guessBaseBranch(refs, worktree?.branch ?? null));
      setDraft(false);
    } else {
      dialog.close();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, worktree?.path]);

  async function handleCreate() {
    if (!worktree) return;
    setCreating(true);
    try {
      const trimmedBody = body.trim();
      const pr = await api.githubCreatePr({
        worktreePath: worktree.path,
        title: title.trim(),
        base: base.trim(),
        draft,
        ...(trimmedBody ? { body: trimmedBody } : {}),
      });
      onToast(`PR #${pr.number} created`, 'success');
      onCreated(pr);
      onClose();
    } catch (err) {
      onToast(`Create PR failed: ${String(err)}`, 'error');
    } finally {
      setCreating(false);
    }
  }

  return (
    <dialog ref={dialogRef} onClose={onClose} className="rounded-xl shadow-xl">
      <div className="bg-(--sg-surface) border border-(--sg-border) rounded-xl p-6 min-w-96 flex flex-col gap-4">
        <h2 className="text-[15px] font-semibold m-0 text-(--sg-text)">Create Pull Request</h2>
        <p className="text-xs text-(--sg-text-dim) m-0">
          Open a PR from <strong>{worktree?.branch}</strong> into another branch.
        </p>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Title</span>
          <input
            className={fieldInput}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Summarize the change"
            disabled={creating}
            autoFocus
            data-testid="input-create-pr-title"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Description</span>
          <textarea
            className={`${fieldInput} min-h-24 resize-y font-mono`}
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Optional description"
            disabled={creating}
            data-testid="input-create-pr-body"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Base branch</span>
          {branches.length > 0 ? (
            <select
              className={fieldInput}
              value={base}
              onChange={e => setBase(e.target.value)}
              disabled={creating}
              data-testid="select-create-pr-base"
            >
              {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          ) : (
            <input
              className={fieldInput}
              value={base}
              onChange={e => setBase(e.target.value)}
              placeholder="main"
              disabled={creating}
            />
          )}
        </label>
        <label className="flex items-center gap-2 text-xs text-(--sg-text-dim)">
          <input
            type="checkbox"
            checked={draft}
            onChange={e => setDraft(e.target.checked)}
            disabled={creating}
            data-testid="checkbox-create-pr-draft"
          />
          Create as draft
        </label>
        <div className="flex gap-2 justify-end">
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={creating}>Cancel</button>
          <button
            type="button"
            className={primaryBtn}
            disabled={creating || !title.trim() || !base.trim()}
            onClick={() => void handleCreate()}
            data-testid="btn-confirm-create-pr"
          >
            {creating ? <Spinner size="sm" /> : 'Create PR'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
