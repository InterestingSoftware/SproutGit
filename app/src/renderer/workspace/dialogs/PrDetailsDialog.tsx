import { api } from '../../api.js';
import { useEffect, useRef, useState } from 'react';
import { Spinner } from '@sproutgit/ui';
import {
  ExternalLink,
  CircleCheck,
  CircleX,
  CircleDashed,
  Circle,
  ChevronDown,
  ChevronRight,
  GitPullRequest,
  GitPullRequestDraft,
  GitPullRequestClosed,
  GitMerge,
} from 'lucide-react';
import type { WorktreeInfo, PullRequestStatus, PullRequestCheck, CheckFailureDetail, MergeMethod } from '@sproutgit/types';
import { useSetPrReady, useMergePr } from '../../queries.js';
import { primaryBtn, secondaryBtn, fieldLabel, fieldInput } from './dialog-classes.js';

type Props = {
  open: boolean;
  worktree: WorktreeInfo | null;
  status: PullRequestStatus | null;
  onClose: () => void;
  onToast: (msg: string, variant: 'success' | 'error') => void;
};

// 'error' only shows up on legacy commit-status conclusions; the Checks API's
// conclusions never include it (that's what 'timed_out'/'action_required' cover there).
const FAILING_CONCLUSIONS = new Set(['failure', 'error', 'timed_out', 'cancelled', 'action_required']);

function checkIcon(check: PullRequestCheck) {
  if (check.status !== 'completed') return <CircleDashed size={13} className="text-(--sg-warning)" />;
  if (check.conclusion === 'success') return <CircleCheck size={13} className="text-(--sg-primary)" />;
  if (check.conclusion && FAILING_CONCLUSIONS.has(check.conclusion)) return <CircleX size={13} className="text-(--sg-danger)" />;
  return <Circle size={13} className="text-(--sg-text-faint)" />;
}

