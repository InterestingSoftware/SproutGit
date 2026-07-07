import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Check, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { type StashEntry, type StashListResult } from '@sproutgit/types';
import { Spinner } from './Spinner.js';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  worktreePath: string;
  /** True when there are uncommitted changes worth stashing. */
  hasChangesToStash: boolean;
  listStashes: (worktreePath: string) => Promise<StashListResult>;
  createStash: (worktreePath: string, message?: string) => Promise<void>;
  applyStash: (worktreePath: string, ref: string) => Promise<void>;
  popStash: (worktreePath: string, ref: string) => Promise<void>;
  dropStash: (worktreePath: string, ref: string) => Promise<void>;
  onToast?: ((message: string, variant: 'success' | 'error') => void) | undefined;
  /** Called after apply/pop/create, since those touch the working tree/index. */
  onChanged?: (() => void) | undefined;
  /** Increment from outside to trigger a stash list reload. */
  refreshSignal?: number;
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Collapsible stash list with create/apply/pop/drop actions. All git
 * operations are injected async callbacks, same pattern as StagingPanel —
 * this component has no direct IPC dependency.
 */
export function StashPanel({
  worktreePath,
  hasChangesToStash,
  listStashes,
  createStash: createStashFn,
  applyStash: applyStashFn,
  popStash: popStashFn,
  dropStash: dropStashFn,
  onToast,
  onChanged,
  refreshSignal = 0,
}: Props) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState('');
  const stashKey = ['stashList', worktreePath, refreshSignal] as const;

  const { data: stashes = [], isError: stashesErrored } = useQuery({
    queryKey: stashKey,
    queryFn: async () => (await listStashes(worktreePath)).stashes,
    staleTime: 0,
    retry: 0,
    throwOnError: false,
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['stashList', worktreePath] });
  }

  const createMutation = useMutation({
    mutationFn: (msg: string) => createStashFn(worktreePath, msg.trim() || undefined),
    onSuccess: () => {
      setMessage('');
      onToast?.('Stashed changes', 'success');
      invalidate();
      onChanged?.();
    },
    onError: (err) => onToast?.(`Failed to stash: ${String(err)}`, 'error'),
  });

  const applyMutation = useMutation({
    mutationFn: (ref: string) => applyStashFn(worktreePath, ref),
    onSuccess: () => {
      onToast?.('Stash applied', 'success');
      onChanged?.();
    },
    onError: (err) => onToast?.(`Failed to apply stash: ${String(err)}`, 'error'),
  });

  const popMutation = useMutation({
    mutationFn: (ref: string) => popStashFn(worktreePath, ref),
    onSuccess: () => {
      onToast?.('Stash popped', 'success');
      invalidate();
      onChanged?.();
    },
    onError: (err) => onToast?.(`Failed to pop stash: ${String(err)}`, 'error'),
  });

  const dropMutation = useMutation({
    mutationFn: (ref: string) => dropStashFn(worktreePath, ref),
    onSuccess: () => {
      onToast?.('Stash dropped', 'success');
      invalidate();
    },
    onError: (err) => onToast?.(`Failed to drop stash: ${String(err)}`, 'error'),
  });

  // Stash operations aren't safely parallelizable — apply/pop/drop all read
  // and rewrite the same working tree + index, so running two at once (even
  // against different stash entries) can race. Block every row's actions
  // while any of the four mutations is in flight, not just the one the user
  // clicked.
  const anyStashOpPending =
    createMutation.isPending || applyMutation.isPending || popMutation.isPending || dropMutation.isPending;

  const sectionHdr = 'flex items-center justify-between px-[10px] py-[5px] text-[11px] font-semibold text-(--sg-text-faint) uppercase tracking-[0.04em] shrink-0 bg-(--sg-surface)';
  const iconBtn = 'inline-flex items-center justify-center p-[3px] bg-transparent border-none cursor-pointer text-(--sg-text-faint) rounded-[4px] transition-colors hover:text-(--sg-text) hover:bg-(--sg-surface-raised) disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <section className="sg-stash-panel border-t border-(--sg-border) shrink-0" data-testid="stash-panel">
      <div
        className={`${sectionHdr} cursor-pointer select-none`}
        onClick={() => setExpanded(v => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setExpanded(v => !v); }}
        data-testid="btn-toggle-stash-panel"
      >
        <span className="flex items-center gap-1">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Archive size={12} /> Stash ({stashes.length})
        </span>
      </div>

      {expanded && (
        <div className="flex flex-col gap-1.5 px-[10px] py-1.5 border-t border-(--sg-border-subtle)">
          <div className="flex gap-1.5">
            <input
              className="flex-1 min-w-0 bg-(--sg-input-bg) border border-(--sg-input-border) rounded px-1.5 py-1 text-[11px] text-(--sg-text) placeholder:text-(--sg-text-faint) outline-none focus:border-(--sg-input-focus)"
              placeholder="Stash message (optional)"
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && hasChangesToStash && !anyStashOpPending) createMutation.mutate(message); }}
              data-testid="input-stash-message"
            />
            <button
              className="sg-btn--primary inline-flex shrink-0 items-center gap-1 rounded bg-(--sg-primary) px-2 py-1 text-[11px] font-medium text-white hover:bg-(--sg-primary-hover) disabled:cursor-not-allowed disabled:opacity-40 border-none cursor-pointer transition-colors"
              onClick={() => createMutation.mutate(message)}
              disabled={!hasChangesToStash || anyStashOpPending}
              title={hasChangesToStash ? 'Stash current changes' : 'No changes to stash'}
              data-testid="btn-create-stash"
            >
              {createMutation.isPending ? <Spinner size="sm" /> : <Archive size={12} />} Stash
            </button>
          </div>

          <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
            {stashesErrored ? (
              <p className="px-0.5 py-1 text-[11px] text-(--sg-danger)">Failed to load stashes.</p>
            ) : stashes.length === 0 ? (
              <p className="px-0.5 py-1 text-[11px] text-(--sg-text-faint) italic">No stashes</p>
            ) : null}
            {stashes.map(s => (
              <StashRow
                key={s.ref}
                entry={s}
                iconBtnClass={iconBtn}
                onApply={() => applyMutation.mutate(s.ref)}
                onPop={() => popMutation.mutate(s.ref)}
                onDrop={() => dropMutation.mutate(s.ref)}
                disabled={anyStashOpPending}
                applying={applyMutation.isPending && applyMutation.variables === s.ref}
                popping={popMutation.isPending && popMutation.variables === s.ref}
                dropping={dropMutation.isPending && dropMutation.variables === s.ref}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function StashRow({
  entry,
  iconBtnClass,
  onApply,
  onPop,
  onDrop,
  disabled,
  applying,
  popping,
  dropping,
}: {
  entry: StashEntry;
  iconBtnClass: string;
  onApply: () => void;
  onPop: () => void;
  onDrop: () => void;
  /** True whenever *any* stash mutation (this row's or another's) is in flight. */
  disabled: boolean;
  applying: boolean;
  popping: boolean;
  dropping: boolean;
}) {
  return (
    <div
      className="sg-stash-row flex items-center gap-1 text-[11px] py-1"
      data-testid="stash-row"
      data-ref={entry.ref}
    >
      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap" title={entry.message}>
        {entry.ref} — {entry.message}
      </span>
      <button className={iconBtnClass} onClick={onApply} disabled={disabled} title="Apply (keep stash)" data-testid="btn-apply-stash">
        {applying ? <Spinner size="sm" /> : <ArchiveRestore size={12} />}
      </button>
      <button className={iconBtnClass} onClick={onPop} disabled={disabled} title="Pop (apply and remove)" data-testid="btn-pop-stash">
        {popping ? <Spinner size="sm" /> : <Check size={12} />}
      </button>
      <button className={iconBtnClass} onClick={onDrop} disabled={disabled} title="Drop (delete without applying)" data-testid="btn-drop-stash">
        {dropping ? <Spinner size="sm" /> : <Trash2 size={12} />}
      </button>
    </div>
  );
}
