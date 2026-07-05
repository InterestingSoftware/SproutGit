import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  WorkspaceHook,
  WorkspaceHookTrigger,
  WorkspaceHookShell,
  HookExecutionTarget,
  WorkspaceHookScope,
  HookListResult,
  HookUpsertInput,
} from '@sproutgit/types';
import { Spinner } from './Spinner.js';
import { Select } from './Select.js';
import { MonacoEditor } from './MonacoEditor.js';
import { X, Trash2, Plus, Circle, CircleDot, Clock3, TerminalSquare, ShieldAlert, GitBranch, ShieldCheck, Lock } from 'lucide-react';

const TRIGGER_OPTIONS: { value: WorkspaceHookTrigger; label: string }[] = [
  { value: 'before_worktree_create', label: 'Before worktree create' },
  { value: 'after_worktree_create', label: 'After worktree create' },
  { value: 'before_worktree_remove', label: 'Before worktree remove' },
  { value: 'after_worktree_remove', label: 'After worktree remove' },
  { value: 'before_worktree_switch', label: 'Before worktree switch' },
  { value: 'after_worktree_switch', label: 'After worktree switch' },
  { value: 'manual', label: 'Manual' },
];

function defaultScript(shell: WorkspaceHookShell): string {
  if (shell === 'pwsh' || shell === 'powershell') {
    return `# Workspace: $env:SPROUTGIT_WORKSPACE\n# Worktree:  $env:SPROUTGIT_WORKTREE\n# Trigger:   $env:SPROUTGIT_TRIGGER\n`;
  }
  return `#!/usr/bin/env ${shell === 'zsh' ? 'zsh' : 'bash'}\n# Workspace: $SPROUTGIT_WORKSPACE\n# Worktree:  $SPROUTGIT_WORKTREE\n# Trigger:   $SPROUTGIT_TRIGGER\n`;
}

function shellFromPath(path?: string): WorkspaceHookShell {
  if (!path) return 'bash';
  const lower = path.toLowerCase();
  if (lower.includes('pwsh')) return 'pwsh';
  if (lower.includes('powershell')) return 'powershell';
  if (lower.includes('zsh')) return 'zsh';
  if (lower.includes('bash')) return 'bash';
  return 'bash';
}

const EXECUTION_TARGET_OPTIONS: Array<{ value: HookExecutionTarget; label: string }> = [
  { value: 'trigger_worktree', label: 'Trigger worktree' },
  { value: 'initiating_worktree', label: 'Initiating worktree' },
  { value: 'workspace', label: 'Workspace root' },
];

const SCOPE_OPTIONS: Array<{ value: WorkspaceHookScope; label: string }> = [
  { value: 'worktree', label: 'Worktree' },
  { value: 'workspace', label: 'Workspace' },
];

const RUNTIME_VARIABLE_GROUPS: { label: string; vars: string[] }[] = [
  {
    label: 'Workspace',
    vars: [
      '$SPROUTGIT_WORKSPACE',
      '$SPROUTGIT_WORKSPACE_NAME',
      '$SPROUTGIT_ROOT_PATH',
      '$SPROUTGIT_WORKTREES_PATH',
    ],
  },
  {
    label: 'Worktree',
    vars: [
      '$SPROUTGIT_WORKTREE',
      '$SPROUTGIT_WORKTREE_NAME',
      '$SPROUTGIT_WORKTREE_BRANCH',
      '$SPROUTGIT_SOURCE_REF',
    ],
  },
  {
    label: 'Trigger',
    vars: [
      '$SPROUTGIT_TRIGGER',
      '$SPROUTGIT_INITIATING_WORKTREE',
    ],
  },
  {
    label: 'Hook',
    vars: [
      '$SPROUTGIT_HOOK_ID',
      '$SPROUTGIT_HOOK_NAME',
      '$SPROUTGIT_HOOK_SCOPE',
      '$SPROUTGIT_HOOK_SHELL',
      '$SPROUTGIT_HOOK_CRITICAL',
      '$SPROUTGIT_HOOK_TIMEOUT_SECONDS',
    ],
  },
  {
    label: 'System',
    vars: ['$SPROUTGIT_OS'],
  },
];