/** Expandable row for one check — fetches failure detail lazily, only for a failing `check_run`-sourced check (legacy statuses have no log detail to show). */
function CheckRow({ worktreePath, check }: { worktreePath: string; check: PullRequestCheck }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<CheckFailureDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const isFailing = check.conclusion !== null && FAILING_CONCLUSIONS.has(check.conclusion);
  const canExpand = isFailing && check.source === 'check_run';

  async function toggle() {
    if (!canExpand) {
      if (check.detailsUrl) void api.openUrl(check.detailsUrl);
      return;
    }
    const next = !expanded;
    setExpanded(next);
    if (next && !detail) {
      setLoading(true);
      try {
        const result = await api.githubGetCheckFailureDetail({ worktreePath, checkId: check.id });
        setDetail(result);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="border-b border-(--sg-border-subtle) last:border-b-0">
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-(--sg-text) hover:bg-(--sg-surface-raised)"
        data-testid="pr-check-row"
      >
        {canExpand ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="w-3" />}
        {checkIcon(check)}
        <span className="flex-1 truncate">{check.name}</span>
        {!canExpand && check.detailsUrl && <ExternalLink size={11} className="text-(--sg-text-faint)" />}
      </button>
      {expanded && (
        <div className="bg-(--sg-surface-raised) px-3 py-2 text-[11px] text-(--sg-text-dim)">
          {loading ? (
            <Spinner size="sm" />
          ) : detail ? (
            <div className="flex flex-col gap-1.5">
              {detail.summary && <p className="whitespace-pre-wrap">{detail.summary}</p>}
              {detail.annotations.map((a, i) => (
                <div key={i} className="rounded border border-(--sg-border) bg-(--sg-surface) px-2 py-1">
                  <p className="font-mono text-[10px] text-(--sg-text-faint)">{a.path}:{a.startLine}</p>
                  <p>{a.message}</p>
                </div>
              ))}
              {!detail.summary && detail.annotations.length === 0 && <p>No failure detail available.</p>}
            </div>
          ) : (
            <p>Could not load failure detail.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function PrDetailsDialog({ open, worktree, status, onClose, onToast }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mergeMethod, setMergeMethod] = useState<MergeMethod>('merge');

  const worktreePath = worktree?.path ?? '';
  const setReadyMutation = useSetPrReady(worktreePath);
  const mergeMutation = useMergePr(worktreePath);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) dialog.showModal();
    else dialog.close();
  }, [open]);

  const pr = status?.pullRequest ?? null;

  async function handleToggleReady() {
    if (!pr) return;
    try {
      await setReadyMutation.mutateAsync(pr.draft);
      onToast(pr.draft ? 'Marked ready for review' : 'Converted to draft', 'success');
    } catch (err) {
      onToast(String(err), 'error');
    }
  }

  async function handleMerge() {
    if (!pr) return;
    try {
      const result = await mergeMutation.mutateAsync(mergeMethod);
      if (result.merged) {
        onToast(`PR #${pr.number} merged`, 'success');
        onClose();
      } else {
        onToast(result.message || 'Merge did not complete', 'error');
      }
    } catch (err) {
      onToast(String(err), 'error');
    }
  }

  const stateIcon = pr && pr.draft
    ? <GitPullRequestDraft size={14} className="text-(--sg-text-faint)" />
    : pr?.state === 'merged'
      ? <GitMerge size={14} className="text-(--sg-accent)" />
      : pr?.state === 'closed'
        ? <GitPullRequestClosed size={14} className="text-(--sg-danger)" />
        : <GitPullRequest size={14} className="text-(--sg-primary)" />;

  const canChangeReadiness = pr?.state === 'open';
  const canMerge = pr?.state === 'open' && !pr.draft;

  return (
    <dialog ref={dialogRef} onClose={onClose} className="rounded-xl shadow-xl">
      <div className="bg-(--sg-surface) border border-(--sg-border) rounded-xl p-6 min-w-[26rem] flex flex-col gap-4" data-testid="pr-details-dialog">
        {!pr ? (
          <>
            <p className="text-xs text-(--sg-text-dim)">
              {status === null ? 'Loading pull request…' : 'No pull request info available right now.'}
            </p>
            <div className="flex justify-end">
              <button type="button" className={secondaryBtn} onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                {stateIcon}
                <div>
                  <h2 className="text-[15px] font-semibold m-0 text-(--sg-text)">{pr.title}</h2>
                  <p className="text-xs text-(--sg-text-dim) m-0">
                    #{pr.number} · {pr.headBranch} → {pr.baseBranch}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="p-1 text-(--sg-text-faint) hover:text-(--sg-text)"
                onClick={() => void api.openUrl(pr.url)}
                title="Open on GitHub"
                data-testid="btn-open-pr-in-browser"
              >
                <ExternalLink size={14} />
              </button>
            </div>

            <div>
              <p className={fieldLabel}>Checks</p>
              {status && status.checks.length > 0 ? (
                <div className="mt-1.5 rounded-md border border-(--sg-border)">
                  {status.checks.map(check => (
                    <CheckRow key={check.id} worktreePath={worktreePath} check={check} />
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-xs text-(--sg-text-faint)">No checks reported for this PR.</p>
              )}
            </div>

            {canChangeReadiness && (
              <div className="flex items-center justify-between rounded-md border border-(--sg-border) px-3 py-2.5">
                <p className="text-xs text-(--sg-text-dim)">
                  {pr.draft ? 'This PR is a draft.' : 'This PR is ready for review.'}
                </p>
                <button
                  type="button"
                  className={secondaryBtn}
                  disabled={setReadyMutation.isPending}
                  onClick={() => void handleToggleReady()}
                  data-testid="btn-toggle-pr-ready"
                >
                  {setReadyMutation.isPending ? <Spinner size="sm" /> : pr.draft ? 'Mark ready for review' : 'Convert to draft'}
                </button>
              </div>
            )}

            {canMerge && (
              <div className="flex items-center gap-2 rounded-md border border-(--sg-border) px-3 py-2.5">
                <select
                  className={`${fieldInput} w-auto`}
                  value={mergeMethod}
                  onChange={e => setMergeMethod(e.target.value as MergeMethod)}
                  disabled={mergeMutation.isPending}
                  data-testid="select-merge-method"
                >
                  <option value="merge">Merge commit</option>
                  <option value="squash">Squash and merge</option>
                  <option value="rebase">Rebase and merge</option>
                </select>
                <button
                  type="button"
                  className={`${primaryBtn} ml-auto`}
                  disabled={mergeMutation.isPending}
                  onClick={() => void handleMerge()}
                  data-testid="btn-merge-pr"
                >
                  {mergeMutation.isPending ? <Spinner size="sm" /> : 'Merge'}
                </button>
              </div>
            )}

            <div className="flex justify-end">
              <button type="button" className={secondaryBtn} onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
