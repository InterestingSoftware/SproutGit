<script lang="ts">
  import { goto } from '$app/navigation';
  import { tick } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { open } from '@tauri-apps/plugin-dialog';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { ArrowRight, Clock, Download, FolderInput, FolderOpen, Play, X } from 'lucide-svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import Autocomplete from '$lib/components/Autocomplete.svelte';
  import {
    createWorkspace,
    importGitRepoWorkspaceWithMode,
    getGitInfo,
    inspectWorkspace,
    onCloneProgress,
    onImportProgress,
    getGithubAuthStatus,
    listGithubRepos,
    getHomeDir,
    listRecentWorkspaces,
    touchRecentWorkspace,
    removeRecentWorkspace,
    getAppSetting,
    setAppSetting,
    type GitInfo,
    type ImportRepoMode,
    type WorkspaceInitResult,
    type WorkspaceStatus,
    type GitHubAuthStatus,
    type RecentWorkspace,
  } from '$lib/sproutgit';
  import { toast } from '$lib/toast.svelte';
  import WindowControls from '$lib/components/WindowControls.svelte';

  type GitHubRepoItem = { label: string; value: string; detail?: string };

  type KnownProject = {
    workspacePath: string;
    rootPath: string;
    lastOpenedAt: number;
  };

  const PROJECTS_FOLDER_SETTING_KEY = 'projectsFolder';

  let gitChecked = $state(false);
  let git = $state<GitInfo>({ installed: false, version: null });
  let projectsFolder = $state('');
  let cloneUrl = $state('');
  let folderName = $state('');
  let folderNameManual = $state(false);
  let importRepoPath = $state('');
  let importFolderName = $state('');
  let importFolderNameManual = $state(false);
  let importMode = $state<ImportRepoMode>('inPlace');
  let creating = $state(false);
  let importing = $state(false);
  let opening = $state(false);
  let error = $state('');
  let knownProjects = $state<KnownProject[]>([]);
  let createdWorkspace = $state<WorkspaceInitResult | null>(null);
  let cloneProgress = $state<string[]>([]);
  let clonePercent = $state<number | null>(null);
  let clonePhase = $state('');
  let progressEl = $state<HTMLDivElement | null>(null);
  let importProgressMsg = $state('');

  // GitHub auth state
  let githubAuth = $state<GitHubAuthStatus | null>(null);
  let githubRepos = $state<GitHubRepoItem[]>([]);
  let reposFetched = $state(false);
  let reposLoading = $state(false);

  let showCloneModal = $state(false);
  let showImportModal = $state(false);
  let appVersion = $state<string | null>(null);
  let cloneUrlInput = $state<HTMLInputElement | null>(null);
  let importRepoPathInput = $state<HTMLInputElement | null>(null);
  let cloneDialog = $state<HTMLDivElement | null>(null);
  let importDialog = $state<HTMLDivElement | null>(null);
  let cloneReturnFocus = $state<HTMLElement | null>(null);
  let importReturnFocus = $state<HTMLElement | null>(null);

  let workspacePath = $derived(
    projectsFolder && folderName ? `${projectsFolder}/${folderName}` : ''
  );

  let importWorkspacePath = $derived(
    projectsFolder && importFolderName ? `${projectsFolder}/${importFolderName}` : ''
  );

  function repoNameFromUrl(url: string): string {
    const trimmed = url.trim().replace(/\/+$/, '');
    // Handle .git suffix
    const withoutGit = trimmed.replace(/\.git$/, '');
    // Get last path segment
    const lastSlash = withoutGit.lastIndexOf('/');
    const lastColon = withoutGit.lastIndexOf(':');
    const sep = Math.max(lastSlash, lastColon);
    if (sep === -1) return '';
    return withoutGit.slice(sep + 1);
  }

  function repoNameFromPath(path: string): string {
    const trimmed = path.trim().replace(/[\\/]+$/g, '');
    if (!trimmed) return '';
    const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    return idx === -1 ? trimmed : trimmed.slice(idx + 1);
  }

  function workspaceNameFromPath(path: string): string {
    return repoNameFromPath(path) || path.trim() || '?';
  }

  function handleUrlInput() {
    if (!folderNameManual) {
      folderName = repoNameFromUrl(cloneUrl);
    }
  }

  // Keep folder name auto-derived from URL until the user manually edits it.
  $effect(() => {
    if (!folderNameManual) {
      folderName = repoNameFromUrl(cloneUrl);
    }
  });

  function handleRepoSelect(value: string) {
    cloneUrl = value;
    handleUrlInput();
  }

  async function fetchGithubRepos() {
    if (reposFetched || reposLoading || !githubAuth?.authenticated) return;
    reposLoading = true;
    try {
      const repos = await listGithubRepos();
      githubRepos = repos.map(r => ({
        label: r.fullName,
        value: r.cloneUrl,
        detail: r.private ? 'private' : undefined,
      }));
      reposFetched = true;
    } catch (err) {
      toast.error(`Failed to load repos: ${err}`);
    } finally {
      reposLoading = false;
    }
  }

  function handleFolderNameInput() {
    folderNameManual = folderName !== '' && folderName !== repoNameFromUrl(cloneUrl);
  }

  function handleImportRepoPathInput() {
    if (!importFolderNameManual) {
      importFolderName = repoNameFromPath(importRepoPath);
    }
  }

  function handleImportFolderNameInput() {
    importFolderNameManual =
      importFolderName !== '' && importFolderName !== repoNameFromPath(importRepoPath);
  }

  async function openCloneModal() {
    error = '';
    cloneProgress = [];
    clonePercent = null;
    cloneReturnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    showCloneModal = true;
    await tick();
    if (cloneUrlInput) {
      cloneUrlInput.focus();
    } else {
      cloneDialog?.focus();
    }
  }

  async function openImportModal() {
    error = '';
    importMode = 'inPlace';
    importRepoPath = '';
    importFolderName = '';
    importFolderNameManual = false;
    importReturnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    showImportModal = true;
    await tick();
    if (importRepoPathInput) {
      importRepoPathInput.focus();
    } else {
      importDialog?.focus();
    }
  }

  async function closeCloneModal() {
    showCloneModal = false;
    await tick();
    cloneReturnFocus?.focus();
  }

  async function closeImportModal() {
    showImportModal = false;
    await tick();
    importReturnFocus?.focus();
  }

  function handleModalGlobalKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (showImportModal) {
      event.preventDefault();
      void closeImportModal();
      return;
    }
    if (showCloneModal) {
      event.preventDefault();
      void closeCloneModal();
    }
  }

  function trapModalFocus(event: KeyboardEvent, container: HTMLDivElement | null) {
    if (event.key !== 'Tab' || !container) return;
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(element => !element.hasAttribute('disabled'));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function browseProjectsFolder() {
    const dir = await open({ directory: true, title: 'Choose projects folder' });
    if (dir) {
      projectsFolder = dir;
      saveProjectsFolder();
    }
  }

  async function saveProjectsFolder() {
    await setAppSetting(PROJECTS_FOLDER_SETTING_KEY, projectsFolder);
  }

  function fromRecentWorkspace(item: RecentWorkspace): KnownProject {
    return {
      workspacePath: item.workspacePath,
      rootPath: `${item.workspacePath}/root`,
      lastOpenedAt: item.lastOpenedAt,
    };
  }

  async function loadKnownProjects() {
    try {
      const recents = await listRecentWorkspaces();
      knownProjects = recents.map(fromRecentWorkspace);
    } catch (err) {
      toast.error(`Failed to load recent workspaces: ${err}`);
      knownProjects = [];
    }
  }

  async function saveKnownProject(workspace: WorkspaceStatus | WorkspaceInitResult) {
    await touchRecentWorkspace(workspace.workspacePath);

    const updated = [
      {
        workspacePath: workspace.workspacePath,
        rootPath: workspace.rootPath,
        lastOpenedAt: Date.now(),
      },
      ...knownProjects.filter(item => item.workspacePath !== workspace.workspacePath),
    ].slice(0, 20);

    knownProjects = updated;
  }

  async function startNewProject(event: Event) {
    event.preventDefault();
    error = '';

    if (!projectsFolder.trim()) {
      error = 'Projects folder is required';
      return;
    }
    if (!cloneUrl.trim()) {
      error = 'Repository URL is required';
      return;
    }
    if (!folderName.trim()) {
      error = 'Folder name is required';
      return;
    }

    await saveProjectsFolder();
    cloneProgress = [];
    clonePercent = null;
    clonePhase = '';
    creating = true;

    const unlisten = await onCloneProgress(msg => {
      cloneProgress = [...cloneProgress, msg];
      // Parse percentage from git progress (e.g. "Receiving objects:  45% (5000/12345)")
      const pctMatch = msg.match(/(\d+)%/);
      if (pctMatch) {
        clonePercent = parseInt(pctMatch[1], 10);
      }
      // Parse phase name
      const phaseMatch = msg.match(/^(\w[\w\s]+?):\s/);
      if (phaseMatch) {
        clonePhase = phaseMatch[1];
      }
      // Auto-scroll to bottom
      requestAnimationFrame(() => {
        if (progressEl) progressEl.scrollTop = progressEl.scrollHeight;
      });
    });

    try {
      const created = await createWorkspace(workspacePath, cloneUrl);
      createdWorkspace = created;
      await saveKnownProject(created);
      toast.success(`Workspace created: ${workspaceNameFromPath(created.workspacePath)}`);
      await goto(`/workspace?workspace=${encodeURIComponent(created.workspacePath)}`);
    } catch (err) {
      error = String(err);
      toast.error(String(err));
    } finally {
      unlisten();
      creating = false;
    }
  }

  async function removeKnownProject(workspacePath: string) {
    await removeRecentWorkspace(workspacePath);
    knownProjects = knownProjects.filter(p => p.workspacePath !== workspacePath);
  }

  async function importExistingRepo(event: Event) {
    event.preventDefault();
    error = '';

    if (!importRepoPath.trim()) {
      error = 'Repository path is required';
      return;
    }

    const needsWorkspacePath = importMode === 'move' || importMode === 'copy';

    if (needsWorkspacePath) {
      if (!projectsFolder.trim()) {
        error = 'Workspace parent folder is required';
        return;
      }
      if (!importFolderName.trim()) {
        error = 'Workspace folder name is required';
        return;
      }
    }

    if (needsWorkspacePath) {
      await saveProjectsFolder();
    }

    importing = true;
    importProgressMsg = '';
    let unlistenImport: (() => void) | null = null;

    try {
      unlistenImport = await onImportProgress(msg => {
        importProgressMsg = msg;
      });
      const imported = await importGitRepoWorkspaceWithMode(
        importRepoPath,
        importMode,
        needsWorkspacePath ? importWorkspacePath : null
      );
      createdWorkspace = imported;
      await saveKnownProject(imported);
      toast.success(`Workspace imported: ${workspaceNameFromPath(imported.workspacePath)}`);
      await goto(`/workspace?workspace=${encodeURIComponent(imported.workspacePath)}`);
    } catch (err) {
      error = String(err);
      toast.error(String(err));
    } finally {
      unlistenImport?.();
      importProgressMsg = '';
      importing = false;
    }
  }

  async function openKnownWorkspace(path: string) {
    error = '';
    opening = true;

    try {
      const status = await inspectWorkspace(path);
      if (!status.isSproutgitProject) {
        throw new Error('Selected path is not a SproutGit project');
      }
      await saveKnownProject(status);
      await goto(`/workspace?workspace=${encodeURIComponent(status.workspacePath)}`);
    } catch (err) {
      const msg = String(err);
      if (
        msg.includes('does not exist') ||
        msg.includes('No such file') ||
        msg.includes('not found') ||
        msg.includes('not a SproutGit project')
      ) {
        await removeKnownProject(path);
        toast.error(`Project removed — path no longer exists: ${workspaceNameFromPath(path)}`);
      } else {
        error = msg;
      }
    } finally {
      opening = false;
    }
  }

  async function openSproutGitWorkspaceDialog() {
    error = '';
    opening = true;
    try {
      const dir = await open({ directory: true, title: 'Open SproutGit workspace' });
      if (!dir) return;

      const status = await inspectWorkspace(dir);
      if (!status.isSproutgitProject) {
        toast.error('Selected path is not a SproutGit workspace');
        return;
      }

      await saveKnownProject(status);
      await goto(`/workspace?workspace=${encodeURIComponent(status.workspacePath)}`);
    } catch (err) {
      toast.error(String(err));
    } finally {
      opening = false;
    }
  }

  getGitInfo().then(info => {
    git = info;
    gitChecked = true;
  });

  getVersion()
    .then(v => (appVersion = import.meta.env.DEV ? 'dev build' : v))
    .catch(() => (appVersion = null));

  loadKnownProjects();

  getGithubAuthStatus().then(s => {
    githubAuth = s;
    if (s.authenticated) fetchGithubRepos();
  });

  getAppSetting(PROJECTS_FOLDER_SETTING_KEY)
    .then(value => {
      if (value?.trim()) {
        projectsFolder = value;
        return;
      }

      getHomeDir()
        .then(async home => {
          projectsFolder = `${home}/Projects`;
          await saveProjectsFolder();
        })
        .catch(() => {});
    })
    .catch(() => {
      getHomeDir()
        .then(async home => {
          projectsFolder = `${home}/Projects`;
          await saveProjectsFolder();
        })
        .catch(() => {});
    });
</script>

<svelte:window onkeydown={handleModalGlobalKeydown} />

{#if !gitChecked}
  <main class="flex h-screen items-center justify-center bg-[var(--sg-bg)]">
    <Spinner size="md" label="Checking git…" />
  </main>
{:else if !git.installed}
  <main
    class="flex h-screen flex-col items-center justify-center gap-6 bg-[var(--sg-bg)] px-8 text-center"
  >
    <div class="text-5xl">🌱</div>
    <h1 class="text-xl font-semibold text-[var(--sg-text)]">Git is not installed</h1>
    <p class="max-w-sm text-sm text-[var(--sg-text-dim)]">
      SproutGit requires Git to manage repositories and worktrees. Please install Git and relaunch
      the app.
    </p>
    <button
      class="rounded-md bg-[var(--sg-primary)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--sg-primary-hover)] transition-colors"
      onclick={() => openUrl('https://git-scm.com/downloads')}
    >
      Download Git
    </button>
  </main>
{:else}
  <main class="flex h-screen flex-col">
    <!-- Title bar area -->
    <header
      data-tauri-drag-region
      class="flex shrink-0 items-center justify-between border-b border-[var(--sg-border)] bg-[var(--sg-surface)] pt-1 pr-1 pb-1 pl-[var(--sg-titlebar-inset)]"
    >
      <span
        class="sg-logo-text flex items-center gap-1.5 text-sm font-semibold text-[var(--sg-text)]"
      >
        <img src="/logo.svg" alt="" class="h-5 w-5" />
        SproutGit
      </span>
      <div class="flex items-center gap-3">
        {#if githubAuth?.authenticated}
          <span class="flex items-center gap-1.5 text-xs text-[var(--sg-text-dim)]">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
              ><path
                d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
              /></svg
            >
            {githubAuth.username}
          </span>
        {/if}
        <button
          onclick={() => goto('/settings')}
          class="rounded-full p-1 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
          title="Settings"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><circle cx="12" cy="12" r="3" /><path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            /></svg
          >
        </button>
        <WindowControls />
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <!-- Left: Start sidebar -->
      <section
        class="flex w-64 shrink-0 flex-col border-r border-[var(--sg-border)] bg-[var(--sg-surface)]"
      >
        <div class="border-b border-[var(--sg-border-subtle)] px-4 py-3">
          <h2
            class="flex items-center gap-1.5 text-xs font-semibold uppercase leading-none tracking-wider text-[var(--sg-text-dim)]"
          >
            <Play size={14} strokeWidth={2.5} />Start
          </h2>
        </div>
        <div class="flex flex-col gap-2 p-4">
          <button
            type="button"
            onclick={openCloneModal}
            class="flex w-full cursor-pointer items-center gap-2.5 rounded-md border border-[var(--sg-border)] px-3.5 py-2.5 text-sm font-medium text-[var(--sg-text)] hover:border-[var(--sg-primary)]/40 hover:bg-[var(--sg-surface-raised)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download size={16} strokeWidth={2} class="text-[var(--sg-primary)] shrink-0" />
            Clone
          </button>
          <button
            type="button"
            onclick={openSproutGitWorkspaceDialog}
            disabled={opening}
            class="flex w-full cursor-pointer items-center gap-2.5 rounded-md border border-[var(--sg-border)] px-3.5 py-2.5 text-sm font-medium text-[var(--sg-text)] hover:border-[var(--sg-primary)]/40 hover:bg-[var(--sg-surface-raised)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FolderOpen size={16} strokeWidth={2} class="text-[var(--sg-primary)] shrink-0" />
            {#if opening}Opening…{:else}Open{/if}
          </button>
          <button
            type="button"
            onclick={openImportModal}
            class="flex w-full cursor-pointer items-center gap-2.5 rounded-md border border-[var(--sg-border)] px-3.5 py-2.5 text-sm font-medium text-[var(--sg-text)] hover:border-[var(--sg-primary)]/40 hover:bg-[var(--sg-surface-raised)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FolderInput size={16} strokeWidth={2} class="text-[var(--sg-primary)] shrink-0" />
            Import Git Repo
          </button>
        </div>
        {#if appVersion}
          <div class="mt-auto px-4 pb-4 pt-2 text-center">
            <p class="text-[10px] text-[var(--sg-text-faint)]">
              SproutGit {import.meta.env.DEV ? appVersion : `v${appVersion}`}
            </p>
          </div>
        {/if}
      </section>

      <!-- Right: Known projects list -->
      <section class="flex min-w-0 flex-1 flex-col">
        <div class="border-b border-[var(--sg-border-subtle)] bg-[var(--sg-surface)] px-4 py-3">
          <h2
            class="flex items-center gap-1.5 text-xs font-semibold uppercase leading-none tracking-wider text-[var(--sg-text-dim)]"
          >
            <Clock size={14} strokeWidth={2.5} />Recent projects
          </h2>
        </div>

        <div class="flex-1 overflow-auto p-4">
          {#if knownProjects.length === 0}
            <div class="flex h-full items-center justify-center">
              <p class="text-sm text-[var(--sg-text-faint)]">
                No projects yet. Clone a repo to get started.
              </p>
            </div>
          {:else}
            <div class="space-y-1">
              {#each knownProjects as project}
                <div
                  class="group flex items-center gap-0 rounded hover:bg-[var(--sg-surface-raised)]"
                >
                  <button
                    class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded px-3 py-2 text-left disabled:cursor-not-allowed"
                    onclick={() => openKnownWorkspace(project.workspacePath)}
                    disabled={opening}
                  >
                    <div
                      class="sg-heading flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[var(--sg-avatar-bg)] text-sm font-semibold text-[var(--sg-avatar-text)]"
                    >
                      {workspaceNameFromPath(project.workspacePath).charAt(0).toUpperCase()}
                    </div>
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-sm font-medium text-[var(--sg-text)]">
                        {workspaceNameFromPath(project.workspacePath)}
                      </p>
                      <p class="truncate text-xs text-[var(--sg-text-faint)]">
                        {project.workspacePath}
                      </p>
                    </div>
                  </button>
                  <button
                    class="shrink-0 cursor-pointer rounded p-1.5 text-[var(--sg-text-faint)] opacity-0 transition-opacity hover:text-[var(--sg-danger)] group-hover:opacity-100"
                    title="Remove from recent projects"
                    onclick={e => {
                      e.stopPropagation();
                      void removeKnownProject(project.workspacePath)
                        .then(() => {
                          toast.info(
                            `Removed ${workspaceNameFromPath(project.workspacePath)} from recent projects`
                          );
                        })
                        .catch(err => {
                          toast.error(String(err));
                        });
                    }}
                  >
                    <X size={14} />
                  </button>
                  <button
                    class="mr-2 shrink-0 cursor-pointer rounded p-1.5 text-[var(--sg-text-faint)] hover:text-[var(--sg-text)] disabled:cursor-not-allowed"
                    title="Open workspace"
                    onclick={() => openKnownWorkspace(project.workspacePath)}
                    disabled={opening}
                  >
                    <ArrowRight size={14} />
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </section>
    </div>

    <!-- Clone modal -->
    {#if showCloneModal}
      <div
        role="button"
        tabindex="0"
        aria-label="Close clone dialog"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        onclick={e => {
          if (e.target === e.currentTarget) void closeCloneModal();
        }}
        onkeydown={event => {
          if (
            (event.key === 'Enter' || event.key === ' ') &&
            event.target === event.currentTarget
          ) {
            event.preventDefault();
            void closeCloneModal();
          }
        }}
      >
        <div
          bind:this={cloneDialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="clone-modal-title"
          tabindex="-1"
          onkeydown={event => trapModalFocus(event, cloneDialog)}
          class="flex w-[480px] flex-col rounded-lg border border-[var(--sg-border)] bg-[var(--sg-surface)] shadow-2xl"
        >
          <!-- Modal header -->
          <div
            class="flex items-center justify-between border-b border-[var(--sg-border-subtle)] px-4 py-3"
          >
            <h2 id="clone-modal-title" class="text-sm font-semibold text-[var(--sg-text)]">
              Clone Repository
            </h2>
            <button
              onclick={() => void closeCloneModal()}
              class="rounded p-1 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
              ><X size={16} /></button
            >
          </div>

          <!-- Form -->
          <form onsubmit={startNewProject} class="flex flex-col gap-4 p-4">
            <div>
              <label
                for="modal-repo-url"
                class="mb-1 flex items-center gap-1.5 text-xs text-[var(--sg-text-dim)]"
              >
                Repository URL
                {#if reposLoading}<Spinner size="sm" />{/if}
              </label>
              {#if githubRepos.length > 0}
                <Autocomplete
                  items={githubRepos}
                  bind:value={cloneUrl}
                  onselect={handleRepoSelect}
                  id="modal-repo-url"
                  placeholder="Search repos or paste a URL"
                />
              {:else}
                <input
                  bind:this={cloneUrlInput}
                  id="modal-repo-url"
                  bind:value={cloneUrl}
                  oninput={handleUrlInput}
                  class="w-full rounded border border-[var(--sg-input-border)] bg-[var(--sg-input-bg)] px-2.5 py-1.5 text-xs text-[var(--sg-text)] placeholder-[var(--sg-text-faint)] outline-none focus:border-[var(--sg-input-focus)]"
                  placeholder="https://github.com/org/repo.git"
                  spellcheck="false"
                  autocorrect="off"
                  autocapitalize="off"
                />
              {/if}
            </div>

            <div>
              <label for="modal-folder-name" class="mb-1 block text-xs text-[var(--sg-text-dim)]"
                >Workspace folder name</label
              >
              <input
                id="modal-folder-name"
                bind:value={folderName}
                oninput={handleFolderNameInput}
                class="w-full rounded border border-[var(--sg-input-border)] bg-[var(--sg-input-bg)] px-2.5 py-1.5 text-xs text-[var(--sg-text)] placeholder-[var(--sg-text-faint)] outline-none focus:border-[var(--sg-input-focus)]"
                placeholder="my-repo"
              />
            </div>

            <div>
              <label
                for="modal-projects-folder"
                class="mb-1 block text-xs text-[var(--sg-text-dim)]">Workspace parent folder</label
              >
              <div class="flex gap-1.5">
                <input
                  id="modal-projects-folder"
                  bind:value={projectsFolder}
                  oninput={saveProjectsFolder}
                  class="min-w-0 flex-1 rounded border border-[var(--sg-input-border)] bg-[var(--sg-input-bg)] px-2.5 py-1.5 text-xs text-[var(--sg-text)] placeholder-[var(--sg-text-faint)] outline-none focus:border-[var(--sg-input-focus)]"
                  placeholder="~/Projects"
                />
                <button
                  type="button"
                  onclick={browseProjectsFolder}
                  class="shrink-0 rounded border border-[var(--sg-border)] bg-[var(--sg-surface-raised)] px-2.5 py-1.5 text-xs text-[var(--sg-text-dim)] hover:bg-[var(--sg-border)] hover:text-[var(--sg-text)]"
                  >Browse</button
                >
              </div>
              {#if workspacePath}
                <p class="mt-1 truncate text-[10px] text-[var(--sg-text-faint)]">{workspacePath}</p>
              {/if}
            </div>

            {#if creating && cloneProgress.length > 0}
              <div class="flex flex-col gap-1.5">
                {#if clonePercent !== null}
                  <div class="flex items-center gap-2">
                    <div
                      class="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--sg-border-subtle)]"
                    >
                      <div
                        class="h-full rounded-full bg-[var(--sg-primary)] transition-all duration-300"
                        style="width: {clonePercent}%"
                      ></div>
                    </div>
                    <span class="shrink-0 text-[10px] font-medium text-[var(--sg-text-dim)]"
                      >{clonePercent}%</span
                    >
                  </div>
                {/if}
                <div
                  bind:this={progressEl}
                  class="max-h-24 overflow-auto rounded border border-[var(--sg-border-subtle)] bg-[var(--sg-input-bg)] px-2.5 py-1.5"
                >
                  {#each cloneProgress as line}
                    <p class="font-mono text-[10px] text-[var(--sg-text-dim)]">{line}</p>
                  {/each}
                </div>
              </div>
            {/if}

            {#if error}
              <p class="select-text text-xs text-[var(--sg-danger)]">{error}</p>
            {/if}

            <div class="flex justify-end gap-2 border-t border-[var(--sg-border-subtle)] pt-3">
              <button
                type="button"
                onclick={() => void closeCloneModal()}
                class="rounded-md border border-[var(--sg-border)] bg-[var(--sg-surface-raised)] px-3.5 py-2 text-xs font-medium text-[var(--sg-text-dim)] hover:bg-[var(--sg-border)] hover:text-[var(--sg-text)]"
                >Cancel</button
              >
              <button
                type="submit"
                disabled={creating || !git.installed || !workspacePath}
                class="flex items-center gap-2 rounded-md bg-[var(--sg-primary)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--sg-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {#if creating}<Spinner size="sm" />&nbsp;Cloning…{:else}<Download
                    size={13}
                    strokeWidth={2}
                  /> Clone{/if}
              </button>
            </div>
          </form>
        </div>
      </div>
    {/if}

    <!-- Import Git Repo modal -->
    {#if showImportModal}
      <div
        role="button"
        tabindex="0"
        aria-label="Close import dialog"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        onclick={e => {
          if (e.target === e.currentTarget) void closeImportModal();
        }}
        onkeydown={event => {
          if (
            (event.key === 'Enter' || event.key === ' ') &&
            event.target === event.currentTarget
          ) {
            event.preventDefault();
            void closeImportModal();
          }
        }}
      >
        <div
          bind:this={importDialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-modal-title"
          tabindex="-1"
          onkeydown={event => trapModalFocus(event, importDialog)}
          class="flex w-[520px] flex-col rounded-lg border border-[var(--sg-border)] bg-[var(--sg-surface)] shadow-2xl"
        >
          <!-- Modal header -->
          <div
            class="flex items-center justify-between border-b border-[var(--sg-border-subtle)] px-4 py-3"
          >
            <h2 id="import-modal-title" class="text-sm font-semibold text-[var(--sg-text)]">
              Import Git Repo
            </h2>
            <button
              onclick={() => void closeImportModal()}
              class="rounded p-1 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
              ><X size={16} /></button
            >
          </div>

          <!-- Form -->
          <form onsubmit={importExistingRepo} class="flex flex-col gap-4 p-4">
            <div>
              <label
                for="modal-import-repo-path"
                class="mb-1 block text-xs text-[var(--sg-text-dim)]">Where is the git repo?</label
              >
              <div class="flex gap-1.5">
                <input
                  bind:this={importRepoPathInput}
                  id="modal-import-repo-path"
                  bind:value={importRepoPath}
                  oninput={handleImportRepoPathInput}
                  class="min-w-0 flex-1 rounded border border-[var(--sg-input-border)] bg-[var(--sg-input-bg)] px-2.5 py-1.5 text-xs text-[var(--sg-text)] placeholder-[var(--sg-text-faint)] outline-none focus:border-[var(--sg-input-focus)]"
                  placeholder="~/src/my-repo"
                />
                <button
                  type="button"
                  onclick={async () => {
                    const dir = await open({
                      directory: true,
                      title: 'Select git repository to import',
                    });
                    if (dir) {
                      importRepoPath = dir;
                      handleImportRepoPathInput();
                    }
                  }}
                  class="shrink-0 rounded border border-[var(--sg-border)] bg-[var(--sg-surface-raised)] px-2.5 py-1.5 text-xs text-[var(--sg-text-dim)] hover:bg-[var(--sg-border)] hover:text-[var(--sg-text)]"
                  >Browse</button
                >
              </div>
            </div>

            <div>
              <p class="mb-2 text-xs font-medium text-[var(--sg-text-dim)]">
                How should it be imported?
              </p>
              <div class="flex flex-col gap-1.5">
                <button
                  type="button"
                  class="rounded-md border px-3 py-2.5 text-left text-xs transition-colors {importMode ===
                  'inPlace'
                    ? 'border-[var(--sg-primary)] bg-[var(--sg-primary)]/10'
                    : 'border-[var(--sg-border)] hover:bg-[var(--sg-surface-raised)]'}"
                  onclick={() => (importMode = 'inPlace')}
                >
                  <span
                    class="font-semibold {importMode === 'inPlace'
                      ? 'text-[var(--sg-primary)]'
                      : 'text-[var(--sg-text)]'}">Import in place</span
                  >
                  <span class="mt-0.5 block text-[var(--sg-text-faint)]"
                    >Restructure the selected folder into a SproutGit workspace in-situ. The repo
                    becomes the <code class="font-mono">root</code> inside the same parent directory.</span
                  >
                </button>
                <button
                  type="button"
                  class="rounded-md border px-3 py-2.5 text-left text-xs transition-colors {importMode ===
                  'move'
                    ? 'border-[var(--sg-primary)] bg-[var(--sg-primary)]/10'
                    : 'border-[var(--sg-border)] hover:bg-[var(--sg-surface-raised)]'}"
                  onclick={() => (importMode = 'move')}
                >
                  <span
                    class="font-semibold {importMode === 'move'
                      ? 'text-[var(--sg-primary)]'
                      : 'text-[var(--sg-text)]'}">Move to new workspace</span
                  >
                  <span class="mt-0.5 block text-[var(--sg-text-faint)]"
                    >Move the repo to a new folder and create the workspace structure around it.
                    Original location is removed.</span
                  >
                </button>
                <button
                  type="button"
                  class="rounded-md border px-3 py-2.5 text-left text-xs transition-colors {importMode ===
                  'copy'
                    ? 'border-[var(--sg-primary)] bg-[var(--sg-primary)]/10'
                    : 'border-[var(--sg-border)] hover:bg-[var(--sg-surface-raised)]'}"
                  onclick={() => (importMode = 'copy')}
                >
                  <span
                    class="font-semibold {importMode === 'copy'
                      ? 'text-[var(--sg-primary)]'
                      : 'text-[var(--sg-text)]'}">Copy to new workspace</span
                  >
                  <span class="mt-0.5 block text-[var(--sg-text-faint)]"
                    >Copy the repo into a new workspace. Original is left untouched.</span
                  >
                </button>
              </div>
            </div>

            {#if importMode === 'move' || importMode === 'copy'}
              <div>
                <label
                  for="modal-import-folder-name"
                  class="mb-1 block text-xs text-[var(--sg-text-dim)]">Workspace folder name</label
                >
                <input
                  id="modal-import-folder-name"
                  bind:value={importFolderName}
                  oninput={handleImportFolderNameInput}
                  class="w-full rounded border border-[var(--sg-input-border)] bg-[var(--sg-input-bg)] px-2.5 py-1.5 text-xs text-[var(--sg-text)] placeholder-[var(--sg-text-faint)] outline-none focus:border-[var(--sg-input-focus)]"
                  placeholder="my-repo"
                />
                <div class="mt-2 flex gap-1.5">
                  <input
                    id="modal-import-projects-folder"
                    bind:value={projectsFolder}
                    oninput={saveProjectsFolder}
                    class="min-w-0 flex-1 rounded border border-[var(--sg-input-border)] bg-[var(--sg-input-bg)] px-2.5 py-1.5 text-xs text-[var(--sg-text)] placeholder-[var(--sg-text-faint)] outline-none focus:border-[var(--sg-input-focus)]"
                    placeholder="~/Projects (parent folder)"
                  />
                  <button
                    type="button"
                    onclick={browseProjectsFolder}
                    class="shrink-0 rounded border border-[var(--sg-border)] bg-[var(--sg-surface-raised)] px-2.5 py-1.5 text-xs text-[var(--sg-text-dim)] hover:bg-[var(--sg-border)] hover:text-[var(--sg-text)]"
                    >Browse</button
                  >
                </div>
                {#if importWorkspacePath}
                  <p class="mt-1 truncate text-[10px] text-[var(--sg-text-faint)]">
                    {importWorkspacePath}
                  </p>
                {/if}
              </div>
            {/if}

            {#if error}
              <p class="select-text text-xs text-[var(--sg-danger)]">{error}</p>
            {/if}

            {#if importing && importProgressMsg}
              <p class="truncate text-[10px] text-[var(--sg-text-faint)]">{importProgressMsg}</p>
            {/if}

            <div class="flex justify-end gap-2 border-t border-[var(--sg-border-subtle)] pt-3">
              <button
                type="button"
                onclick={() => void closeImportModal()}
                class="rounded-md border border-[var(--sg-border)] bg-[var(--sg-surface-raised)] px-3.5 py-2 text-xs font-medium text-[var(--sg-text-dim)] hover:bg-[var(--sg-border)] hover:text-[var(--sg-text)]"
                >Cancel</button
              >
              <button
                type="submit"
                disabled={importing ||
                  !git.installed ||
                  !importRepoPath ||
                  ((importMode === 'move' || importMode === 'copy') && !importWorkspacePath)}
                class="flex items-center gap-2 rounded-md bg-[var(--sg-primary)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--sg-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {#if importing}<Spinner size="sm" />&nbsp;Importing…{:else}<FolderInput
                    size={13}
                    strokeWidth={2}
                  /> Import{/if}
              </button>
            </div>
          </form>
        </div>
      </div>
    {/if}
  </main>
{/if}