type HookApi = {
  listHooks: (workspacePath: string, worktreePath: string | null) => Promise<HookListResult>;
  createHook: (args: { workspacePath: string } & HookUpsertInput) => Promise<void>;
  updateHook: (args: { workspacePath: string; id: string } & Partial<HookUpsertInput>) => Promise<void>;
  deleteHook: (workspacePath: string, id: string) => Promise<void>;
  toggleHook: (workspacePath: string, id: string, enabled: boolean) => Promise<void>;
  /** Trusts one repo-sourced hook by id so it's eligible to execute. No-op for local hooks (always trusted). */
  trustHook: (worktreePath: string, hookId: string) => Promise<void>;
};

type Props = {
  open: boolean;
  workspacePath: string;
  /** The worktree whose `sproutgit.hooks.json` (if any) should be shown alongside local hooks. Repo hooks are omitted entirely when this is null. */
  worktreePath: string | null;
  api: HookApi;
  onClose: () => void;
  defaultShell?: string;
};

type Draft = {
  name: string;
  scope: WorkspaceHookScope;
  trigger: WorkspaceHookTrigger;
  shell: WorkspaceHookShell;
  executionTarget: HookExecutionTarget;
  dependsOn: string[];
  script: string;
  enabled: boolean;
  critical: boolean;
  switchOncePerSession: boolean;
  switchRunOnCreate: boolean;
  switchRunOnDelete: boolean;
  keepOpenOnCompletion: boolean;
  timeoutSeconds: number;
};

const defaultDraft = (shell: WorkspaceHookShell = 'bash'): Draft => ({
  name: '',
  scope: 'worktree',
  trigger: 'after_worktree_create',
  shell,
  executionTarget: 'trigger_worktree',
  script: defaultScript(shell),
  enabled: true,
  critical: false,
  switchOncePerSession: false,
  switchRunOnCreate: true,
  switchRunOnDelete: false,
  keepOpenOnCompletion: false,
  timeoutSeconds: 60,
  dependsOn: [],
});

function draftFromHook(hook: WorkspaceHook): Draft {
  return {
    name: hook.name,
    scope: hook.scope,
    trigger: hook.trigger,
    shell: hook.shell,
    executionTarget: hook.executionTarget,
    script: hook.script,
    enabled: hook.enabled,
    critical: hook.critical,
    switchOncePerSession: hook.switchOncePerSession ?? false,
    switchRunOnCreate: hook.switchRunOnCreate ?? true,
    switchRunOnDelete: hook.switchRunOnDelete ?? false,
    keepOpenOnCompletion: hook.keepOpenOnCompletion ?? false,
    timeoutSeconds: hook.timeoutSeconds ?? 60,
    dependsOn: hook.dependsOn ?? [],
  };
}

function isSwitchTrigger(trigger: WorkspaceHookTrigger): boolean {
  return trigger === 'before_worktree_switch' || trigger === 'after_worktree_switch';
}

function triggerLabel(trigger: WorkspaceHookTrigger): string {
  return TRIGGER_OPTIONS.find(option => option.value === trigger)?.label ?? trigger;
}

function executionTargetLabel(target: HookExecutionTarget): string {
  return EXECUTION_TARGET_OPTIONS.find(option => option.value === target)?.label ?? target;
}

