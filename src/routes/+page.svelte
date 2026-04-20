<script lang="ts">
  import { goto } from "$app/navigation";
  import { open } from "@tauri-apps/plugin-dialog";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import Spinner from "$lib/components/Spinner.svelte";
  import Autocomplete from "$lib/components/Autocomplete.svelte";
  import {
    createWorkspace,
    getGitInfo,
    inspectWorkspace,
    onCloneProgress,
    getGithubAuthStatus,
    listGithubRepos,
    getHomeDir,
    type GitInfo,
    type WorkspaceInitResult,
    type WorkspaceStatus,
    type GitHubAuthStatus,
  } from "$lib/sproutgit";
  import { toast } from "$lib/toast.svelte";

  type GitHubRepoItem = { label: string; value: string; detail?: string };

  type KnownProject = {
    workspacePath: string;
    rootPath: string;
    lastOpenedAt: number;
  };

  const KNOWN_PROJECTS_KEY = "sproutgit.knownProjects";
  const PROJECTS_FOLDER_KEY = "sproutgit.projectsFolder";

  let gitChecked = $state(false);
  let git = $state<GitInfo>({ installed: false, version: null });
  let projectsFolder = $state(localStorage.getItem(PROJECTS_FOLDER_KEY) ?? "");
  let cloneUrl = $state("");
  let folderName = $state("");
  let folderNameManual = $state(false);
  let openWorkspacePath = $state("");
  let creating = $state(false);
  let opening = $state(false);
  let error = $state("");
  let knownProjects = $state<KnownProject[]>([]);
  let createdWorkspace = $state<WorkspaceInitResult | null>(null);
  let cloneProgress = $state<string[]>([]);
  let clonePercent = $state<number | null>(null);
  let clonePhase = $state("");
  let progressEl = $state<HTMLDivElement | null>(null);

  // GitHub auth state
  let githubAuth = $state<GitHubAuthStatus | null>(null);
  let githubRepos = $state<GitHubRepoItem[]>([]);
  let reposFetched = $state(false);
  let reposLoading = $state(false);

  let workspacePath = $derived(
    projectsFolder && folderName ? `${projectsFolder}/${folderName}` : ""
  );

  function repoNameFromUrl(url: string): string {
    const trimmed = url.trim().replace(/\/+$/, "");
    // Handle .git suffix
    const withoutGit = trimmed.replace(/\.git$/, "");
    // Get last path segment
    const lastSlash = withoutGit.lastIndexOf("/");
    const lastColon = withoutGit.lastIndexOf(":");
    const sep = Math.max(lastSlash, lastColon);
    if (sep === -1) return "";
    return withoutGit.slice(sep + 1);
  }

  function handleUrlInput() {
    if (!folderNameManual) {
      folderName = repoNameFromUrl(cloneUrl);
    }
  }

  function handleRepoSelect(value: string) {
    cloneUrl = value;
    handleUrlInput();
  }

  async function fetchGithubRepos() {
    if (reposFetched || reposLoading || !githubAuth?.authenticated) return;
    reposLoading = true;
    try {
      const repos = await listGithubRepos();
      githubRepos = repos.map((r) => ({
        label: r.fullName,
        value: r.cloneUrl,
        detail: r.private ? "private" : undefined,
      }));
      reposFetched = true;
    } catch (err) {
      toast.error(`Failed to load repos: ${err}`);
    } finally {
      reposLoading = false;
    }
  }

  function handleFolderNameInput() {
    folderNameManual = folderName !== "" && folderName !== repoNameFromUrl(cloneUrl);
  }

  function saveProjectsFolder() {
    localStorage.setItem(PROJECTS_FOLDER_KEY, projectsFolder);
  }

  function loadKnownProjects() {
    const raw = localStorage.getItem(KNOWN_PROJECTS_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as KnownProject[];
      knownProjects = parsed.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    } catch {
      knownProjects = [];
    }
  }

  function saveKnownProject(workspace: WorkspaceStatus | WorkspaceInitResult) {
    const updated = [
      {
        workspacePath: workspace.workspacePath,
        rootPath: workspace.rootPath,
        lastOpenedAt: Date.now(),
      },
      ...knownProjects.filter((item) => item.workspacePath !== workspace.workspacePath),
    ].slice(0, 20);

    knownProjects = updated;
    localStorage.setItem(KNOWN_PROJECTS_KEY, JSON.stringify(updated));
  }

  async function startNewProject(event: Event) {
    event.preventDefault();
    error = "";

    if (!projectsFolder.trim()) {
      error = "Projects folder is required";
      return;
    }
    if (!cloneUrl.trim()) {
      error = "Repository URL is required";
      return;
    }
    if (!folderName.trim()) {
      error = "Folder name is required";
      return;
    }

    saveProjectsFolder();
    cloneProgress = [];
    clonePercent = null;
    clonePhase = "";
    creating = true;

    const unlisten = await onCloneProgress((msg) => {
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
      saveKnownProject(created);
      toast.success(`Workspace created: ${created.workspacePath.split('/').pop()}`);
      await goto(`/workspace?workspace=${encodeURIComponent(created.workspacePath)}`);
    } catch (err) {
      error = String(err);
      toast.error(String(err));
    } finally {
      unlisten();
      creating = false;
    }
  }

  function removeKnownProject(workspacePath: string) {
    knownProjects = knownProjects.filter((p) => p.workspacePath !== workspacePath);
    localStorage.setItem(KNOWN_PROJECTS_KEY, JSON.stringify(knownProjects));
  }

  async function openKnownWorkspace(path: string) {
    error = "";
    opening = true;

    try {
      const status = await inspectWorkspace(path);
      if (!status.isSproutgitProject) {
        throw new Error("Selected path is not a SproutGit project");
      }
      saveKnownProject(status);
      await goto(`/workspace?workspace=${encodeURIComponent(status.workspacePath)}`);
    } catch (err) {
      const msg = String(err);
      if (msg.includes("does not exist") || msg.includes("No such file") || msg.includes("not found") || msg.includes("not a SproutGit project")) {
        removeKnownProject(path);
        toast.error(`Project removed — path no longer exists: ${path.split("/").pop()}`);
      } else {
        error = msg;
      }
    } finally {
      opening = false;
    }
  }

  async function openByPath(event: Event) {
    event.preventDefault();
    if (!openWorkspacePath.trim()) {
      error = "Workspace path is required";
      return;
    }
    error = "";
    opening = true;

    try {
      const status = await inspectWorkspace(openWorkspacePath);
      if (!status.isSproutgitProject) {
        toast.error("Selected path is not a SproutGit workspace");
        return;
      }
      saveKnownProject(status);
      await goto(`/workspace?workspace=${encodeURIComponent(status.workspacePath)}`);
    } catch (err) {
      toast.error(String(err));
    } finally {
      opening = false;
    }
  }

  getGitInfo().then((info) => {
    git = info;
    gitChecked = true;
  });
  loadKnownProjects();
  getGithubAuthStatus().then((s) => {
    githubAuth = s;
    if (s.authenticated) fetchGithubRepos();
  });

  // Default projects folder to ~/Projects on first use
  if (!localStorage.getItem(PROJECTS_FOLDER_KEY)) {
    getHomeDir().then((home) => {
      projectsFolder = `${home}/Projects`;
      saveProjectsFolder();
    }).catch(() => {});
  }
</script>

{#if !gitChecked}
  <main class="flex h-screen items-center justify-center bg-[var(--sg-bg)]">
    <Spinner size="md" label="Checking git…" />
  </main>
{:else if !git.installed}
  <main class="flex h-screen flex-col items-center justify-center gap-6 bg-[var(--sg-bg)] px-8 text-center">
    <div class="text-5xl">🌱</div>
    <h1 class="text-xl font-semibold text-[var(--sg-text)]">Git is not installed</h1>
    <p class="max-w-sm text-sm text-[var(--sg-text-dim)]">
      SproutGit requires Git to manage repositories and worktrees. Please install Git and relaunch the app.
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
  <header data-tauri-drag-region class="flex shrink-0 items-center justify-between border-b border-[var(--sg-border)] bg-[var(--sg-surface)] pt-1 pr-1 pb-1 pl-[76px]">
    <span class="flex items-center gap-1.5 text-sm font-semibold text-[var(--sg-text)]">
      <img src="/logo.svg" alt="" class="h-5 w-5" />
      SproutGit
    </span>
    <div class="flex items-center gap-3">
      {#if githubAuth?.authenticated}
        <span class="flex items-center gap-1.5 text-xs text-[var(--sg-text-dim)]">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
          {githubAuth.username}
        </span>
      {/if}
      <button
        onclick={() => goto("/settings")}
        class="rounded p-1 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
        title="Settings"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
    </div>
  </header>

  <div class="flex min-h-0 flex-1">
    <!-- Left: New project form -->
    <section class="flex w-[380px] shrink-0 flex-col border-r border-[var(--sg-border)] bg-[var(--sg-surface)]">
      <div class="border-b border-[var(--sg-border-subtle)] px-4 py-3">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-[var(--sg-text-dim)]">New project</h2>
      </div>

      <form onsubmit={startNewProject} class="flex flex-col gap-3 overflow-auto p-4">
        <div>
          <label for="projects-folder" class="mb-1 block text-xs text-[var(--sg-text-dim)]">Projects folder</label>
          <div class="flex gap-1.5">
            <input
              id="projects-folder"
              bind:value={projectsFolder}
              oninput={saveProjectsFolder}
              class="min-w-0 flex-1 rounded border border-[var(--sg-input-border)] bg-[var(--sg-input-bg)] px-2.5 py-1.5 text-xs text-[var(--sg-text)] placeholder-[var(--sg-text-faint)] outline-none focus:border-[var(--sg-input-focus)]"
              placeholder="~/Projects"
            />
            <button
              type="button"
              onclick={async () => { const dir = await open({ directory: true, title: "Choose projects folder" }); if (dir) { projectsFolder = dir; saveProjectsFolder(); } }}
              class="shrink-0 rounded border border-[var(--sg-border)] bg-[var(--sg-surface-raised)] px-2.5 py-1.5 text-xs text-[var(--sg-text-dim)] hover:bg-[var(--sg-border)] hover:text-[var(--sg-text)]"
            >Browse</button>
          </div>
        </div>

        <div>
          <label for="repo-url" class="mb-1 flex items-center gap-1.5 text-xs text-[var(--sg-text-dim)]">
            Repository URL
            {#if reposLoading}
              <Spinner size="sm" />
            {/if}
          </label>
          {#if githubRepos.length > 0}
            <Autocomplete
              items={githubRepos}
              bind:value={cloneUrl}
              onselect={handleRepoSelect}
              id="repo-url"
              placeholder="Search repos or paste a URL"
            />
          {:else}
            <input
              id="repo-url"
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
          <label for="folder-name" class="mb-1 block text-xs text-[var(--sg-text-dim)]">Folder name</label>
          <input
            id="folder-name"
            bind:value={folderName}
            oninput={handleFolderNameInput}
            class="w-full rounded border border-[var(--sg-input-border)] bg-[var(--sg-input-bg)] px-2.5 py-1.5 text-xs text-[var(--sg-text)] placeholder-[var(--sg-text-faint)] outline-none focus:border-[var(--sg-input-focus)]"
            placeholder="my-repo"
          />
          {#if workspacePath}
            <p class="mt-1 truncate text-[10px] text-[var(--sg-text-faint)]">{workspacePath}</p>
          {/if}
        </div>

        <button
          type="submit"
          disabled={creating || !git.installed || !workspacePath}
          class="mt-1 rounded bg-[var(--sg-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--sg-bg)] hover:bg-[var(--sg-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {#if creating}<Spinner size="sm" />&nbsp;Cloning…{:else}Clone + create workspace{/if}
        </button>

        {#if creating && cloneProgress.length > 0}
          <div class="flex flex-col gap-1.5">
            {#if clonePercent !== null}
              <div class="flex items-center gap-2">
                <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--sg-border-subtle)]">
                  <div
                    class="h-full rounded-full bg-[var(--sg-primary)] transition-all duration-300"
                    style="width: {clonePercent}%"
                  ></div>
                </div>
                <span class="shrink-0 text-[10px] font-medium text-[var(--sg-text-dim)]">{clonePercent}%</span>
              </div>
            {/if}
            <div
              bind:this={progressEl}
              class="max-h-20 overflow-auto rounded border border-[var(--sg-border-subtle)] bg-[var(--sg-input-bg)] px-2.5 py-1.5"
            >
              {#each cloneProgress as line}
                <p class="font-mono text-[10px] text-[var(--sg-text-dim)]">{line}</p>
              {/each}
            </div>
          </div>
        {/if}
      </form>

      {#if createdWorkspace}
        <div class="mx-4 mb-3 rounded border border-[var(--sg-border)] bg-[var(--sg-surface-raised)] px-2.5 py-1.5 text-xs text-[var(--sg-primary)]">
          Created: {createdWorkspace.workspacePath}
        </div>
      {/if}

      {#if error}
        <div class="mx-4 mb-3 rounded border border-[var(--sg-border)] bg-[var(--sg-surface-raised)] px-2.5 py-1.5 text-xs text-[var(--sg-danger)]">
          {error}
        </div>
      {/if}

      <!-- Open existing -->
      <div class="mt-auto border-t border-[var(--sg-border-subtle)] p-4">
        <form onsubmit={openByPath}>
          <label for="open-workspace-path" class="mb-1 block text-xs text-[var(--sg-text-dim)]">Open existing workspace</label>
          <div class="flex gap-1.5">
            <input
              id="open-workspace-path"
              bind:value={openWorkspacePath}
              class="min-w-0 flex-1 rounded border border-[var(--sg-input-border)] bg-[var(--sg-input-bg)] px-2.5 py-1.5 text-xs text-[var(--sg-text)] placeholder-[var(--sg-text-faint)] outline-none focus:border-[var(--sg-input-focus)]"
              placeholder="~/Projects/existing-project"
            />
            <button
              type="button"
              onclick={async () => { const dir = await open({ directory: true, title: "Open existing workspace" }); if (dir) openWorkspacePath = dir; }}
              class="shrink-0 rounded border border-[var(--sg-border)] bg-[var(--sg-surface-raised)] px-2.5 py-1.5 text-xs text-[var(--sg-text-dim)] hover:bg-[var(--sg-border)] hover:text-[var(--sg-text)]"
            >Browse</button>
            <button
              type="submit"
              class="shrink-0 rounded border border-[var(--sg-border)] bg-[var(--sg-surface-raised)] px-2.5 py-1.5 text-xs text-[var(--sg-text-dim)] hover:bg-[var(--sg-border)] hover:text-[var(--sg-text)]"
            >Open</button>
          </div>
        </form>
      </div>
    </section>

    <!-- Right: Known projects list -->
    <section class="flex min-w-0 flex-1 flex-col">
      <div class="border-b border-[var(--sg-border-subtle)] bg-[var(--sg-surface)] px-4 py-3">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-[var(--sg-text-dim)]">Recent projects</h2>
      </div>

      <div class="flex-1 overflow-auto p-4">
        {#if knownProjects.length === 0}
          <div class="flex h-full items-center justify-center">
            <p class="text-sm text-[var(--sg-text-faint)]">No projects yet. Clone a repo to get started.</p>
          </div>
        {:else}
          <div class="space-y-1">
            {#each knownProjects as project}
              <div class="group flex items-center gap-0 rounded hover:bg-[var(--sg-surface-raised)]">
                <button
                  class="flex min-w-0 flex-1 items-center gap-3 rounded px-3 py-2 text-left"
                  onclick={() => openKnownWorkspace(project.workspacePath)}
                  disabled={opening}
                >
                  <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[var(--sg-surface-raised)] text-sm text-[var(--sg-primary)]">
                    {project.workspacePath.split("/").pop()?.charAt(0).toUpperCase() ?? "?"}
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium text-[var(--sg-text)]">{project.workspacePath.split("/").pop()}</p>
                    <p class="truncate text-xs text-[var(--sg-text-faint)]">{project.workspacePath}</p>
                  </div>
                  <span class="shrink-0 text-xs text-[var(--sg-text-faint)]">&rarr;</span>
                </button>
                <button
                  class="shrink-0 rounded p-1.5 mr-2 text-[var(--sg-text-faint)] opacity-0 transition-opacity hover:text-[var(--sg-danger)] group-hover:opacity-100"
                  title="Remove from recent projects"
                  onclick={(e) => { e.stopPropagation(); removeKnownProject(project.workspacePath); toast.info(`Removed ${project.workspacePath.split("/").pop()} from recent projects`); }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  </div>
</main>
{/if}
