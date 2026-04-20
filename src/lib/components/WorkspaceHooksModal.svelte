<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Select from '$lib/components/Select.svelte';
  import MonacoEditor from '$lib/components/MonacoEditor.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import {
    createWorkspaceHook,
    deleteWorkspaceHook,
    getAvailableHookShells,
    listWorkspaceHooks,
    toggleWorkspaceHook,
    updateWorkspaceHook,
    type HookUpsertInput,
    type WorkspaceHook,
    type WorkspaceHookShell,
    type WorkspaceHookScope,
    type WorkspaceHookTrigger,
  } from '$lib/sproutgit';
  import { toast } from '$lib/toast.svelte';

  type Props = {
    open: boolean;
    workspacePath: string;
    onClose: () => void;
  };

  let { open, workspacePath, onClose }: Props = $props();

  const triggerOptions: WorkspaceHookTrigger[] = [
    'before_worktree_create',
    'after_worktree_create',
    'before_worktree_remove',
    'after_worktree_remove',
    'before_worktree_switch',
    'after_worktree_switch',
    'manual',
  ];

  let loading = $state(false);
  let saving = $state(false);
  let togglingHookId = $state<string | null>(null);
  let hooks = $state<WorkspaceHook[]>([]);

  let editorOpen = $state(false);
  let editingHookId = $state<string | null>(null);

  let availableShells = $state<WorkspaceHookShell[]>(['bash']);
  const scopeOptions: { value: WorkspaceHookScope; label: string; detail: string }[] = [
    {
      value: 'worktree',
      label: 'Worktree',
      detail: 'Use when the hook is specific to the worktree being acted on.',
    },
    {
      value: 'workspace',
      label: 'Workspace',
      detail: 'Use when the hook manages shared workspace resources or cross-worktree state.',
    },
  ];

  const hookVariableGroups = [
    {
      title: 'Workspace',
      items: [
        { name: 'SPROUTGIT_WORKSPACE_PATH', description: 'Absolute path to the SproutGit workspace.' },
        { name: 'SPROUTGIT_WORKSPACE_NAME', description: 'Workspace directory name.' },
        { name: 'SPROUTGIT_ROOT_PATH', description: 'Absolute path to the protected root checkout.' },
        { name: 'SPROUTGIT_WORKTREES_PATH', description: 'Absolute path to the managed worktrees directory.' },
      ],
    },
    {
      title: 'Worktree',
      items: [
        { name: 'SPROUTGIT_WORKTREE_PATH', description: 'Absolute path to the target worktree.' },
        { name: 'SPROUTGIT_WORKTREE_NAME', description: 'Target worktree directory name.' },
        { name: 'SPROUTGIT_WORKTREE_BRANCH', description: 'Current branch name, if attached.' },
        { name: 'SPROUTGIT_WORKTREE_HEAD', description: 'Full HEAD commit hash.' },
        { name: 'SPROUTGIT_WORKTREE_HEAD_SHORT', description: 'Short HEAD commit hash.' },
        { name: 'SPROUTGIT_WORKTREE_DETACHED', description: 'true when the worktree is in detached HEAD state.' },
      ],
    },
    {
      title: 'Trigger',
      items: [
        { name: 'SPROUTGIT_TRIGGER', description: 'Full trigger name, such as before_worktree_create.' },
        { name: 'SPROUTGIT_TRIGGER_PHASE', description: 'before or after.' },
        { name: 'SPROUTGIT_TRIGGER_ACTION', description: 'create, remove, or switch.' },
        { name: 'SPROUTGIT_OS', description: 'Current OS label: macos, linux, or windows.' },
      ],
    },
    {
      title: 'Hook',
      items: [
        { name: 'SPROUTGIT_HOOK_ID', description: 'Stable ID of the current hook.' },
        { name: 'SPROUTGIT_HOOK_NAME', description: 'Human-readable hook name.' },
        { name: 'SPROUTGIT_HOOK_SCOPE', description: 'Whether the hook is classified as worktree or workspace scoped.' },
        { name: 'SPROUTGIT_HOOK_SHELL', description: 'Shell used to execute the script.' },
        { name: 'SPROUTGIT_HOOK_CRITICAL', description: 'true when the hook is marked critical.' },
        { name: 'SPROUTGIT_HOOK_TIMEOUT_SECONDS', description: 'Configured timeout for this hook run.' },
      ],
    },
  ] as const;

  const defaultScript = () => `# Example: run project setup for this worktree\n# Workspace: $SPROUTGIT_WORKSPACE_NAME\n# Worktree: $SPROUTGIT_WORKTREE_PATH\n# Branch: $SPROUTGIT_WORKTREE_BRANCH\n# Trigger: $SPROUTGIT_TRIGGER\n# pnpm install\n# pnpm run db:migrate`;

  let form = $state<HookUpsertInput>({
    name: '',
    scope: 'worktree',
    trigger: 'before_worktree_create',
    shell: 'bash',
    script: defaultScript(),
    enabled: true,
    critical: false,
    timeoutSeconds: 600,
    dependencyIds: [],
  });

  function normalizeShell(shell: string): WorkspaceHookShell {
    if (shell === 'pwsh' || shell === 'zsh' || shell === 'powershell') {
      return shell;
    }
    return 'bash';
  }

  function preferredShell(): WorkspaceHookShell {
    return availableShells[0] ?? 'bash';
  }

  async function loadAvailableShells() {
    try {
      const detected = await getAvailableHookShells();
      if (detected.length > 0) {
        availableShells = detected.map(normalizeShell);
        if (!availableShells.includes(form.shell)) {
          form = { ...form, shell: preferredShell() };
        }
      }
    } catch {
      availableShells = ['bash'];
      if (form.shell !== 'bash') {
        form = { ...form, shell: 'bash' };
      }
    }
  }

  function normalizeTriggerLabel(trigger: WorkspaceHookTrigger): string {
    if (trigger === 'manual') return 'Manual';
    return trigger
      .replaceAll('_', ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  async function loadHooks() {
    if (!workspacePath) return;
    loading = true;
    try {
      hooks = await listWorkspaceHooks(workspacePath);
    } catch (err) {
      toast.error(`Failed to load hooks: ${err}`);
    } finally {
      loading = false;
    }
  }

  function resetForm() {
    editingHookId = null;
    form = {
      name: '',
      scope: 'worktree',
      trigger: 'before_worktree_create',
      shell: preferredShell(),
      script: defaultScript(),
      enabled: true,
      critical: false,
      timeoutSeconds: 600,
      dependencyIds: [],
    };
  }

  function openNewModal() {
    resetForm();
    editorOpen = true;
  }

  function openEditModal(hook: WorkspaceHook) {
    editingHookId = hook.id;
    form = {
      name: hook.name,
      scope: hook.scope,
      trigger: hook.trigger,
      shell: normalizeShell(hook.shell),
      script: hook.script,
      enabled: hook.enabled,
      critical: hook.critical,
      timeoutSeconds: hook.timeoutSeconds,
      dependencyIds: [...hook.dependencyIds],
    };
    editorOpen = true;
  }

  async function saveHook() {
    if (!workspacePath) return;

    saving = true;
    const payload: HookUpsertInput = {
      ...form,
    };

    try {
      if (editingHookId) {
        await updateWorkspaceHook(workspacePath, editingHookId, payload);
        toast.success('Hook updated');
      } else {
        await createWorkspaceHook(workspacePath, payload);
        toast.success('Hook created');
      }

      editorOpen = false;
      await loadHooks();
    } catch (err) {
      toast.error(String(err));
    } finally {
      saving = false;
    }
  }

  async function removeHook(hookId: string) {
    if (!workspacePath) return;
    saving = true;
    try {
      await deleteWorkspaceHook(workspacePath, hookId);
      toast.info('Hook removed');
      await loadHooks();
    } catch (err) {
      toast.error(String(err));
    } finally {
      saving = false;
    }
  }

  async function toggleEnabled(hook: WorkspaceHook) {
    if (!workspacePath) return;

    const next = !hook.enabled;
    hooks = hooks.map(item => (item.id === hook.id ? { ...item, enabled: next } : item));
    togglingHookId = hook.id;

    try {
      await toggleWorkspaceHook(workspacePath, hook.id, next);
    } catch (err) {
      hooks = hooks.map(item => (item.id === hook.id ? { ...item, enabled: hook.enabled } : item));
      toast.error(String(err));
    } finally {
      togglingHookId = null;
    }
  }

  function toggleDependency(hookId: string, checked: boolean) {
    const next = new Set(form.dependencyIds);
    if (checked) {
      next.add(hookId);
    } else {
      next.delete(hookId);
    }
    form = {
      ...form,
      dependencyIds: Array.from(next),
    };
  }

  let dependencyCandidates = $derived(
    hooks.filter(
      hook =>
        hook.id !== editingHookId &&
        (hook.trigger === form.trigger || hook.trigger === 'manual'),
    )
  );

  $effect(() => {
    if (!open || !workspacePath) return;
    void loadAvailableShells();
    void loadHooks();
  });
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-40 bg-black/40"
    transition:fade={{ duration: 180 }}
    onclick={onClose}
  ></div>

  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div
      class="flex h-[min(78vh,760px)] w-[min(900px,96vw)] flex-col overflow-hidden rounded-xl border border-[var(--sg-border)] bg-[var(--sg-surface)] shadow-xl"
      transition:scale={{ duration: 220, start: 0.97 }}
    >
      <div
        class="flex items-center justify-between border-b border-[var(--sg-border-subtle)] px-4 py-3"
      >
        <div>
          <p class="text-sm font-semibold text-[var(--sg-text)]">Workspace Hooks</p>
          <p class="text-xs text-[var(--sg-text-faint)]">
            Manage lifecycle hooks for this workspace.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            onclick={openNewModal}
            class="inline-flex items-center gap-1.5 rounded bg-[var(--sg-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--sg-bg)] hover:bg-[var(--sg-primary-hover)]"
          >
            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 5v14M5 12h14" stroke-width="2" stroke-linecap="round" />
            </svg>
            New hook
          </button
          >
          <button
            onclick={onClose}
            class="rounded p-1 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
            aria-label="Close"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
              ><path d="M18 6 6 18M6 6l12 12" stroke-width="2" stroke-linecap="round" /></svg
            >
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-auto">
        {#if loading}
          <div class="flex items-center gap-2 text-xs text-[var(--sg-text-dim)]">
            <Spinner size="sm" />
            Loading hooks…
          </div>
        {:else if hooks.length === 0}
          <div
            class="rounded-lg border border-[var(--sg-border)] bg-[var(--sg-surface-raised)] px-3 py-2 text-xs text-[var(--sg-text-dim)]"
          >
            No hooks defined yet. Create one to automate workspace setup or cleanup.
          </div>
        {:else}
          <div class="border-b border-[var(--sg-border-subtle)] bg-[var(--sg-surface)]">
            {#each hooks as hook, index}
              <div
                class="px-4 py-2.5 {index > 0 ? 'border-t border-[var(--sg-border-subtle)]' : ''}"
                transition:fade={{ duration: 140 }}
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-[var(--sg-text)]">{hook.name}</p>
                    <p class="mt-0.5 text-xs text-[var(--sg-text-faint)]">
                      {normalizeTriggerLabel(hook.trigger)} • {hook.scope} • {hook.timeoutSeconds}s • {hook.shell}
                    </p>
                    <div class="mt-1 flex flex-wrap items-center gap-1.5">
                      {#if hook.critical}
                        <span class="rounded border border-[var(--sg-danger)]/30 bg-[var(--sg-danger)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--sg-danger)]">Critical</span>
                      {/if}
                      {#if hook.dependencyIds.length > 0}
                        <span class="rounded border border-[var(--sg-border)] px-1.5 py-0.5 text-[10px] text-[var(--sg-text-faint)]">
                          Depends on {hook.dependencyIds.length}
                        </span>
                      {/if}
                    </div>
                  </div>

                  <div class="flex items-center gap-2">
                    <button
                      onclick={() => openEditModal(hook)}
                      class="rounded border border-[var(--sg-border)] px-2 py-1 text-[10px] text-[var(--sg-text-dim)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
                      >Edit</button
                    >
                    <button
                      onclick={() => removeHook(hook.id)}
                      disabled={saving}
                      class="rounded border border-[var(--sg-border)] px-2 py-1 text-[10px] text-[var(--sg-danger)] hover:bg-[var(--sg-danger)]/10 disabled:opacity-50"
                      >Delete</button
                    >
                    <label class="inline-flex cursor-pointer items-center gap-1.5 pl-1">
                      <input
                        type="checkbox"
                        class="sr-only"
                        checked={hook.enabled}
                        disabled={togglingHookId === hook.id}
                        onchange={() => toggleEnabled(hook)}
                      />
                      <span
                        class="inline-flex h-4 w-8 items-center rounded-full p-0.5 transition-all duration-300 {hook.enabled
                          ? 'bg-[var(--sg-primary)]'
                          : 'bg-[var(--sg-border)]'} {togglingHookId === hook.id ? 'opacity-70' : ''}"
                      >
                        <span
                          class="h-3 w-3 rounded-full bg-white transition-all duration-300"
                          style="transform: translateX({hook.enabled ? '16px' : '0px'});"
                        ></span>
                      </span>
                      <span class="text-[10px] text-[var(--sg-text-faint)]">Enabled</span>
                    </label>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if editorOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-[60] bg-black/45"
    transition:fade={{ duration: 180 }}
    onclick={() => (editorOpen = false)}
  ></div>

  <div class="fixed inset-0 z-[70] flex items-center justify-center p-4">
    <div
      class="flex h-[min(86vh,860px)] w-[min(980px,96vw)] flex-col overflow-hidden rounded-xl border border-[var(--sg-border)] bg-[var(--sg-surface)] shadow-2xl"
      transition:scale={{ duration: 220, start: 0.97 }}
    >
      <div
        class="flex items-center justify-between border-b border-[var(--sg-border-subtle)] px-4 py-3"
      >
        <div>
          <p class="text-sm font-semibold text-[var(--sg-text)]">
            {editingHookId ? 'Edit hook' : 'New hook'}
          </p>
          <p class="text-xs text-[var(--sg-text-faint)]">
            Choose when this hook runs and which shell executes it.
          </p>
        </div>
        <button
          onclick={() => (editorOpen = false)}
          class="rounded p-1 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
          aria-label="Close"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
            ><path d="M18 6 6 18M6 6l12 12" stroke-width="2" stroke-linecap="round" /></svg
          >
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-auto p-4">
        <div class="grid grid-cols-1 gap-3">
          <label class="text-xs text-[var(--sg-text-faint)]">
            Hook name
            <input
              bind:value={form.name}
              class="mt-1 w-full rounded border border-[var(--sg-input-border)] bg-[var(--sg-input-bg)] px-2.5 py-1.5 text-xs text-[var(--sg-text)] outline-none focus:border-[var(--sg-input-focus)]"
              placeholder="Prepare dependencies"
            />
          </label>

          <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label class="text-xs text-[var(--sg-text-faint)]">
              Scope
              <Select
                className="mt-1"
                value={form.scope}
                options={scopeOptions.map((scope) => ({ value: scope.value, label: scope.label }))}
                onChange={(value) => {
                  form = { ...form, scope: value as WorkspaceHookScope };
                }}
              />
              <p class="mt-1 text-[10px] leading-relaxed text-[var(--sg-text-faint)]">
                {scopeOptions.find((scope) => scope.value === form.scope)?.detail}
              </p>
            </label>

            <label class="text-xs text-[var(--sg-text-faint)]">
              Trigger
              <Select
                className="mt-1"
                value={form.trigger}
                options={triggerOptions.map((trigger) => ({
                  value: trigger,
                  label: normalizeTriggerLabel(trigger),
                }))}
                onChange={(value) => {
                  form = { ...form, trigger: value as WorkspaceHookTrigger };
                }}
              />
            </label>

            <label class="text-xs text-[var(--sg-text-faint)]">
              Shell
              <Select
                className="mt-1"
                value={form.shell}
                options={availableShells.map((shell) => ({ value: shell, label: shell }))}
                onChange={(value) => {
                  form = { ...form, shell: value as WorkspaceHookShell };
                }}
              />
            </label>

            <label class="text-xs text-[var(--sg-text-faint)]">
              Timeout seconds
              <input
                type="number"
                min="1"
                max="86400"
                bind:value={form.timeoutSeconds}
                class="mt-1 w-full rounded border border-[var(--sg-input-border)] bg-[var(--sg-input-bg)] px-2.5 py-1.5 text-xs text-[var(--sg-text)] outline-none focus:border-[var(--sg-input-focus)]"
              />
            </label>
          </div>

          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Checkbox
              checked={form.enabled}
              onChange={(next) => {
                form = { ...form, enabled: next };
              }}
            >
              <span>
                <span class="block text-xs text-[var(--sg-text)]">Enabled</span>
                <span class="block text-[10px] text-[var(--sg-text-faint)]"
                  >Disable to keep without running.</span
                >
              </span>
            </Checkbox>

            <Checkbox
              checked={form.critical}
              variant="danger"
              onChange={(next) => {
                form = { ...form, critical: next };
              }}
            >
              <span>
                <span class="block text-xs text-[var(--sg-text)]">Critical</span>
                <span class="block text-[10px] text-[var(--sg-text-faint)]"
                  >If this fails in a before_* trigger, the worktree operation is blocked.</span
                >
              </span>
            </Checkbox>
          </div>

          <div>
            <p class="mb-1 text-xs text-[var(--sg-text-faint)]">Depends on</p>
            {#if dependencyCandidates.length === 0}
              <div
                class="rounded border border-[var(--sg-border-subtle)] bg-[var(--sg-surface-raised)] px-2.5 py-2 text-xs text-[var(--sg-text-faint)]"
              >
                No hooks available for this trigger yet.
              </div>
            {:else}
              <div
                class="max-h-28 overflow-auto rounded border border-[var(--sg-border-subtle)] bg-[var(--sg-surface-raised)] p-2"
              >
                <div class="space-y-1">
                {#each dependencyCandidates as candidate}
                  {@const isChecked = form.dependencyIds.includes(candidate.id)}
                  <Checkbox
                    checked={isChecked}
                    align="center"
                    className="w-full rounded px-1 py-1 hover:bg-[var(--sg-surface)]"
                    onChange={(next) => toggleDependency(candidate.id, next)}
                  >
                    <span class="min-w-0 truncate text-xs text-[var(--sg-text-dim)]"
                      >{candidate.name}</span
                    >
                  </Checkbox>
                {/each}
                </div>
              </div>
            {/if}
            <p class="mt-1 text-[10px] text-[var(--sg-text-faint)]">
              This hook runs only after all selected dependencies complete.
            </p>
          </div>

          <div>
            <p class="mb-1 text-xs text-[var(--sg-text-faint)]">Script</p>
            <MonacoEditor
              value={form.script}
              language={form.shell === 'pwsh' || form.shell === 'powershell' ? 'powershell' : 'shell'}
              theme="auto"
              height="360px"
              onChange={next => {
                form = { ...form, script: next };
              }}
            />
            <div class="mt-3 rounded-lg border border-[var(--sg-border-subtle)] bg-[var(--sg-surface-raised)] p-3">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <p class="text-xs font-medium text-[var(--sg-text)]">Available runtime variables</p>
                  <p class="mt-0.5 text-[10px] text-[var(--sg-text-faint)]">
                    These are injected into every hook process so scripts can adapt to the current workspace, worktree, trigger, and hook metadata.
                  </p>
                </div>
                <span class="rounded border border-[var(--sg-border)] bg-[var(--sg-surface)] px-2 py-0.5 text-[10px] text-[var(--sg-text-faint)]">
                  {form.shell === 'pwsh' || form.shell === 'powershell' ? '$env:NAME' : '$NAME'}
                </span>
              </div>

              <div class="mt-3 grid gap-3 md:grid-cols-2">
                {#each hookVariableGroups as group}
                  <div class="rounded border border-[var(--sg-border)] bg-[var(--sg-surface)] p-2.5">
                    <p class="text-[10px] font-semibold uppercase tracking-wider text-[var(--sg-text-faint)]">{group.title}</p>
                    <div class="mt-2 space-y-2">
                      {#each group.items as item}
                        <div>
                          <p class="font-mono text-[10px] text-[var(--sg-text)]">{item.name}</p>
                          <p class="mt-0.5 text-[10px] leading-relaxed text-[var(--sg-text-dim)]">{item.description}</p>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        class="flex items-center justify-end gap-2 border-t border-[var(--sg-border-subtle)] px-4 py-3"
      >
        <button
          onclick={() => (editorOpen = false)}
          class="rounded border border-[var(--sg-border)] px-3 py-1.5 text-xs text-[var(--sg-text-dim)] hover:bg-[var(--sg-surface-raised)]"
          >Cancel</button
        >
        <button
          onclick={saveHook}
          disabled={saving || !form.name.trim() || !form.script.trim()}
          class="rounded bg-[var(--sg-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--sg-primary-hover)] disabled:opacity-40"
        >
          {#if saving}
            Saving…
          {:else if editingHookId}
            Save hook
          {:else}
            Create hook
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
