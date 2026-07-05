import { api } from '../../api.js';
import { useEffect, useRef, useState } from 'react';
import { Spinner } from '@sproutgit/ui';
import type { WorktreeInfo, WorkspaceHook } from '@sproutgit/types';
import { X } from 'lucide-react';
import { secondaryBtn } from './dialog-classes.js';

type Props = {
  target: WorktreeInfo | null;
  workspacePath: string;
  activeWorktreePath: string | null;
  onClose: () => void;
  onToast: (msg: string, variant: 'success' | 'error') => void;
};

const iconBtn = 'inline-flex items-center justify-center p-[3px] bg-transparent border-none cursor-pointer text-(--sg-text-faint) rounded-[4px] transition-colors hover:text-(--sg-text) hover:bg-(--sg-surface-raised) disabled:opacity-40 disabled:cursor-not-allowed';

export function RunHookDialog({ target, workspacePath, activeWorktreePath, onClose, onToast }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [hooks, setHooks] = useState<WorkspaceHook[]>([]);
  const [loading, setLoading] = useState(false);
  const [runningHookId, setRunningHookId] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (target) {
      dialog.showModal();
      setRunningHookId(null);
      setLoading(true);
      void api.listHooks(workspacePath, target.path)
        // Untrusted repo hooks are listed elsewhere (Workspace Hooks) for
        // visibility, but never offered here — running one would just
        // silently no-op since the main process re-checks trust anyway.
        .then(({ hooks: all }) => setHooks(all.filter(h => h.enabled && h.trusted)))
        .catch((err: unknown) => { onToast(`Failed to load hooks: ${String(err)}`, 'error'); onClose(); })
        .finally(() => setLoading(false));
    } else {
      dialog.close();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  async function doRunHook(hook: WorkspaceHook) {
    if (!target) return;
    setRunningHookId(hook.id);
    try {
      await api.runHook({
        workspacePath,
        hookId: hook.id,
        worktreePath: target.path,
        trigger: hook.trigger,
        initiatingWorktreePath: activeWorktreePath,
      });
      onToast(`Ran hook: ${hook.name}`, 'success');
    } catch (err) {
      onToast(`Hook failed: ${String(err)}`, 'error');
    } finally {
      setRunningHookId(null);
      onClose();
    }
  }

  const label = target?.branch ?? target?.path.split('/').pop() ?? '';

  return (
    <dialog ref={dialogRef} onClose={onClose} className="rounded-xl shadow-xl">
      <div className="bg-(--sg-surface) border border-(--sg-border) rounded-xl p-5 min-w-[360px] max-w-[480px] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold m-0 text-(--sg-text)">
            Run Hook on <span className="text-(--sg-primary)">{label}</span>
          </h2>
          <button className={iconBtn} onClick={onClose} disabled={!!runningHookId}><X size={13} /></button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-4"><Spinner /></div>
        ) : hooks.length === 0 ? (
          <p className="text-xs text-(--sg-text-dim) m-0">No enabled hooks found.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {hooks.map(hook => (
              <button
                key={hook.id}
                className={`${secondaryBtn} w-full justify-between`}
                disabled={!!runningHookId}
                onClick={() => void doRunHook(hook)}
              >
                <span className="truncate">{hook.name}</span>
                <span className="text-(--sg-text-faint) text-[10px] shrink-0 ml-2">{hook.trigger}</span>
                {runningHookId === hook.id && <Spinner size="sm" />}
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-end pt-1">
          <button className={secondaryBtn} onClick={onClose} disabled={!!runningHookId}>Close</button>
        </div>
      </div>
    </dialog>
  );
}
