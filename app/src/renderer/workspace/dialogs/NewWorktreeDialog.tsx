import { api } from '../../api.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Spinner, Autocomplete, matchIssueRef } from '@sproutgit/ui';
import { validateBranchName, type RefInfo, type IssueTrackerPattern, type ProviderIssue } from '@sproutgit/types';
import { primaryBtn, secondaryBtn, fieldLabel, fieldInput } from './dialog-classes.js';

type Props = {
  open: boolean;
  workspacePath: string;
  gitRepoPath: string;
  managedWorktreesPath: string;
  refs: RefInfo[];
  issueTrackerPatterns?: IssueTrackerPattern[];
  /** The worktree the user was viewing when opening this dialog, if any — recorded as the operation's initiating worktree (env var for hooks). */
  initiatingWorktreePath: string | null;
  onClose: () => void;
  onCreated: (newWorktreePath: string) => void;
  onToast: (msg: string, variant: 'success' | 'error') => void;
};

export function NewWorktreeDialog({ open, workspacePath, gitRepoPath, managedWorktreesPath, refs, issueTrackerPatterns = [], initiatingWorktreePath, onClose, onCreated, onToast }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [branchName, setBranchName] = useState('');
  const [branchFrom, setBranchFrom] = useState('HEAD');
  const [branchType, setBranchType] = useState<'managed' | 'persistent'>('managed');
  const [creating, setCreating] = useState(false);
  const [branchNameError, setBranchNameError] = useState<string | null>(null);

  const [issueInput, setIssueInput] = useState('');
  const [issuePreview, setIssuePreview] = useState<ProviderIssue | null>(null);
  const [issuePreviewLoading, setIssuePreviewLoading] = useState(false);

  const issueMatch = useMemo(() => matchIssueRef(issueInput, issueTrackerPatterns), [issueInput, issueTrackerPatterns]);
  // Falls back to the raw typed text as a free-form ref when it doesn't
  // match any configured .issuetracker pattern (not every repo has one).
  const effectiveIssueRef = issueMatch?.ref ?? (issueInput.trim() || null);

  useEffect(() => {
    const url = issueMatch?.url;
    if (!url) { setIssuePreview(null); setIssuePreviewLoading(false); return; }
    let cancelled = false;
    setIssuePreviewLoading(true);
    const timer = setTimeout(() => {
      api.fetchProviderIssue(url)
        .then(issue => { if (!cancelled) setIssuePreview(issue); })
        .catch(() => { if (!cancelled) setIssuePreview(null); })
        .finally(() => { if (!cancelled) setIssuePreviewLoading(false); });
    }, 400);
    // Guards against an older, slower request resolving after a newer one
    // and clobbering its result — not just the timer, since fetchProviderIssue
    // itself is already in flight by the time a newer URL supersedes it.
    return () => { cancelled = true; clearTimeout(timer); };
  }, [issueMatch?.url]);

  function handleIssueBlur() {
    if (!effectiveIssueRef) return;
    setBranchName(prev => {
      const trimmed = prev.trim();
      if (!trimmed) return effectiveIssueRef;
      if (trimmed.includes(effectiveIssueRef)) return prev;
      return `${effectiveIssueRef}-${trimmed}`;
    });
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      dialog.showModal();
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      dialog.close();
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nameErr = validateBranchName(branchName.trim());
    if (nameErr) { setBranchNameError(nameErr); return; }
    if (!branchFrom.trim()) { setBranchNameError('Source ref is required'); return; }
    setBranchNameError(null);
    setCreating(true);
    onClose(); // Optimistically close; pending branch shown in sidebar
    try {
      const result = await api.createWorktree({
        workspacePath,
        rootRepoPath: gitRepoPath,
        managedWorktreesPath,
        fromRef: branchFrom || 'HEAD',
        newBranch: branchName.trim(),
        initiatingWorktreePath,
        issueRef: effectiveIssueRef,
        issueTitle: issuePreview?.title ?? null,
      });
      onToast('Worktree created', 'success');
      setBranchName('');
      setBranchFrom('HEAD');
      setBranchType('managed');
      setIssueInput('');
      setIssuePreview(null);
      onCreated(result.worktreePath);
    } catch (err) {
      onToast(`Failed: ${String(err)}`, 'error');
    } finally {
      setCreating(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
    >
      <form
        className="bg-(--sg-surface) border border-(--sg-border) rounded-xl p-6 min-w-80 max-w-[480px] w-full"
        onSubmit={e => void handleSubmit(e)}
      >
        <h2 className="text-[15px] font-semibold m-0 mb-4 text-(--sg-text)">New Worktree</h2>
        <div className="flex flex-col gap-3 mb-4">
          <div className="flex flex-col gap-1">
            <span className={fieldLabel}>Branch type</span>
            <div className="inline-flex rounded-lg border border-(--sg-border) bg-(--sg-surface-raised) p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setBranchType('managed')}
                className={`rounded px-2.5 py-1 transition-colors ${branchType === 'managed' ? 'bg-(--sg-primary) text-white' : 'text-(--sg-text-dim) hover:text-(--sg-text)'}`}
              >Managed</button>
              <button
                type="button"
                onClick={() => {
                  setBranchType('persistent');
                  if (!branchName.trim()) setBranchName(branchFrom === 'HEAD' ? 'main' : branchFrom);
                }}
                className={`rounded px-2.5 py-1 transition-colors ${branchType === 'persistent' ? 'bg-(--sg-primary) text-white' : 'text-(--sg-text-dim) hover:text-(--sg-text)'}`}
              >Persistent</button>
            </div>
            <p className="text-[11px] text-(--sg-text-dim) m-0 mt-0.5">
              {branchType === 'managed'
                ? 'Short-lived branch for one task — eligible for cleanup once merged.'
                : 'Long-lived branch kept alongside others — never auto-deleted.'}
            </p>
          </div>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Issue (optional)</span>
            <input
              className={fieldInput}
              value={issueInput}
              onChange={e => setIssueInput(e.target.value)}
              onBlur={handleIssueBlur}
              placeholder="ABCD-123 or an issue URL"
              disabled={creating}
              spellCheck={false}
              data-testid="input-new-worktree-issue"
            />
            {issuePreviewLoading && (
              <span className="text-[11px] text-(--sg-text-dim) flex items-center gap-1"><Spinner size="sm" /> Looking up issue…</span>
            )}
            {!issuePreviewLoading && issuePreview && (
              <span className="text-[11px] text-(--sg-text-dim)" data-testid="new-worktree-issue-preview">
                {issuePreview.title} <span className="opacity-70">({issuePreview.state})</span>
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Branch name</span>
            <input
              ref={inputRef}
              className={fieldInput}
              value={branchName}
              onChange={e => { setBranchName(e.target.value); setBranchNameError(null); }}
              placeholder={branchType === 'managed' ? 'feature/my-task' : 'main'}
              required
              disabled={creating}
              spellCheck={false}
              data-testid="input-new-branch"
            />
            {branchNameError && <span className="text-[11px] text-red-500">{branchNameError}</span>}
          </label>
          <label className="flex flex-col gap-1" data-testid="from-ref-container">
            <span className={fieldLabel}>From ref</span>
            <Autocomplete
              options={refs.map(r => ({
                label: r.name,
                value: r.name,
                description: r.kind === 'remote' ? 'remote' : r.kind === 'branch' ? 'local' : 'tag',
              }))}
              value={branchFrom}
              onChange={setBranchFrom}
              placeholder="HEAD"
              disabled={creating}
            />
          </label>
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={creating}>Cancel</button>
          <button type="submit" className={primaryBtn} disabled={creating} data-testid="btn-create-worktree">
            {creating ? <Spinner size="sm" /> : 'Create'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
