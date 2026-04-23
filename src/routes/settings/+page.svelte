<script lang="ts">
  import { goto } from '$app/navigation';
  import { getVersion } from '@tauri-apps/api/app';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { updateState } from '$lib/update.svelte';
  import { GitBranch, Info, Pencil, Settings, SquareTerminal, User } from 'lucide-svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import UpdateBadge from '$lib/components/UpdateBadge.svelte';
  import WindowControls from '$lib/components/WindowControls.svelte';
  import {
    detectEditors,
    detectGitTools,
    getAppSetting,
    getGitConfig,
    getGitInfo,
    getGithubAuthStatus,
    githubDeviceFlowPoll,
    githubDeviceFlowStart,
    githubLogout,
    listAvailableShells,
    listGithubEmailSuggestions,
    migrateGithubAuthStorage,
    setAppSetting,
    setGitConfig,
    type DeviceCodeResponse,
    type EditorInfo,
    type GitHubAuthStatus,
    type GitHubEmailSuggestion,
    type GitInfo,
    type GitToolInfo,
  } from '$lib/sproutgit';
  import { toast } from '$lib/toast.svelte';

  const initialWorkspacePath =
    typeof window !== 'undefined'
      ? new URL(window.location.href).searchParams.get('workspace') ?? ''
      : '';
  let workspacePath = $state(initialWorkspacePath);

  let githubAuth = $state<GitHubAuthStatus | null>(null);
  let deviceCode = $state<DeviceCodeResponse | null>(null);
  let authPolling = $state(false);
  let authStarting = $state(false);

  let editors = $state<EditorInfo[]>([]);
  let gitTools = $state<GitToolInfo[]>([]);
  let currentEditor = $state('');
  let customEditor = $state('');
  let currentDiffTool = $state('');
  let customDiffTool = $state('');
  let currentMergeTool = $state('');
  let customMergeTool = $state('');
  let toolsLoading = $state(true);

  let currentGitName = $state('');
  let currentGitEmail = $state('');
  let customGitName = $state('');
  let customGitEmail = $state('');

  let githubEmailSuggestions = $state<GitHubEmailSuggestion[]>([]);
  let githubEmailsLoading = $state(false);

  let availableShells = $state<string[]>([]);
  let currentShell = $state('');
  let shellsLoading = $state(true);

  let gitInfo = $state<GitInfo | null>(null);
  let appVersion = $state<string | null>(null);
  const updaterEnabled = !import.meta.env.DEV;
  let updateChecking = $state(false);
  let updateInstalling = $state(false);

  let editingAuthor = $state(false);
  let editingEditor = $state(false);
  let editingDiffTool = $state(false);
  let editingMergeTool = $state(false);

  const installedEditors = $derived(editors.filter((e) => e.installed));
  const unavailableEditors = $derived(editors.filter((e) => !e.installed));
  const installedDiffTools = $derived(gitTools.filter((t) => t.installed && t.supportsDiff));
  const installedMergeTools = $derived(gitTools.filter((t) => t.installed && t.supportsMerge));

  type ToolDisplay = {
    id: string;
    name: string;
  };

  function titleCase(value: string): string {
    return value
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function commandToken(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const stripped = trimmed.replace(/^"([\s\S]*)"(?:\s.*)?$/, '$1').replace(/^'([\s\S]*)'(?:\s.*)?$/, '$1');
    const first = stripped.split(/\s+/)[0] ?? '';
    const normalized = first.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    const parts = normalized.split('/');
    return (parts[parts.length - 1] ?? normalized).toLowerCase();
  }

  function fallbackDisplay(value: string): ToolDisplay {
    const token = commandToken(value);
    const base = token || value.trim();
    return { id: token || 'custom', name: titleCase(base) };
  }

  function findEditorDisplay(value: string): ToolDisplay | null {
    if (!value.trim()) return null;
    const match = editors.find((editor) => matchesEditor(editor, value));
    if (match) return { id: match.id, name: match.name };
    return fallbackDisplay(value);
  }

  function findToolDisplay(value: string): ToolDisplay | null {
    if (!value.trim()) return null;
    const token = commandToken(value);
    const match = gitTools.find((tool) => tool.id === value || tool.id === token || tool.command === token);
    if (match) return { id: match.id, name: match.name };
    return fallbackDisplay(value);
  }

  const editorDisplay = $derived(findEditorDisplay(currentEditor));
  const diffToolDisplay = $derived(findToolDisplay(currentDiffTool));
  const mergeToolDisplay = $derived(findToolDisplay(currentMergeTool));

  getVersion().then((v) => (appVersion = import.meta.env.DEV ? 'dev build' : v)).catch(() => (appVersion = 'unknown'));
  getGitInfo()
    .then((info) => (gitInfo = info))
    .catch(() => (gitInfo = { installed: false, version: 'Unavailable' }));

  Promise.all([
    detectEditors(),
    detectGitTools(),
    getGitConfig('core.editor'),
    getGitConfig('diff.tool'),
    getGitConfig('merge.tool'),
    getGitConfig('user.name'),
    getGitConfig('user.email'),
  ])
    .then(([detectedEditors, detectedTools, configuredEditor, diffTool, mergeTool, gitName, gitEmail]) => {
      editors = detectedEditors;
      gitTools = detectedTools;
      currentEditor = configuredEditor;
      currentDiffTool = diffTool;
      currentMergeTool = mergeTool;
      currentGitName = gitName;
      currentGitEmail = gitEmail;
      customGitName = gitName;
      customGitEmail = gitEmail;
      if (configuredEditor && !detectedEditors.some((e) => e.installed && matchesEditor(e, configuredEditor))) {
        customEditor = configuredEditor;
      }
      toolsLoading = false;
    })
    .catch(() => (toolsLoading = false));

  Promise.all([listAvailableShells(), getAppSetting('default_shell')])
    .then(([shells, saved]) => {
      availableShells = shells;
      currentShell = saved ?? shells[0] ?? '';
      shellsLoading = false;
    })
    .catch(() => (shellsLoading = false));

  migrateGithubAuthStorage()
    .catch(() => {})
    .finally(() => {
      getGithubAuthStatus()
        .then(async (status) => {
          githubAuth = status;
          if (status.authenticated) await loadGithubEmailSuggestions();
        })
        .catch(() => (githubAuth = { authenticated: false, username: null, provider: 'github' }));
    });

  function matchesEditor(editor: EditorInfo, configured: string): boolean {
    const stripped = configured.replace(/^["']|["']$/g, '');
    const cmd = stripped.split(/\s+--?\w/)[0].trim();
    return cmd === editor.command || stripped.startsWith(editor.command);
  }
  function quoteCommand(command: string): string {
    return command.includes(' ') ? `"${command}"` : command;
  }
  function editorCommand(editor: EditorInfo): string {
    const waits = ['vscode', 'cursor', 'windsurf', 'kiro', 'sublime', 'zed'];
    const cmd = quoteCommand(editor.command);
    return waits.includes(editor.id) ? `${cmd} --wait` : cmd;
  }
  function buildDiffToolCommand(tool: GitToolInfo): string | null {
    const waits = ['vscode', 'cursor', 'windsurf', 'kiro', 'sublime', 'zed'];
    const cmd = quoteCommand(tool.command);
    if (waits.includes(tool.id)) return `${cmd} --wait --diff "$LOCAL" "$REMOTE"`;
    if (tool.id === 'opendiff') return 'opendiff "$LOCAL" "$REMOTE"';
    return null;
  }
  function buildMergeToolCommand(tool: GitToolInfo): string | null {
    const waits = ['vscode', 'cursor', 'windsurf', 'kiro', 'sublime', 'zed'];
    const cmd = quoteCommand(tool.command);
    if (waits.includes(tool.id)) return `${cmd} --wait "$MERGED"`;
    if (tool.id === 'opendiff') return 'opendiff "$LOCAL" "$REMOTE" -merge "$MERGED"';
    return null;
  }
  function togglePanel(panel: 'author' | 'editor' | 'diff' | 'merge') {
    editingAuthor = panel === 'author' ? !editingAuthor : false;
    editingEditor = panel === 'editor' ? !editingEditor : false;
    editingDiffTool = panel === 'diff' ? !editingDiffTool : false;
    editingMergeTool = panel === 'merge' ? !editingMergeTool : false;
  }

  async function loadGithubEmailSuggestions() {
    githubEmailsLoading = true;
    try {
      githubEmailSuggestions = await listGithubEmailSuggestions();
    } catch {
      githubEmailSuggestions = [];
    } finally {
      githubEmailsLoading = false;
    }
  }
  async function startGithubLogin() {
    authStarting = true;
    try {
      const dc = await githubDeviceFlowStart();
      deviceCode = dc;
      await openUrl(dc.verificationUri);
      setTimeout(async function poll() {
        try {
          const result = await githubDeviceFlowPoll(dc.deviceCode);
          if (result.status === 'complete') {
            authPolling = false;
            deviceCode = null;
            githubAuth = { authenticated: true, username: result.username, provider: 'github' };
            await loadGithubEmailSuggestions();
            toast.success(`Signed in as ${result.username ?? 'GitHub user'}`);
            return;
          }
          if (result.status === 'pending') {
            authPolling = true;
            setTimeout(poll, (dc.interval + 1) * 1000);
            return;
          }
          authPolling = false;
          deviceCode = null;
          toast.error(result.error ?? 'Authentication failed');
        } catch (err) {
          authPolling = false;
          deviceCode = null;
          toast.error(String(err));
        }
      }, dc.interval * 1000);
    } catch (err) {
      toast.error(String(err));
    } finally {
      authStarting = false;
    }
  }
  async function handleGithubLogout() {
    try {
      await githubLogout();
      githubAuth = { authenticated: false, username: null, provider: 'github' };
      githubEmailSuggestions = [];
    } catch (err) {
      toast.error(String(err));
    }
  }
  async function saveGitIdentity() {
    try {
      await Promise.all([
        setGitConfig('user.name', customGitName.trim()),
        setGitConfig('user.email', customGitEmail.trim()),
      ]);
      currentGitName = customGitName.trim();
      currentGitEmail = customGitEmail.trim();
      editingAuthor = false;
      toast.success('Git author updated');
    } catch (err) {
      toast.error(String(err));
    }
  }
  async function applyGithubEmail(s: GitHubEmailSuggestion) {
    try {
      await setGitConfig('user.email', s.email);
      currentGitEmail = s.email;
      customGitEmail = s.email;
      toast.success(`Git email set to ${s.label}`);
    } catch (err) {
      toast.error(String(err));
    }
  }
  async function applyGithubUsernameAsAuthor() {
    if (!githubAuth?.username) return;
    try {
      await setGitConfig('user.name', githubAuth.username);
      currentGitName = githubAuth.username;
      customGitName = githubAuth.username;
      toast.success('Git author name set from GitHub username');
    } catch (err) {
      toast.error(String(err));
    }
  }
  async function selectEditor(editor: EditorInfo) {
    try {
      const cmd = editorCommand(editor);
      await setGitConfig('core.editor', cmd);
      currentEditor = cmd;
      customEditor = '';
      editingEditor = false;
      toast.success(`Editor set to ${editor.name}`);
    } catch (err) {
      toast.error(String(err));
    }
  }
  async function saveCustomEditor() {
    try {
      const value = customEditor.trim();
      await setGitConfig('core.editor', value);
      currentEditor = value;
      editingEditor = false;
      toast.success(value ? `Editor set to "${value}"` : 'Editor config cleared');
    } catch (err) {
      toast.error(String(err));
    }
  }
  async function applyDetectedDiffTool(tool: GitToolInfo) {
    try {
      await setGitConfig('diff.tool', tool.id);
      const cmd = buildDiffToolCommand(tool);
      if (cmd) await setGitConfig(`difftool.${tool.id}.cmd`, cmd);
      currentDiffTool = tool.id;
      customDiffTool = '';
      editingDiffTool = false;
      toast.success(`Diff tool set to ${tool.name}`);
    } catch (err) {
      toast.error(String(err));
    }
  }
  async function applyDetectedMergeTool(tool: GitToolInfo) {
    try {
      await setGitConfig('merge.tool', tool.id);
      const cmd = buildMergeToolCommand(tool);
      if (cmd) await setGitConfig(`mergetool.${tool.id}.cmd`, cmd);
      currentMergeTool = tool.id;
      customMergeTool = '';
      editingMergeTool = false;
      toast.success(`Merge tool set to ${tool.name}`);
    } catch (err) {
      toast.error(String(err));
    }
  }
  async function saveCustomDiffTool() {
    try {
      const value = customDiffTool.trim();
      await setGitConfig('diff.tool', value);
      currentDiffTool = value;
      editingDiffTool = false;
    } catch (err) {
      toast.error(String(err));
    }
  }
  async function saveCustomMergeTool() {
    try {
      const value = customMergeTool.trim();
      await setGitConfig('merge.tool', value);
      currentMergeTool = value;
      editingMergeTool = false;
    } catch (err) {
      toast.error(String(err));
    }
  }
  async function selectShell(shell: string) {
    currentShell = shell;
    try {
      await setAppSetting('default_shell', shell);
      toast.success(`Default shell set to ${shell}`);
    } catch (err) {
      toast.error(String(err));
    }
  }
</script>

<main class="sg-body flex h-screen flex-col">
  <header data-tauri-drag-region class="flex shrink-0 items-center gap-3 border-b border-(--sg-border) bg-(--sg-surface) pt-1 pr-1 pb-1 pl-(--sg-titlebar-inset)">
    <button onclick={() => goto(workspacePath ? `/workspace?workspace=${encodeURIComponent(workspacePath)}` : '/')} class="rounded px-2 py-0.5 text-xs text-(--sg-text-dim) hover:bg-(--sg-surface-raised) hover:text-(--sg-text)">&larr; Projects</button>
    <div class="h-3 w-px bg-(--sg-border)"></div>
    <span class="sg-heading text-xs font-medium text-(--sg-text)">Settings</span>
    <div class="ml-auto flex items-center gap-2">
      <UpdateBadge href={workspacePath ? `/settings?workspace=${encodeURIComponent(workspacePath)}` : '/settings'} />
      <WindowControls />
    </div>
  </header>

  <div class="flex-1 overflow-auto p-6">
    <div class="mx-auto flex max-w-6xl flex-col gap-6">
      <div class="flex items-center gap-2"><Settings size={18} class="text-(--sg-primary)" /><h1 class="sg-heading text-lg font-semibold text-(--sg-primary)">Settings</h1></div>

      <section class="rounded-lg border border-(--sg-border) bg-(--sg-surface) p-5">
        <div class="mb-3 flex items-center gap-2"><svg viewBox="0 0 16 16" aria-hidden="true" class="h-4 w-4 text-(--sg-primary)" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="3.25" cy="8" r="1.5" /><circle cx="12.75" cy="4" r="1.5" /><circle cx="12.75" cy="12" r="1.5" /><path d="M4.6 7.2 11.4 4.8" /><path d="M4.6 8.8 11.4 11.2" /></svg><h2 class="sg-heading text-sm font-semibold text-(--sg-primary)">Git Provider</h2></div>
        {#if githubAuth === null}
          <div class="flex items-center gap-2 text-xs text-(--sg-text-dim)"><Spinner size="sm" /> Checking connection...</div>
        {:else if githubAuth.authenticated}
          <div class="flex items-center justify-between rounded border border-(--sg-border) bg-(--sg-surface-raised) px-3 py-2.5">
            <p class="text-xs text-(--sg-text)">{githubAuth.username}</p>
            <button class="rounded border border-(--sg-border) px-3 py-1.5 text-xs text-(--sg-text-dim) hover:border-(--sg-danger) hover:text-(--sg-danger)" onclick={handleGithubLogout}>Sign out</button>
          </div>
        {:else if authPolling}
          <div class="flex items-center gap-2 text-xs text-(--sg-text-dim)"><Spinner size="sm" /> Waiting for authorization...</div>
        {:else}
          <button class="inline-flex items-center gap-2 rounded border border-(--sg-border) bg-(--sg-surface-raised) px-3 py-1.5 text-xs text-(--sg-text) hover:bg-(--sg-primary) hover:text-white" onclick={startGithubLogin} disabled={authStarting}><svg viewBox="0 0 16 16" aria-hidden="true" class="h-3.5 w-3.5" fill="currentColor"><path d="M8 0C3.58 0 0 3.67 0 8.2c0 3.62 2.29 6.7 5.47 7.78.4.08.55-.18.55-.39 0-.2-.01-.85-.01-1.54-2.23.5-2.7-.98-2.7-.98-.36-.95-.9-1.2-.9-1.2-.73-.52.06-.51.06-.51.8.06 1.23.84 1.23.84.72 1.26 1.88.9 2.34.69.07-.54.28-.9.5-1.1-1.78-.21-3.64-.91-3.64-4.06 0-.9.31-1.63.82-2.2-.09-.21-.36-1.04.08-2.17 0 0 .67-.22 2.2.84A7.43 7.43 0 0 1 8 3.46c.68 0 1.37.1 2.01.31 1.53-1.06 2.2-.84 2.2-.84.44 1.13.17 1.96.08 2.17.51.57.82 1.3.82 2.2 0 3.16-1.87 3.84-3.66 4.05.29.26.54.77.54 1.56 0 1.13-.01 2.03-.01 2.31 0 .21.14.47.55.39A8.2 8.2 0 0 0 16 8.2C16 3.67 12.42 0 8 0Z" /></svg>Sign in with GitHub</button>
        {/if}
      </section>

      <div class="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <section class="rounded-lg border border-(--sg-border) bg-(--sg-surface)">
          <div class="border-b border-(--sg-border) px-5 py-4"><div class="flex items-center gap-2"><GitBranch size={16} class="text-(--sg-primary)" /><h2 class="sg-heading text-sm font-semibold text-(--sg-primary)">Git Settings</h2></div><p class="mt-1 text-xs text-(--sg-text-faint)">These update your global Git configuration.</p></div>

          {#if toolsLoading}
            <div class="px-5 py-5 text-xs text-(--sg-text-dim)"><Spinner size="sm" /> Detecting editors and tools...</div>
          {:else}
            <div class="divide-y divide-(--sg-border)">
              <div class="px-5 py-4">
                <div class="flex items-start justify-between"><div class="flex gap-2"><User size={14} class="mt-0.5 text-(--sg-text-dim)" /><div><p class="sg-heading text-xs font-semibold text-(--sg-text)">Author Identity</p><p class="text-[11px] text-(--sg-text-faint)">{currentGitName || '(not set)'} · {currentGitEmail || '(not set)'}</p></div></div><button class="inline-flex items-center gap-1 rounded border border-(--sg-border) px-2.5 py-1 text-xs text-(--sg-text-dim)" onclick={() => togglePanel('author')}><Pencil size={12} /> {editingAuthor ? 'Done' : 'Edit'}</button></div>
                {#if editingAuthor}
                  <div class="mt-3 space-y-2 border-t border-(--sg-border) pt-3">
                    <input bind:value={customGitName} class="w-full rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-2.5 py-1.5 text-xs text-(--sg-text)" placeholder="Git user.name" />
                    <input bind:value={customGitEmail} class="w-full rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-2.5 py-1.5 text-xs text-(--sg-text)" placeholder="Git user.email" />
                    <div class="flex flex-wrap gap-2"><button class="rounded border border-(--sg-border) px-3 py-1.5 text-xs text-(--sg-text)" onclick={saveGitIdentity}>Save Author</button>{#if githubAuth?.authenticated && githubAuth.username}<button class="rounded border border-(--sg-border) px-3 py-1.5 text-xs text-(--sg-text)" onclick={applyGithubUsernameAsAuthor}>Use GitHub Username</button>{/if}</div>
                    {#if githubAuth?.authenticated}
                      <div class="flex flex-wrap gap-2">{#if githubEmailsLoading}<span class="text-[11px] text-(--sg-text-faint)">Loading GitHub emails...</span>{:else}{#each githubEmailSuggestions as suggestion}<button class="rounded border border-(--sg-border) px-2 py-1 text-[11px] text-(--sg-text-dim)" onclick={() => applyGithubEmail(suggestion)}>{suggestion.label}</button>{/each}{/if}</div>
                    {/if}
                  </div>
                {/if}
              </div>

              <div class="px-5 py-4">
                <div class="flex items-start justify-between"><div class="flex gap-2"><svg viewBox="0 0 16 16" aria-hidden="true" class="mt-0.5 h-3.5 w-3.5 text-(--sg-text-dim)" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13.5h10" /><path d="M5 11.5h6" /><path d="M4.5 2.5h7l1 1v5l-1 1h-7l-1-1v-5z" /></svg><div><p class="sg-heading text-xs font-semibold text-(--sg-text)">Editor</p>{#if editorDisplay}<p class="text-[11px] text-(--sg-text-faint)">{editorDisplay.name}</p>{:else}<p class="text-[11px] text-(--sg-text-faint)">(not set)</p>{/if}</div></div><button class="inline-flex items-center gap-1 rounded border border-(--sg-border) px-2.5 py-1 text-xs text-(--sg-text-dim)" onclick={() => togglePanel('editor')}><Pencil size={12} /> {editingEditor ? 'Done' : 'Edit'}</button></div>
                {#if editingEditor}
                  <div class="mt-3 space-y-2 border-t border-(--sg-border) pt-3"><div class="flex flex-wrap gap-2">{#each installedEditors as editor}<button class="rounded border px-3 py-1.5 text-xs {currentEditor && matchesEditor(editor, currentEditor) ? 'border-(--sg-primary) text-(--sg-primary)' : 'border-(--sg-border) text-(--sg-text-dim)'}" onclick={() => selectEditor(editor)}>{editor.name}</button>{/each}</div><div class="flex gap-2"><input bind:value={customEditor} class="min-w-0 flex-1 rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-2.5 py-1.5 font-mono text-xs text-(--sg-text)" placeholder="Custom core.editor" /><button class="rounded border border-(--sg-border) px-3 py-1.5 text-xs text-(--sg-text)" onclick={saveCustomEditor}>Save</button></div>{#if unavailableEditors.length > 0}<p class="text-[11px] text-(--sg-text-faint)">Not found: {unavailableEditors.map((e) => e.name).join(', ')}</p>{/if}</div>
                {/if}
              </div>

              <div class="px-5 py-4">
                <div class="flex items-start justify-between"><div class="flex gap-2"><svg viewBox="0 0 16 16" aria-hidden="true" class="mt-0.5 h-3.5 w-3.5 text-(--sg-text-dim)" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11" /><path d="M2.5 11.5h11" /><circle cx="5" cy="4.5" r="1.25" fill="currentColor" stroke="none" /><circle cx="11" cy="11.5" r="1.25" fill="currentColor" stroke="none" /></svg><div><p class="sg-heading text-xs font-semibold text-(--sg-text)">Diff Tool</p>{#if diffToolDisplay}<p class="text-[11px] text-(--sg-text-faint)">{diffToolDisplay.name}</p>{:else}<p class="text-[11px] text-(--sg-text-faint)">(not set)</p>{/if}</div></div><button class="inline-flex items-center gap-1 rounded border border-(--sg-border) px-2.5 py-1 text-xs text-(--sg-text-dim)" onclick={() => togglePanel('diff')}><Pencil size={12} /> {editingDiffTool ? 'Done' : 'Edit'}</button></div>
                {#if editingDiffTool}
                  <div class="mt-3 space-y-2 border-t border-(--sg-border) pt-3"><div class="flex flex-wrap gap-2">{#each installedDiffTools as tool}<button class="rounded border px-3 py-1.5 text-xs {currentDiffTool === tool.id ? 'border-(--sg-primary) text-(--sg-primary)' : 'border-(--sg-border) text-(--sg-text-dim)'}" onclick={() => applyDetectedDiffTool(tool)}>{tool.name}</button>{/each}</div><div class="flex gap-2"><input bind:value={customDiffTool} class="min-w-0 flex-1 rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-2.5 py-1.5 font-mono text-xs text-(--sg-text)" placeholder="Custom diff.tool" /><button class="rounded border border-(--sg-border) px-3 py-1.5 text-xs text-(--sg-text)" onclick={saveCustomDiffTool}>Save</button></div></div>
                {/if}
              </div>

              <div class="px-5 py-4">
                <div class="flex items-start justify-between"><div class="flex gap-2"><svg viewBox="0 0 16 16" aria-hidden="true" class="mt-0.5 h-3.5 w-3.5 text-(--sg-text-dim)" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v6.5" /><path d="M11 13V6.5" /><path d="M2.5 6.5 5 9l2.5-2.5" /><path d="M8.5 9.5 11 7l2.5 2.5" /></svg><div><p class="sg-heading text-xs font-semibold text-(--sg-text)">Merge Tool</p>{#if mergeToolDisplay}<p class="text-[11px] text-(--sg-text-faint)">{mergeToolDisplay.name}</p>{:else}<p class="text-[11px] text-(--sg-text-faint)">(not set)</p>{/if}</div></div><button class="inline-flex items-center gap-1 rounded border border-(--sg-border) px-2.5 py-1 text-xs text-(--sg-text-dim)" onclick={() => togglePanel('merge')}><Pencil size={12} /> {editingMergeTool ? 'Done' : 'Edit'}</button></div>
                {#if editingMergeTool}
                  <div class="mt-3 space-y-2 border-t border-(--sg-border) pt-3"><div class="flex flex-wrap gap-2">{#each installedMergeTools as tool}<button class="rounded border px-3 py-1.5 text-xs {currentMergeTool === tool.id ? 'border-(--sg-primary) text-(--sg-primary)' : 'border-(--sg-border) text-(--sg-text-dim)'}" onclick={() => applyDetectedMergeTool(tool)}>{tool.name}</button>{/each}</div><div class="flex gap-2"><input bind:value={customMergeTool} class="min-w-0 flex-1 rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-2.5 py-1.5 font-mono text-xs text-(--sg-text)" placeholder="Custom merge.tool" /><button class="rounded border border-(--sg-border) px-3 py-1.5 text-xs text-(--sg-text)" onclick={saveCustomMergeTool}>Save</button></div></div>
                {/if}
              </div>

              <div class="px-5 py-4"><div class="flex items-center gap-2"><Info size={14} class="text-(--sg-text-dim)" /><p class="sg-heading text-xs font-semibold text-(--sg-text)">Git Installation</p></div>{#if gitInfo === null}<p class="mt-1 text-xs text-(--sg-text-faint)">Checking...</p>{:else if gitInfo.installed}<p class="mt-1 text-xs text-(--sg-text-dim)">{gitInfo.version}</p>{:else}<p class="mt-1 text-xs text-(--sg-danger)">Git not found</p>{/if}</div>
            </div>
          {/if}
        </section>

        <div class="space-y-6">
          <section class="rounded-lg border border-(--sg-border) bg-(--sg-surface) p-5">
            <div class="mb-2 flex items-center gap-2"><SquareTerminal size={16} class="text-(--sg-primary)" /><h2 class="sg-heading text-sm font-semibold text-(--sg-primary)">Terminal Shell</h2></div>
            <p class="mb-3 text-xs text-(--sg-text-faint)">Default shell used in SproutGit's terminal panel.</p>
            {#if shellsLoading}
              <div class="text-xs text-(--sg-text-dim)"><Spinner size="sm" /> Detecting shells...</div>
            {:else if availableShells.length === 0}
              <p class="text-xs text-(--sg-text-faint)">No supported shells detected.</p>
            {:else}
              <div class="flex flex-wrap gap-2">{#each availableShells as shell}<button class="rounded border px-3 py-1.5 text-xs {currentShell === shell ? 'border-(--sg-primary) text-(--sg-primary)' : 'border-(--sg-border) text-(--sg-text-dim)'}" onclick={() => selectShell(shell)}>{shell}</button>{/each}</div>
            {/if}
          </section>

          <section class="rounded-lg border border-(--sg-border) bg-(--sg-surface) p-5">
            <div class="mb-2 flex items-center gap-2"><Info size={16} class="text-(--sg-primary)" /><h2 class="sg-heading text-sm font-semibold text-(--sg-primary)">About</h2></div>
            <div class="flex items-center justify-between"><span class="sg-logo-text text-xs text-(--sg-text)">SproutGit</span><span class="font-mono text-xs text-(--sg-text-dim)">{#if appVersion !== null}{import.meta.env.DEV ? appVersion : `v${appVersion}`}{:else}<Spinner size="sm" />{/if}</span></div>
            <div class="mt-3 border-t border-(--sg-border) pt-3">
              {#if !updaterEnabled}
                <p class="mb-2 text-xs text-(--sg-text-faint)">Updater is disabled in development builds.</p>
              {:else if updateState.available}
                <p class="mb-2 text-xs font-medium text-(--sg-text)">Update v{updateState.available.version} available</p>
                {#if updateState.available.body}
                  <div class="mb-3 max-h-40 overflow-y-auto rounded border border-(--sg-border) bg-(--sg-bg) p-2">
                    <pre class="whitespace-pre-wrap text-xs leading-relaxed text-(--sg-text-dim)">{updateState.available.body}</pre>
                  </div>
                {/if}
                <button class="rounded border border-(--sg-border) px-3 py-1.5 text-xs text-(--sg-text)" disabled={updateInstalling} onclick={async () => {
                  updateInstalling = true;
                  try {
                    await updateState.available!.downloadAndInstall();
                    const { relaunch } = await import('@tauri-apps/plugin-process');
                    await relaunch();
                  } catch (err) {
                    toast.error(String(err));
                  } finally {
                    updateInstalling = false;
                  }
                }}>{updateInstalling ? 'Installing...' : 'Install & Restart'}</button>
              {:else}
                <p class="mb-2 text-xs text-(--sg-text-faint)">{#if updateState.checked}Up to date{:else}Check for the latest version{/if}</p>
                <button class="rounded border border-(--sg-border) bg-(--sg-surface-raised) px-3 py-1.5 text-xs text-(--sg-text)" disabled={updateChecking} onclick={async () => {
                  updateChecking = true;
                  try {
                    const { check } = await import('@tauri-apps/plugin-updater');
                    updateState.set(await check());
                    if (!updateState.available) toast.info("You're on the latest version");
                  } catch (err) {
                    toast.error('Update check failed: ' + String(err));
                  } finally {
                    updateChecking = false;
                  }
                }}>{updateChecking ? 'Checking...' : 'Check for Updates'}</button>
              {/if}
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</main>