export function WorkspaceHooksModal({ open, workspacePath, worktreePath, api, onClose, defaultShell }: Props) {
  const [hooks, setHooks] = useState<WorkspaceHook[]>([]);
  const [repoFileError, setRepoFileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ hook: WorkspaceHook; draft: Draft } | null>(null);
  const [creating, setCreating] = useState<Draft | null>(null);
  const [viewingRepoHook, setViewingRepoHook] = useState<WorkspaceHook | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [trusting, setTrusting] = useState(false);

  const refreshHooks = useCallback(async (): Promise<WorkspaceHook[]> => {
    setLoading(true);
    try {
      const result = await api.listHooks(workspacePath, worktreePath);
      setHooks(result.hooks);
      setRepoFileError(result.repoFileError);
      return result.hooks;
    } finally {
      setLoading(false);
    }
  }, [workspacePath, worktreePath, api]);

  useEffect(() => {
    if (!open) return;
    void refreshHooks();
  }, [open, refreshHooks]);

  const untrustedRepoHooks = useMemo(() => hooks.filter(h => h.source === 'repo' && !h.trusted), [hooks]);

  async function handleTrustHook(hookId: string) {
    if (!worktreePath) return;
    setTrusting(true);
    try {
      await api.trustHook(worktreePath, hookId);
      await refreshHooks();
    } finally {
      setTrusting(false);
    }
  }

  async function handleTrustAll() {
    if (!worktreePath) return;
    setTrusting(true);
    try {
      for (const hook of untrustedRepoHooks) {
        await api.trustHook(worktreePath, hook.id);
      }
      await refreshHooks();
    } finally {
      setTrusting(false);
    }
  }

  const groupedHooks = useMemo(() => {
    const map = new Map<WorkspaceHookTrigger, WorkspaceHook[]>();
    for (const trigger of TRIGGER_OPTIONS) map.set(trigger.value, []);
    for (const hook of hooks) {
      const list = map.get(hook.trigger);
      if (list) list.push(hook);
    }
    return map;
  }, [hooks]);

  if (!open) return null;

  /** Persists the current draft (create or edit) if the name is non-empty. */
  async function saveDraftIfNeeded(): Promise<void> {
    if (creating && creating.name.trim()) {
      await api.createHook({
        workspacePath,
        name: creating.name,
        scope: creating.scope,
        trigger: creating.trigger,
        shell: creating.shell,
        executionTarget: creating.executionTarget,
        script: creating.script,
        enabled: creating.enabled,
        critical: creating.critical,
        switchOncePerSession: creating.switchOncePerSession,
        switchRunOnCreate: creating.switchRunOnCreate,
        switchRunOnDelete: creating.switchRunOnDelete,
        keepOpenOnCompletion: creating.keepOpenOnCompletion,
        timeoutSeconds: creating.timeoutSeconds,
        dependsOn: creating.dependsOn,
      });
    } else if (editing && editing.draft.name.trim()) {
      await api.updateHook({
        workspacePath,
        id: editing.hook.id,
        name: editing.draft.name,
        scope: editing.draft.scope,
        trigger: editing.draft.trigger,
        executionTarget: editing.draft.executionTarget,
        shell: editing.draft.shell,
        script: editing.draft.script,
        enabled: editing.draft.enabled,
        critical: editing.draft.critical,
        switchOncePerSession: editing.draft.switchOncePerSession,
        switchRunOnCreate: editing.draft.switchRunOnCreate,
        switchRunOnDelete: editing.draft.switchRunOnDelete,
        keepOpenOnCompletion: editing.draft.keepOpenOnCompletion,
        timeoutSeconds: editing.draft.timeoutSeconds,
        dependsOn: editing.draft.dependsOn,
      });
    }
  }

  /** Auto-saves the current draft, then closes the modal. */
  async function handleClose() {
    setSavingDraft(true);
    setSaveError(null);
    try {
      await saveDraftIfNeeded();
      onClose();
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSavingDraft(false);
    }
  }

  /** Auto-saves the current draft, then switches to the given hook. Repo hooks are read-only, so they open a view-only panel instead of the draft editor. */
  async function selectHookItem(hook: WorkspaceHook) {
    if (hook.source === 'repo') {
      setSavingDraft(true);
      setSaveError(null);
      try {
        await saveDraftIfNeeded();
        // saveDraftIfNeeded() may have just created/updated a local hook —
        // refresh so the list and any trust badges reflect that immediately,
        // matching the local-hook branch below.
        await refreshHooks();
        setCreating(null);
        setEditing(null);
        setViewingRepoHook(hook);
      } catch (err) {
        setSaveError(String(err));
      } finally {
        setSavingDraft(false);
      }
      return;
    }

    setSavingDraft(true);
    setSaveError(null);
    try {
      await saveDraftIfNeeded();
      const updated = await refreshHooks();
      setCreating(null);
      setViewingRepoHook(null);
      const fresh = updated.find(h => h.id === hook.id) ?? hook;
      setEditing({ hook: fresh, draft: draftFromHook(fresh) });
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSavingDraft(false);
    }
  }

  /** Auto-saves the current draft, then opens the new-hook form. */
  async function handleNewHook() {
    setSavingDraft(true);
    setSaveError(null);
    try {
      await saveDraftIfNeeded();
      await refreshHooks().catch(() => hooks);
      setEditing(null);
      setViewingRepoHook(null);
      setCreating(defaultDraft(shellFromPath(defaultShell)));
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSavingDraft(false);
    }
  }

  async function toggleHook(hook: WorkspaceHook) {
    await api.toggleHook(workspacePath, hook.id, !hook.enabled);
    const updated = await refreshHooks();
    // Keep the editor draft in sync with the toggled state.
    if (editing?.hook.id === hook.id) {
      const fresh = updated.find(h => h.id === hook.id);
      setEditing(e => e && fresh ? { hook: fresh, draft: { ...e.draft, enabled: fresh.enabled } } : e);
    }
  }

  async function deleteHook(id: string) {
    await api.deleteHook(workspacePath, id);
    await refreshHooks();
    if (editing?.hook.id === id) setEditing(null);
  }

  const activeDraft = creating ?? editing?.draft ?? null;

  function updateDraft(patch: Partial<Draft>) {
    if (creating) setCreating(d => d ? { ...d, ...patch } : null);
    else if (editing) setEditing(e => e ? { ...e, draft: { ...e.draft, ...patch } } : null);
  }

  const shellOptions: { value: WorkspaceHookShell; label: string }[] = [
    { value: 'bash', label: 'bash' },
    { value: 'zsh', label: 'zsh' },
    { value: 'pwsh', label: 'pwsh' },
    { value: 'powershell', label: 'powershell' },
  ];

  const secondaryBtn = 'inline-flex items-center gap-[5px] px-3 py-[5px] rounded-[6px] cursor-pointer text-xs font-medium transition-colors whitespace-nowrap bg-transparent border border-(--sg-border) text-(--sg-text-dim) hover:bg-(--sg-surface-raised) disabled:opacity-50 disabled:cursor-not-allowed';
  const iconBtn = 'inline-flex items-center justify-center p-[3px] bg-transparent border-none cursor-pointer text-(--sg-text-faint) rounded-[4px] transition-colors hover:text-(--sg-text) hover:bg-(--sg-surface-raised)';
  const fieldLabel = 'text-[11px] font-semibold text-(--sg-text-dim) uppercase tracking-[0.04em]';
  const fieldInput = 'w-full px-[10px] py-[6px] bg-(--sg-input-bg) border border-(--sg-input-border) rounded-[6px] text-xs text-(--sg-text) outline-none focus:border-(--sg-input-focus)';
  const sectionCard = 'rounded-lg border border-(--sg-border-subtle) bg-(--sg-surface-subtle) p-3 flex flex-col gap-2';

  return (
    <div className="fixed inset-0 z-200 bg-black/45 flex items-center justify-center" onClick={() => void handleClose()}>
      <div
        className="bg-(--sg-surface) border border-(--sg-border) rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.25)] flex flex-col overflow-hidden"
        style={{ minWidth: 560, maxWidth: 1100, width: '92vw', maxHeight: '88vh' }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label="Manage hooks"
      >
        <div className="px-5 py-4 border-b border-(--sg-border) shrink-0 bg-linear-to-r from-[rgba(25,172,92,0.12)] to-transparent">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-semibold m-0 text-(--sg-text)">Workspace Hooks</h2>
              <p className="m-0 mt-1 text-xs text-(--sg-text-dim)">
                Configure lifecycle automation for create, switch, remove, and manual operations.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                className={secondaryBtn}
                disabled={savingDraft}
                onClick={() => void handleNewHook()}
              >
                <Plus size={12} /> New hook
              </button>
              <button className={iconBtn} disabled={savingDraft} onClick={() => void handleClose()}>
                <X size={14} />
              </button>
            </div>
          </div>
        </div>

        {repoFileError && (
          <div className="mx-4 mt-3 rounded-lg border border-(--sg-danger) bg-[rgba(220,38,38,0.08)] px-3 py-2 flex items-center gap-2 shrink-0">
            <ShieldAlert size={14} className="text-(--sg-danger) shrink-0" />
            <p className="m-0 text-xs text-(--sg-text)">Couldn't read this worktree's <code>sproutgit.hooks.json</code>: {repoFileError}</p>
          </div>
        )}
        {untrustedRepoHooks.length > 0 && (
          <div className="mx-4 mt-3 rounded-lg border border-(--sg-border) bg-[rgba(217,119,6,0.1)] px-3 py-2 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <Lock size={14} className="text-(--sg-text-dim) shrink-0" />
              <p className="m-0 text-xs text-(--sg-text)">
                {untrustedRepoHooks.length} hook{untrustedRepoHooks.length === 1 ? '' : 's'} from <code>sproutgit.hooks.json</code> {untrustedRepoHooks.length === 1 ? "hasn't" : "haven't"} been trusted yet. They came in via git, so they won't run until approved — individually below, or all at once here.
              </p>
            </div>
            <button
              className={secondaryBtn}
              disabled={trusting}
              onClick={() => void handleTrustAll()}
            >
              <ShieldCheck size={12} /> Trust all {untrustedRepoHooks.length}
            </button>
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          <div className="w-[260px] shrink-0 border-r border-(--sg-border) overflow-y-auto flex flex-col p-3 gap-3">
            {loading && <div className="p-3"><Spinner /></div>}
            {!loading && hooks.length === 0 && (
              <div className="rounded-lg border border-dashed border-(--sg-border) p-3">
                <p className="text-xs text-(--sg-text-faint) m-0">No hooks yet. Create your first hook to automate workspace actions.</p>
              </div>
            )}
            {!loading && TRIGGER_OPTIONS.map(section => {
              const sectionHooks = groupedHooks.get(section.value) ?? [];
              if (sectionHooks.length === 0) return null;

              return (
                <div key={section.value} className="flex flex-col gap-1.5">
                  <div className="px-1 text-[10px] font-semibold tracking-[0.08em] uppercase text-(--sg-text-faint)">
                    {section.label}
                  </div>
                  {sectionHooks.map(hook => {
                    const isRepoHook = hook.source === 'repo';
                    const isSelected = isRepoHook ? viewingRepoHook?.id === hook.id : editing?.hook.id === hook.id;
                    return (
                    <div
                      key={hook.id}
                      className={`rounded-lg border px-3 py-2 cursor-pointer text-xs transition-colors ${isSelected ? 'border-(--sg-primary) bg-[rgba(25,172,92,0.1)]' : 'border-(--sg-border-subtle) bg-(--sg-surface) hover:bg-(--sg-surface-raised)'}`}
                      onClick={() => void selectHookItem(hook)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-(--sg-text) truncate flex items-center gap-1.5">
                            {hook.name}
                            {isRepoHook && (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full text-[9px] font-semibold uppercase tracking-wide bg-(--sg-surface-raised) text-(--sg-text-dim) border border-(--sg-border-subtle)"
                                title={hook.trusted ? 'Defined in sproutgit.hooks.json' : 'Defined in sproutgit.hooks.json — not yet trusted'}
                              >
                                <GitBranch size={9} /> repo
                                {!hook.trusted && <Lock size={9} />}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-[10px] text-(--sg-text-faint) flex items-center gap-1.5">
                            <TerminalSquare size={10} />
                            <span>{hook.shell}</span>
                            <span>•</span>
                            <span>{executionTargetLabel(hook.executionTarget)}</span>
                          </div>
                        </div>
                        {isRepoHook ? (
                          <div className="shrink-0 text-(--sg-text-faint)" title="Read-only — edit sproutgit.hooks.json to change this hook">
                            <Lock size={12} />
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                            <button
                              className={iconBtn}
                              onClick={() => void toggleHook(hook)}
                              title={hook.enabled ? 'Disable' : 'Enable'}
                            >
                              {hook.enabled ? <CircleDot size={12} /> : <Circle size={12} />}
                            </button>
                            <button
                              className="inline-flex items-center justify-center p-[3px] bg-transparent border-none cursor-pointer text-(--sg-danger) rounded-[4px] hover:bg-(--sg-surface-raised)"
                              onClick={() => void deleteHook(hook.id)}
                              title="Delete hook"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {!activeDraft && viewingRepoHook && (
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              <div className={sectionCard}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-(--sg-text) flex items-center gap-1.5">
                    <GitBranch size={12} /> {viewingRepoHook.name}
                  </div>
                  <div className="text-[10px] text-(--sg-text-faint)">{triggerLabel(viewingRepoHook.trigger)}</div>
                </div>
                <p className="m-0 text-[11px] text-(--sg-text-dim)">
                  Defined in this worktree's <code>sproutgit.hooks.json</code> — read-only here. Edit that file and commit the change to modify it.
                </p>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-(--sg-text-dim)">
                  <div><span className={fieldLabel}>Execution target</span><div>{executionTargetLabel(viewingRepoHook.executionTarget)}</div></div>
                  <div><span className={fieldLabel}>Shell</span><div>{viewingRepoHook.shell}</div></div>
                  <div><span className={fieldLabel}>Timeout</span><div>{viewingRepoHook.timeoutSeconds}s</div></div>
                  <div><span className={fieldLabel}>Critical</span><div>{viewingRepoHook.critical ? 'Yes' : 'No'}</div></div>
                </div>
                {!viewingRepoHook.trusted && (
                  <div className="rounded-md border border-(--sg-border) bg-[rgba(217,119,6,0.1)] px-2.5 py-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[11px] text-(--sg-text)">
                      <Lock size={12} /> Not trusted — won't run until approved.
                    </div>
                    <button className={secondaryBtn} disabled={trusting} onClick={() => void handleTrustHook(viewingRepoHook.id)}>
                      <ShieldCheck size={12} /> Trust this hook
                    </button>
                  </div>
                )}
              </div>
              <div className={sectionCard}>
                <div className="text-xs font-semibold text-(--sg-text)">Script</div>
                <MonacoEditor
                  value={viewingRepoHook.script}
                  language={viewingRepoHook.shell === 'pwsh' || viewingRepoHook.shell === 'powershell' ? 'powershell' : 'shell'}
                  height="300px"
                  readOnly
                  onChange={() => {}}
                />
              </div>
            </div>
          )}

          {activeDraft && (
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              <div className={sectionCard}>
                <div className="text-xs font-semibold text-(--sg-text)">Identity</div>
                <div className="flex flex-col gap-1">
                  <label className={fieldLabel}>Name</label>
                  <input
                    className={fieldInput}
                    value={activeDraft.name}
                    onChange={e => updateDraft({ name: e.target.value })}
                    placeholder="e.g. Install dependencies"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className={fieldLabel}>Scope</label>
                  <Select
                    value={activeDraft.scope}
                    options={SCOPE_OPTIONS}
                    onChange={value => updateDraft({ scope: value })}
                  />
                </div>
              </div>

              <div className={sectionCard}>
                <div className="text-xs font-semibold text-(--sg-text)">When and where</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className={fieldLabel}>Trigger</label>
                    <Select
                      value={activeDraft.trigger}
                      options={TRIGGER_OPTIONS}
                      onChange={value => updateDraft({ trigger: value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className={fieldLabel}>Execution target</label>
                    <Select
                      value={activeDraft.executionTarget}
                      options={EXECUTION_TARGET_OPTIONS}
                      onChange={value => updateDraft({ executionTarget: value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className={fieldLabel}>Shell</label>
                    <Select
                      value={activeDraft.shell}
                      options={shellOptions}
                      onChange={value => updateDraft({ shell: value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className={fieldLabel}>Timeout (seconds)</label>
                    <div className="relative">
                      <Clock3 className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--sg-text-faint)" size={12} />
                      <input
                        className={`${fieldInput} pl-7`}
                        type="number"
                        min={1}
                        max={3600}
                        value={activeDraft.timeoutSeconds}
                        onChange={e => updateDraft({ timeoutSeconds: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className={sectionCard}>
                <div className="text-xs font-semibold text-(--sg-text)">Behavior</div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-(--sg-text-dim) cursor-pointer">
                    <input
                      type="checkbox"
                      checked={activeDraft.enabled}
                      onChange={e => updateDraft({ enabled: e.target.checked })}
                    />
                    Enabled
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-(--sg-text-dim) cursor-pointer">
                    <input
                      type="checkbox"
                      checked={activeDraft.keepOpenOnCompletion}
                      onChange={e => updateDraft({ keepOpenOnCompletion: e.target.checked })}
                    />
                    Keep terminal open on completion
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-(--sg-text-dim) cursor-pointer col-span-2">
                    <input
                      type="checkbox"
                      checked={activeDraft.critical}
                      onChange={e => updateDraft({ critical: e.target.checked })}
                    />
                    <ShieldAlert size={12} />
                    Critical hook (operation fails if this hook fails)
                  </label>
                </div>
                {isSwitchTrigger(activeDraft.trigger) && (
                  <div className="mt-1 grid grid-cols-1 gap-2 border-t border-(--sg-border-subtle) pt-2">
                    <label className="flex items-center gap-1.5 text-xs text-(--sg-text-dim) cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeDraft.switchOncePerSession}
                        onChange={e => updateDraft({ switchOncePerSession: e.target.checked })}
                      />
                      Run once per session
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-(--sg-text-dim) cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeDraft.switchRunOnCreate}
                        onChange={e => updateDraft({ switchRunOnCreate: e.target.checked })}
                      />
                      Run on create operations
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-(--sg-text-dim) cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeDraft.switchRunOnDelete}
                        onChange={e => updateDraft({ switchRunOnDelete: e.target.checked })}
                      />
                      Run on delete operations
                    </label>
                  </div>
                )}
              </div>

              {(() => {
                // Only other local hooks are valid dependencies — dependsOn is
                // validated against hooks in the *same* file (local-hooks.json
                // vs sproutgit.hooks.json are parsed independently).
                const sameTriggerHooks = hooks.filter(h =>
                  h.source === 'local' &&
                  h.trigger === activeDraft.trigger &&
                  h.id !== (editing?.hook.id ?? ''),
                );
                if (sameTriggerHooks.length === 0) return null;
                return (
                  <div className={sectionCard}>
                    <div className="text-xs font-semibold text-(--sg-text)">Run after</div>
                    <p className="text-[11px] text-(--sg-text-faint) m-0">
                      This hook will wait for the selected hooks to complete first.
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {sameTriggerHooks.map(h => (
                        <label key={h.id} className="flex items-center gap-2 text-xs text-(--sg-text-dim) cursor-pointer">
                          <input
                            type="checkbox"
                            checked={activeDraft.dependsOn.includes(h.name)}
                            onChange={e => {
                              const next = e.target.checked
                                ? [...activeDraft.dependsOn, h.name]
                                : activeDraft.dependsOn.filter(name => name !== h.name);
                              updateDraft({ dependsOn: next });
                            }}
                          />
                          <span className="truncate">{h.name}</span>
                          <span className="text-[10px] text-(--sg-text-faint) shrink-0">{h.shell}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div className={sectionCard}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-(--sg-text)">Script</div>
                  <div className="text-[10px] text-(--sg-text-faint)">{triggerLabel(activeDraft.trigger)}</div>
                </div>
                <MonacoEditor
                  value={activeDraft.script}
                  language={activeDraft.shell === 'pwsh' || activeDraft.shell === 'powershell' ? 'powershell' : 'shell'}
                  height="300px"
                  onChange={next => updateDraft({ script: next })}
                />
                <div className="rounded-md border border-(--sg-border-subtle) bg-(--sg-surface) px-2 py-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-(--sg-text-faint)">
                    Runtime variables
                  </div>
                  <div className="mt-1.5 flex flex-col gap-2">
                    {RUNTIME_VARIABLE_GROUPS.map(group => (
                      <div key={group.label}>
                        <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-(--sg-text-faint) mb-1">
                          {group.label}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {group.vars.map(variable => (
                            <span key={variable} className="text-[10px] px-1.5 py-0.5 rounded bg-(--sg-surface-raised) text-(--sg-text-dim) font-mono">
                              {variable}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {saveError && (
                <div className="flex items-center justify-between gap-2 rounded-md border border-(--sg-danger)/30 bg-(--sg-danger)/10 px-3 py-2">
                  <p className="text-[11px] text-(--sg-danger) m-0">{saveError}</p>
                  <button className={iconBtn} onClick={() => setSaveError(null)}><X size={12} /></button>
                </div>
              )}
              {!activeDraft.name.trim() && (
                <p className="text-[11px] text-(--sg-text-faint) m-0 text-right">
                  Add a name above to save this hook.
                </p>
              )}
            </div>
          )}

          {!activeDraft && !viewingRepoHook && (
            <div className="flex-1 p-6 text-xs text-(--sg-text-faint) flex items-center justify-center">
              Select a hook from the left or create a new one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
