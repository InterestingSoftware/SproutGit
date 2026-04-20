<script lang="ts">
  import { goto } from "$app/navigation";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import Spinner from "$lib/components/Spinner.svelte";
  import WindowControls from "$lib/components/WindowControls.svelte";
  import {
    getGitInfo,
    getGithubAuthStatus,
    githubDeviceFlowStart,
    githubDeviceFlowPoll,
    githubLogout,
    detectEditors,
    getGitConfig,
    setGitConfig,
    type GitInfo,
    type GitHubAuthStatus,
    type DeviceCodeResponse,
    type EditorInfo,
  } from "$lib/sproutgit";
  import { toast } from "$lib/toast.svelte";

  // ── GitHub Auth State ──
  let githubAuth = $state<GitHubAuthStatus | null>(null);
  let deviceCode = $state<DeviceCodeResponse | null>(null);
  let authPolling = $state(false);
  let authStarting = $state(false);

  // ── Editor State ──
  let editors = $state<EditorInfo[]>([]);
  let currentEditor = $state("");
  let customEditor = $state("");
  let editorsLoading = $state(true);

  // ── Git State ──
  let gitInfo = $state<GitInfo | null>(null);

  // Keep workspace context for back navigation.
  const initialWorkspacePath =
    typeof window !== "undefined"
      ? new URL(window.location.href).searchParams.get("workspace") ?? ""
      : "";
  let workspacePath = $state(initialWorkspacePath);

  // Load initial state
  getGitInfo().then((info) => { gitInfo = info; });
  getGithubAuthStatus().then((s) => { githubAuth = s; });

  Promise.all([
    detectEditors(),
    getGitConfig("core.editor"),
  ]).then(([detected, configured]) => {
    editors = detected;
    currentEditor = configured;
    // If the current editor doesn't match any known editor, put it in custom
    if (configured && !detected.some((e) => e.installed && matchesEditor(e, configured))) {
      customEditor = configured;
    }
    editorsLoading = false;
  }).catch(() => {
    editorsLoading = false;
  });

  function matchesEditor(editor: EditorInfo, configured: string): boolean {
    // Strip quotes and extract the command portion (before --wait etc)
    const stripped = configured.replace(/^["']|["']$/g, "");
    const cmd = stripped.split(/\s+--?\w/)[0].trim();
    return cmd === editor.command || stripped.startsWith(editor.command);
  }

  function editorCommand(editor: EditorInfo): string {
    // Editors that benefit from --wait for git operations
    const waitIds = ["vscode", "cursor", "windsurf", "kiro", "sublime", "zed"];
    const needsWait = waitIds.includes(editor.id);
    const cmd = editor.command.includes(" ") ? `"${editor.command}"` : editor.command;
    return needsWait ? `${cmd} --wait` : cmd;
  }

  async function selectEditor(editor: EditorInfo) {
    const cmd = editorCommand(editor);
    try {
      await setGitConfig("core.editor", cmd);
      currentEditor = cmd;
      customEditor = "";
      toast.success(`Editor set to ${editor.name}`);
    } catch (err) {
      toast.error(String(err));
    }
  }

  async function saveCustomEditor() {
    const value = customEditor.trim();
    try {
      await setGitConfig("core.editor", value);
      currentEditor = value;
      toast.success(value ? `Editor set to "${value}"` : "Editor config cleared");
    } catch (err) {
      toast.error(String(err));
    }
  }

  async function startGithubLogin() {
    authStarting = true;
    try {
      const dc = await githubDeviceFlowStart();
      deviceCode = dc;
      try {
        await navigator.clipboard.writeText(dc.userCode);
        toast.info(`Code ${dc.userCode} copied to clipboard`);
      } catch {
        toast.info(`Enter code: ${dc.userCode}`);
      }
      await openUrl(dc.verificationUri);
      pollForToken(dc.deviceCode, dc.interval);
    } catch (err) {
      toast.error(String(err));
    } finally {
      authStarting = false;
    }
  }

  async function pollForToken(code: string, interval: number) {
    authPolling = true;
    const poll = async () => {
      try {
        const result = await githubDeviceFlowPoll(code);
        if (result.status === "complete") {
          authPolling = false;
          deviceCode = null;
          githubAuth = { authenticated: true, username: result.username, provider: "github" };
          toast.success(`Signed in as ${result.username ?? "GitHub user"}`);
          return;
        }
        if (result.status === "expired" || result.status === "error") {
          authPolling = false;
          deviceCode = null;
          toast.error(result.error ?? "Authentication failed");
          return;
        }
        setTimeout(poll, (interval + 1) * 1000);
      } catch (err) {
        authPolling = false;
        deviceCode = null;
        toast.error(String(err));
      }
    };
    setTimeout(poll, interval * 1000);
  }

  async function handleGithubLogout() {
    try {
      await githubLogout();
      githubAuth = { authenticated: false, username: null, provider: "github" };
      toast.info("Signed out of GitHub");
    } catch (err) {
      toast.error(String(err));
    }
  }

  let installedEditors = $derived(editors.filter((e) => e.installed));
  let unavailableEditors = $derived(editors.filter((e) => !e.installed));
</script>

<main class="flex h-screen flex-col">
  <header data-tauri-drag-region class="flex shrink-0 items-center gap-3 border-b border-[var(--sg-border)] bg-[var(--sg-surface)] pt-1 pr-1 pb-1 pl-[var(--sg-titlebar-inset)]">
    <button
      onclick={() =>
        goto(
          workspacePath
            ? `/workspace?workspace=${encodeURIComponent(workspacePath)}`
            : "/",
        )}
      class="rounded px-2 py-0.5 text-xs text-[var(--sg-text-dim)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
    >
      &larr; Projects
    </button>
    <div class="h-3 w-px bg-[var(--sg-border)]"></div>
    <span class="text-xs font-medium text-[var(--sg-text)]">Settings</span>
    <div class="ml-auto">
      <WindowControls />
    </div>
  </header>

  <div class="flex-1 overflow-auto p-6">
    <div class="mx-auto flex max-w-xl flex-col gap-8">

      <!-- GitHub Authentication -->
      <section>
        <h2 class="mb-1 text-sm font-semibold text-[var(--sg-text)]">GitHub</h2>
        <p class="mb-4 text-xs text-[var(--sg-text-faint)]">Authenticate with GitHub to clone private repositories and access your repos.</p>

        {#if githubAuth === null}
          <div class="flex items-center gap-2 text-xs text-[var(--sg-text-dim)]">
            <Spinner size="sm" />
            Checking…
          </div>
        {:else if githubAuth.authenticated}
          <div class="flex items-center justify-between rounded-lg border border-[var(--sg-border)] bg-[var(--sg-surface)] px-4 py-3">
            <div class="flex items-center gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" class="text-[var(--sg-text-dim)]"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
              <div>
                <div class="text-sm font-medium text-[var(--sg-text)]">{githubAuth.username}</div>
                <div class="text-xs text-[var(--sg-text-faint)]">Connected</div>
              </div>
            </div>
            <button
              class="rounded border border-[var(--sg-border)] px-3 py-1.5 text-xs text-[var(--sg-text-dim)] hover:border-[var(--sg-danger)] hover:text-[var(--sg-danger)]"
              onclick={handleGithubLogout}
            >Sign out</button>
          </div>
        {:else if authPolling}
          <div class="rounded-lg border border-[var(--sg-border)] bg-[var(--sg-surface)] px-4 py-4">
            <div class="flex items-center gap-2 text-sm text-[var(--sg-text-dim)]">
              <Spinner size="sm" />
              Waiting for GitHub authorization…
            </div>
            {#if deviceCode}
              <div class="mt-3 flex items-center gap-2 text-xs text-[var(--sg-text-faint)]">
                Your code:
                <code class="rounded bg-[var(--sg-surface-raised)] px-2 py-1 font-mono text-sm font-semibold text-[var(--sg-primary)]">{deviceCode.userCode}</code>
              </div>
            {/if}
          </div>
        {:else}
          <button
            class="flex items-center gap-2 rounded-lg border border-[var(--sg-border)] bg-[var(--sg-surface)] px-4 py-3 text-sm text-[var(--sg-text)] hover:bg-[var(--sg-surface-raised)] disabled:opacity-40"
            onclick={startGithubLogin}
            disabled={authStarting}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
            {#if authStarting}
              <Spinner size="sm" />
            {/if}
            Sign in with GitHub
          </button>
        {/if}
      </section>

      <!-- Git Editor -->
      <section>
        <h2 class="mb-1 text-sm font-semibold text-[var(--sg-text)]">Editor</h2>
        <p class="mb-4 text-xs text-[var(--sg-text-faint)]">Choose the editor that Git uses for commit messages, interactive rebase, etc. Sets <code class="rounded bg-[var(--sg-surface-raised)] px-1 font-mono">core.editor</code> in your global Git config.</p>

        {#if editorsLoading}
          <div class="flex items-center gap-2 text-xs text-[var(--sg-text-dim)]">
            <Spinner size="sm" />
            Detecting editors…
          </div>
        {:else}
          <!-- Installed editors -->
          {#if installedEditors.length > 0}
            <div class="mb-3 flex flex-wrap gap-2">
              {#each installedEditors as editor}
                {@const isActive = currentEditor && matchesEditor(editor, currentEditor)}
                <button
                  class="rounded-md border px-3 py-1.5 text-xs transition-colors {isActive
                    ? 'border-[var(--sg-primary)] bg-[var(--sg-primary)]/10 text-[var(--sg-primary)] font-medium'
                    : 'border-[var(--sg-border)] text-[var(--sg-text-dim)] hover:border-[var(--sg-text-faint)] hover:text-[var(--sg-text)]'}"
                  onclick={() => selectEditor(editor)}
                >
                  {editor.name}
                </button>
              {/each}
            </div>
          {/if}

          <!-- Current value -->
          <div class="mb-3 rounded-lg border border-[var(--sg-border)] bg-[var(--sg-surface)] px-4 py-3">
            <div class="mb-1 text-xs text-[var(--sg-text-faint)]">Current value</div>
            <code class="text-xs text-[var(--sg-text)]">{currentEditor || "(not set)"}</code>
          </div>

          <!-- Custom editor input -->
          <div>
            <label for="custom-editor" class="mb-1 block text-xs text-[var(--sg-text-dim)]">Custom command</label>
            <div class="flex gap-1.5">
              <input
                id="custom-editor"
                bind:value={customEditor}
                class="min-w-0 flex-1 rounded border border-[var(--sg-input-border)] bg-[var(--sg-input-bg)] px-2.5 py-1.5 font-mono text-xs text-[var(--sg-text)] placeholder-[var(--sg-text-faint)] outline-none focus:border-[var(--sg-input-focus)]"
                placeholder="e.g. vim, emacs, code --wait"
                spellcheck="false"
                autocorrect="off"
                autocapitalize="off"
              />
              <button
                class="shrink-0 rounded border border-[var(--sg-border)] bg-[var(--sg-surface-raised)] px-3 py-1.5 text-xs text-[var(--sg-text-dim)] hover:bg-[var(--sg-border)] hover:text-[var(--sg-text)]"
                onclick={saveCustomEditor}
              >Save</button>
            </div>
          </div>

          <!-- Unavailable editors (dimmed) -->
          {#if unavailableEditors.length > 0}
            <div class="mt-4">
              <div class="mb-1.5 text-xs text-[var(--sg-text-faint)]">Not found on system</div>
              <div class="flex flex-wrap gap-2">
                {#each unavailableEditors as editor}
                  <span class="rounded-md border border-[var(--sg-border-subtle)] px-3 py-1.5 text-xs text-[var(--sg-text-faint)] opacity-50">
                    {editor.name}
                  </span>
                {/each}
              </div>
            </div>
          {/if}
        {/if}
      </section>

      <section>
        <h2 class="mb-1 text-sm font-semibold text-[var(--sg-text)]">Workspace hooks</h2>
        <p class="mb-4 text-xs text-[var(--sg-text-faint)]">Hook management moved to the workspace screen for better context.</p>
        <div class="rounded-lg border border-[var(--sg-border)] bg-[var(--sg-surface)] px-4 py-3 text-xs text-[var(--sg-text-dim)]">
          Open a workspace and use the <span class="font-semibold text-[var(--sg-text)]">Hooks</span> button in the top bar.
        </div>
      </section>

      <!-- Git -->
      <section>
        <h2 class="mb-1 text-sm font-semibold text-[var(--sg-text)]">Git</h2>
        <p class="mb-4 text-xs text-[var(--sg-text-faint)]">Information about the Git installation SproutGit is using.</p>
        <div class="rounded-lg border border-[var(--sg-border)] bg-[var(--sg-surface)] px-4 py-3">
          {#if gitInfo === null}
            <div class="flex items-center gap-2 text-xs text-[var(--sg-text-dim)]">
              <Spinner size="sm" />
              Checking…
            </div>
          {:else if gitInfo.installed}
            <div class="text-sm text-[var(--sg-text)]">{gitInfo.version}</div>
          {:else}
            <div class="text-sm text-[var(--sg-danger)]">Git not found</div>
          {/if}
        </div>
      </section>

    </div>
  </div>
</main>
