import { api } from '../api.js';
import { useToast } from '../toast-context.js';
import { describeFetchSummary } from '../queries.js';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ResizableSidebar,
  Spinner,
  useContextMenu,
  UpdateBadge,
} from '@sproutgit/ui';
import { GitBranch, RefreshCw, ArrowDownToLine, ArrowUpFromLine, Download, Plus, Sliders, Trash2, MoreHorizontal, FolderPen, FolderSearch, SquareTerminal, Play, Copy, CopyPlus, Bot, Link2, Rocket, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { WorktreeInfo, WorkspaceStatus } from '@sproutgit/types';
import type { UpdateState } from '@sproutgit/ui';

type Props = {
  workspacePath: string;
  worktrees: WorktreeInfo[];
  activeWorktree: WorktreeInfo | null;
  workspaceStatus: WorkspaceStatus | null;
  worktreeChangeCounts: Record<string, number>;
  fetching: boolean;
  pulling: boolean;
  pushing: boolean;
  creatingWorktree: boolean;
  pendingCreationBranch: string | null;
  updateState: UpdateState;
  /** Whether an AI agent command is configured (Settings → AI Agent) — gates the launch button/menu item. */
  agentConfigured: boolean;
  worktreesWithLiveAgent: Set<string>;
  /** Whether the sidebar is collapsed to a slim icon rail. */
  collapsed?: boolean;
  /** Toggles the collapsed state — wired to a toolbar button and Cmd/Ctrl+B. */
  onToggleCollapsed?: () => void;
  onWorktreeSwitch: (wt: WorktreeInfo) => void;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  onRefresh: () => void;
  onNewWorktree: () => void;
  onOpenTerminal: (cwd: string, label?: string) => void;
  onOpenHooksModal: () => void;
  onOpenRunHookModal: (wt: WorktreeInfo) => void;
  onRunCreateHooks: (wt: WorktreeInfo) => void;
  onDeleteWorktree: (wt: WorktreeInfo) => void;
  onLaunchAgent: (worktreePath: string) => void;
};

const iconBtn = 'inline-flex items-center justify-center p-1.5 bg-transparent border-none cursor-pointer text-(--sg-text-faint) rounded-[4px] transition-colors hover:text-(--sg-text) hover:bg-(--sg-surface-raised) disabled:opacity-40 disabled:cursor-not-allowed';

function isPersistentBranch(branch: string | null) {
  return /^(main|master|develop|release\/.+)$/.test(branch ?? '');
}

function tildify(p: string, home: string) {
  if (home && p.startsWith(home)) return '~' + p.slice(home.length);
  return p;
}

type InventoryRow = {
  wt: WorktreeInfo;
  typeLabel: 'Managed' | 'Persistent' | 'External';
  section: 'managed' | 'persistent' | 'external';
};

const PENDING_PATH = '__PENDING__';

export function WorktreeSidebar({
  workspacePath,
  worktrees,
  activeWorktree,
  workspaceStatus,
  worktreeChangeCounts,
  fetching,
  pulling,
  pushing,
  creatingWorktree,
  pendingCreationBranch,
  updateState,
  agentConfigured,
  worktreesWithLiveAgent,
  collapsed = false,
  onToggleCollapsed,
  onWorktreeSwitch,
  onFetch,
  onPull,
  onPush,
  onRefresh,
  onNewWorktree,
  onOpenTerminal,
  onOpenHooksModal,
  onOpenRunHookModal,
  onRunCreateHooks,
  onDeleteWorktree,
  onLaunchAgent,
}: Props) {
  const toast = useToast();
  const contextMenu = useContextMenu();
  const [homeDir, setHomeDir] = useState('');

  useEffect(() => {
    api.getHomeDir().then(setHomeDir).catch(() => {/* ignore */});
  }, []);

  function agentMenuItems(worktreePath: string) {
    if (!agentConfigured) return [];
    return [{
      label: 'Launch AI Agent',
      icon: <Bot size={14} />,
      onClick: () => onLaunchAgent(worktreePath),
    }];
  }

  const rootPath = workspaceStatus?.rootPath ?? '';
  const nonRootWorktrees = worktrees.filter(wt => wt.path !== rootPath);
  const underManaged = nonRootWorktrees.filter(wt => !wt.isExternal);
  const persistentWorktrees = underManaged.filter(wt => isPersistentBranch(wt.branch));
  const taskWorktrees = underManaged.filter(wt => !isPersistentBranch(wt.branch));
  const externalWorktrees = nonRootWorktrees.filter(wt => wt.isExternal);

  // Flat sorted inventory — managed → persistent → external, alpha within section
  const inventoryRows: InventoryRow[] = [];
  if (creatingWorktree && pendingCreationBranch && !taskWorktrees.some(wt => wt.branch === pendingCreationBranch)) {
    inventoryRows.push({ wt: { path: PENDING_PATH, branch: pendingCreationBranch, head: null, detached: false, isExternal: false }, typeLabel: 'Managed', section: 'managed' });
  }
  for (const wt of taskWorktrees) inventoryRows.push({ wt, typeLabel: 'Managed', section: 'managed' });
  for (const wt of persistentWorktrees) inventoryRows.push({ wt, typeLabel: 'Persistent', section: 'persistent' });
  for (const wt of externalWorktrees) inventoryRows.push({ wt, typeLabel: 'External', section: 'external' });
  const sectionRank: Record<string, number> = { managed: 0, persistent: 1, external: 2 };
  inventoryRows.sort((a, b) => {
    const s = sectionRank[a.section]! - sectionRank[b.section]!;
    if (s !== 0) return s;
    return (a.wt.branch ?? a.wt.path).localeCompare(b.wt.branch ?? b.wt.path);
  });

  // Show the active worktree summary only when the active worktree is not the root
  const activeIsRoot = !activeWorktree || activeWorktree.path === rootPath;
  const activeIsPersistent = activeWorktree ? isPersistentBranch(activeWorktree.branch) : false;
  const activeDirty = activeWorktree ? (worktreeChangeCounts[activeWorktree.path] ?? 0) : 0;

  // Slim icon rail shown when the sidebar is collapsed — keeps worktree
  // switching and re-expanding available without taking up horizontal space.
  const railContent = (
    <div className="flex h-full flex-col items-center gap-1 bg-(--sg-surface) py-2">
      <button
        className={iconBtn}
        title="Expand sidebar (Cmd/Ctrl+B)"
        aria-label="Expand sidebar"
        onClick={onToggleCollapsed}
        data-testid="btn-expand-sidebar"
      >
        <PanelLeftOpen size={15} />
      </button>
      <div className="my-1 h-px w-5 bg-(--sg-border)" />
      <button
        className={iconBtn}
        title="New worktree"
        aria-label="New worktree"
        onClick={onNewWorktree}
      >
        <Plus size={14} />
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto flex flex-col items-center gap-1 pt-1">
        {inventoryRows.filter(row => row.wt.path !== PENDING_PATH).map(row => {
          const isActive = activeWorktree?.path === row.wt.path;
          const label = row.wt.branch ?? (row.wt.detached ? 'detached' : row.wt.path.split('/').pop()) ?? row.wt.path;
          const changeCount = worktreeChangeCounts[row.wt.path] ?? 0;
          return (
            <button
              key={row.wt.path}
              className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-none cursor-pointer transition-colors ${isActive ? 'bg-(--sg-primary)/15 text-(--sg-primary)' : 'bg-transparent text-(--sg-text-faint) hover:bg-(--sg-surface-raised) hover:text-(--sg-text)'}`}
              title={label}
              aria-label={`Switch to ${label}`}
              data-testid="worktree-rail-item"
              data-path={row.wt.path}
              onClick={() => onWorktreeSwitch(row.wt)}
            >
              <GitBranch size={14} />
              {changeCount > 0 && (
                <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-(--sg-warning)" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <ResizableSidebar
      initialWidth={330}
      minWidth={200}
      maxWidth={480}
      className="border-r border-(--sg-border)"
      collapsible
      collapsed={collapsed}
      collapsedWidth={48}
      railContent={railContent}
    >
      <div className="flex flex-col h-full bg-(--sg-surface)">
        {/* Compact icon toolbar */}
        <div className="flex items-center gap-1.5 border-b border-(--sg-border-subtle) px-2.5 h-(--sg-toolbar-height) bg-(--sg-surface) shrink-0">
          {onToggleCollapsed && (
            <>
              <button
                className={iconBtn}
                title="Collapse sidebar (Cmd/Ctrl+B)"
                aria-label="Collapse sidebar"
                onClick={onToggleCollapsed}
                data-testid="btn-toggle-sidebar"
              >
                <PanelLeftClose size={15} />
              </button>
              <div className="mx-0.5 h-4 w-px bg-(--sg-border)" />
            </>
          )}
          <button
            className="flex items-center gap-1 rounded-lg bg-(--sg-primary) px-2.5 py-1 text-xs font-semibold text-white hover:bg-(--sg-primary-hover) border-none cursor-pointer"
            onClick={onNewWorktree}
            title="New worktree"
            data-testid="btn-open-create-worktree"
          >
            <Plus size={13} />
            <span>New</span>
          </button>
          <div className="mx-1 h-4 w-px bg-(--sg-border)" />
          <button className={iconBtn} title="Workspace hooks" onClick={onOpenHooksModal} data-testid="btn-open-hooks-modal">
            <Sliders size={15} />
          </button>
          <button className={iconBtn} title="Refresh" onClick={onRefresh}>
            <RefreshCw size={14} />
          </button>
          <button className={iconBtn} title="Fetch" onClick={onFetch} disabled={fetching || !activeWorktree} data-testid="btn-fetch-active-worktree">
            {fetching ? <Spinner size="sm" /> : <Download size={14} />}
          </button>
          <button className={iconBtn} title="Pull" onClick={onPull} disabled={pulling || !activeWorktree} data-testid="btn-pull-active-worktree">
            {pulling ? <Spinner size="sm" /> : <ArrowDownToLine size={14} />}
          </button>
          <button className={iconBtn} title="Push" onClick={onPush} disabled={pushing || !activeWorktree} data-testid="btn-push-active-worktree">
            {pushing ? <Spinner size="sm" /> : <ArrowUpFromLine size={14} />}
          </button>
        </div>

        {/* Active worktree summary */}
        {activeWorktree && !activeIsRoot && (
          <div className="relative shrink-0 border-b border-(--sg-border-subtle) bg-linear-to-b from-[color-mix(in_srgb,var(--sg-primary)_8%,transparent)] to-transparent px-3 py-2.5">
            {/* Left accent rail */}
            <span aria-hidden="true" className="absolute top-2.5 bottom-2.5 left-0 w-0.75 rounded-r-full bg-(--sg-primary)" />
            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-(--sg-primary)">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-(--sg-primary) opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-(--sg-primary)" />
                </span>
                Active
              </span>
              <span className="text-[9px] font-medium uppercase tracking-wider text-(--sg-text-faint)">
                · {activeIsPersistent ? 'Persistent' : 'Managed'}
              </span>
              <span className={`ml-auto text-[9px] font-medium ${activeDirty > 0 ? 'text-(--sg-warning)' : 'text-(--sg-text-faint)'}`}>
                {activeDirty > 0 ? `${activeDirty} change${activeDirty === 1 ? '' : 's'}` : 'Clean'}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <GitBranch size={14} className="shrink-0 text-(--sg-primary)" />
              <p className="truncate font-mono text-[13px] font-semibold text-(--sg-text)" title={activeWorktree.branch ?? ''}>
                {activeWorktree.branch ?? 'detached HEAD'}
              </p>
            </div>
            <p className="mt-0.5 truncate pl-5 text-[10px] text-(--sg-text-dim)" title={activeWorktree.path}>
              {tildify(activeWorktree.path, homeDir)}
            </p>
          </div>
        )}

        {/* Worktree list */}
        <div className="min-h-0 flex-1 overflow-y-auto" role="radiogroup" aria-label="Worktrees">
          {inventoryRows.length === 0 && !creatingWorktree && (
            <div className="m-3 rounded-lg border border-dashed border-(--sg-border) p-4 flex flex-col items-center gap-3 text-center">
              <div className="w-9 h-9 rounded-full bg-(--sg-surface-raised) flex items-center justify-center">
                <GitBranch size={18} className="text-(--sg-primary)" />
              </div>
              <div>
                <p className="text-xs font-semibold text-(--sg-text) m-0">No worktrees yet</p>
                <p className="text-[11px] text-(--sg-text-faint) mt-1 m-0 leading-relaxed">
                  Create a worktree for each branch you want to work on in parallel.
                </p>
              </div>
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-(--sg-primary) text-white text-xs font-medium hover:bg-(--sg-primary-hover) transition-colors cursor-pointer border-none"
                onClick={onNewWorktree}
              >
                <Plus size={12} /> Create first worktree
              </button>
            </div>
          )}
          {inventoryRows.map((row, idx) => {
            const isActive = activeWorktree?.path === row.wt.path;
            const isPending = row.wt.path === PENDING_PATH;
            const isRowBusy = isPending;
            const changeCount = worktreeChangeCounts[row.wt.path] ?? 0;

            return (
              <div
                key={row.wt.path}
                className={`sg-worktree-btn group flex items-center gap-2 px-3 py-2 transition-colors ${isPending ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-(--sg-surface-raised)'} ${idx > 0 ? 'border-t border-(--sg-border-subtle)' : ''}`}
                data-testid={isPending ? 'worktree-item-pending' : row.wt.isExternal ? 'worktree-item-external' : 'worktree-item'}
                data-branch={row.wt.branch ?? ''}
                data-path={row.wt.path}
                data-active={isActive ? 'true' : 'false'}
                role="radio"
                aria-checked={isActive}
                tabIndex={isActive ? 0 : -1}
                onClick={() => { if (!isPending) onWorktreeSwitch(row.wt); }}
                onKeyDown={e => { if (e.key === 'Enter' && !isPending) onWorktreeSwitch(row.wt); }}
                onContextMenu={e => {
                  if (isPending) return;
                  contextMenu.open(e, [
                    {
                      label: 'Open in Editor',
                      icon: <FolderPen size={14} />,
                      onClick: () => void api.openInEditor(row.wt.path)
                        .then(() => toast('Opened in editor', 'success'))
                        .catch((err: unknown) => toast(String(err), 'error')),
                    },
                    {
                      label: /mac/i.test(navigator.platform) ? 'Reveal in Finder' : 'Reveal in Explorer',
                      icon: <FolderSearch size={14} />,
                      onClick: () => void api.revealInFinder(row.wt.path)
                        .catch((err: unknown) => toast(String(err), 'error')),
                    },
                    {
                      label: 'Open Terminal Here',
                      icon: <SquareTerminal size={14} />,
                      onClick: () => onOpenTerminal(row.wt.path, row.wt.branch ?? row.wt.path.split('/').pop()),
                    },
                    ...(agentMenuItems(row.wt.path).length > 0 ? ['separator' as const, ...agentMenuItems(row.wt.path)] : []),
                    'separator',
                    { label: 'Fetch', icon: <RefreshCw size={14} />, onClick: () => void api.fetch(row.wt.path).then((summary) => {
                      toast(describeFetchSummary(summary), summary.hadNoRemotes ? 'info' : 'success');
                      // Nothing to refresh when there was nothing to fetch (no remotes) or
                      // nothing changed — matches useFetch's no-op check in queries.ts, avoiding
                      // a pointless refetch on every click of a no-op fetch.
                      if (summary.hadNoRemotes || (summary.updatedRefCount === 0 && summary.prunedRefCount === 0)) return;
                      onRefresh();
                    }).catch((err: unknown) => toast(`Fetch failed: ${String(err)}`, 'error')) },
                    { label: 'Pull', icon: <ArrowDownToLine size={14} />, onClick: () => void api.pull(row.wt.path).then(() => { toast('Pulled', 'success'); onRefresh(); }).catch((err: unknown) => toast(String(err), 'error')) },
                    { label: 'Push', icon: <ArrowUpFromLine size={14} />, onClick: () => void api.push(row.wt.path).then(() => { toast('Pushed', 'success'); }).catch((err: unknown) => toast(String(err), 'error')) },
                    'separator',
                    { label: 'Run Hook…', icon: <Play size={14} />, onClick: () => onOpenRunHookModal(row.wt) },
                    ...(row.wt.isExternal
                      ? [{ label: 'Run Create Hooks…', icon: <Rocket size={14} />, onClick: () => onRunCreateHooks(row.wt) }]
                      : []),
                    'separator',
                    { label: 'Copy Branch Name', icon: <Copy size={14} />, onClick: () => void navigator.clipboard.writeText(row.wt.branch ?? '') },
                    { label: 'Copy Path', icon: <CopyPlus size={14} />, onClick: () => void navigator.clipboard.writeText(row.wt.path) },
                    'separator',
                    { label: 'Remove Worktree', icon: <Trash2 size={14} />, danger: true, onClick: () => onDeleteWorktree(row.wt) },
                  ]);
                }}
              >
                {/* Faux radio indicator */}
                <span
                  aria-hidden="true"
                  className={`relative mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors ${isRowBusy ? 'border-transparent' : isActive ? 'border-(--sg-primary)' : 'border-(--sg-border) group-hover:border-(--sg-primary)/60'}`}
                >
                  {isRowBusy ? (
                    <svg className="h-3.5 w-3.5 text-(--sg-primary) animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  ) : isActive ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-(--sg-primary)" />
                  ) : null}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {row.wt.isExternal && (
                      <Link2 size={11} className="shrink-0 text-(--sg-text-faint)" aria-hidden="true" />
                    )}
                    <p className={`sg-worktree-label truncate text-xs font-semibold ${isActive ? 'text-(--sg-primary)' : 'text-(--sg-text)'}`}>
                      {row.wt.branch ?? (row.wt.detached ? 'detached' : row.wt.path.split('/').pop())}
                    </p>
                    <span className="shrink-0 rounded-full border border-(--sg-border) px-1.5 py-0 text-[9px] leading-4 text-(--sg-text-dim)">
                      {row.typeLabel}
                    </span>
                    {changeCount > 0 && (
                      <span className="shrink-0 rounded-full bg-(--sg-warning)/20 px-1.5 py-0 text-[9px] leading-4 font-semibold text-(--sg-warning)">
                        {changeCount}
                      </span>
                    )}
                    {worktreesWithLiveAgent.has(row.wt.path) && (
                      <span
                        className="sg-agent-badge flex shrink-0 items-center justify-center rounded-full bg-(--sg-primary)/15 p-0.5 text-(--sg-primary)"
                        data-testid="agent-badge"
                        title="Agent running"
                      >
                        <Bot size={10} />
                      </span>
                    )}
                  </div>
                  <p className="truncate text-[10px] text-(--sg-text-dim)">
                    {isPending ? '' : tildify(row.wt.path, homeDir)}
                  </p>
                </div>

                {/* Action buttons (shown on hover / when active) */}
                <div className={`flex shrink-0 items-center gap-0.5 transition-opacity ${isRowBusy ? 'pointer-events-none opacity-0' : 'opacity-0 group-hover:opacity-100'} ${isActive && !isRowBusy ? 'opacity-100' : ''}`}>
                  {agentConfigured && (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onLaunchAgent(row.wt.path); }}
                      className="sg-launch-agent-btn rounded p-1 text-(--sg-text-dim) hover:bg-(--sg-surface) hover:text-(--sg-primary) border-none cursor-pointer bg-transparent"
                      title="Launch AI Agent"
                      aria-label="Launch AI Agent"
                      data-testid="btn-launch-agent"
                    >
                      <Bot size={13} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      contextMenu.open(e, [
                        { label: 'Open in Editor', icon: <FolderPen size={14} />, onClick: () => void api.openInEditor(row.wt.path).then(() => toast('Opened in editor', 'success')).catch((err: unknown) => toast(String(err), 'error')) },
                        { label: /mac/i.test(navigator.platform) ? 'Reveal in Finder' : 'Reveal in Explorer', icon: <FolderSearch size={14} />, onClick: () => void api.revealInFinder(row.wt.path).catch((err: unknown) => toast(String(err), 'error')) },
                        { label: 'Open Terminal Here', icon: <SquareTerminal size={14} />, onClick: () => onOpenTerminal(row.wt.path, row.wt.branch ?? row.wt.path.split('/').pop()) },
                        ...(agentMenuItems(row.wt.path).length > 0 ? ['separator' as const, ...agentMenuItems(row.wt.path)] : []),
                        'separator',
                        { label: 'Run Hook…', icon: <Play size={14} />, onClick: () => onOpenRunHookModal(row.wt) },
                        ...(row.wt.isExternal
                          ? [{ label: 'Run Create Hooks…', icon: <Rocket size={14} />, onClick: () => onRunCreateHooks(row.wt) }]
                          : []),
                        'separator',
                        { label: 'Copy Branch Name', icon: <Copy size={14} />, onClick: () => void navigator.clipboard.writeText(row.wt.branch ?? '') },
                        { label: 'Copy Path', icon: <CopyPlus size={14} />, onClick: () => void navigator.clipboard.writeText(row.wt.path) },
                      ]);
                    }}
                    className="rounded p-1 text-(--sg-text-dim) hover:bg-(--sg-surface) hover:text-(--sg-text) border-none cursor-pointer bg-transparent"
                    title="Worktree actions"
                    aria-label="Worktree actions"
                  >
                    <MoreHorizontal size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onDeleteWorktree(row.wt); }}
                    className="rounded p-1 text-(--sg-text-dim) hover:bg-(--sg-surface) hover:text-(--sg-danger) border-none cursor-pointer bg-transparent"
                    title="Delete worktree"
                    aria-label="Delete worktree"
                    data-testid="btn-delete-worktree"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Update badge */}
        {updateState.status !== 'idle' && updateState.status !== 'up-to-date' && (
          <div className="px-3 py-2 shrink-0">
            <UpdateBadge
              state={updateState}
              onInstall={() => void api.installUpdate()}
            />
          </div>
        )}
      </div>
    </ResizableSidebar>
  );
}
