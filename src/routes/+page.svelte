<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";

  type GitInfo = {
    installed: boolean;
    version?: string | null;
  };

  type WorktreeInfo = {
    path: string;
    head?: string | null;
    branch?: string | null;
    detached: boolean;
  };

  type WorktreeListResult = {
    repoPath: string;
    worktrees: WorktreeInfo[];
  };

  let git = $state<GitInfo>({ installed: false, version: null });
  let repoPath = $state("");
  let result = $state<WorktreeListResult | null>(null);
  let activeWorktreePath = $state<string | null>(null);
  let loading = $state(false);
  let error = $state("");

  async function loadGitInfo() {
    git = await invoke<GitInfo>("git_info");
  }

  async function loadWorktrees(event: Event) {
    event.preventDefault();
    loading = true;
    error = "";

    try {
      result = await invoke<WorktreeListResult>("list_worktrees", { repoPath });
      activeWorktreePath = result.worktrees[0]?.path ?? null;
    } catch (err) {
      result = null;
      activeWorktreePath = null;
      error = String(err);
    } finally {
      loading = false;
    }
  }

  function isManaged(path: string): boolean {
    if (!result) return false;
    return path.startsWith(`${result.repoPath}/.worktrees/`);
  }

  const selectedWorktree = $derived(
    result?.worktrees.find((wt) => wt.path === activeWorktreePath) ?? null,
  );

  const managedWorktrees = $derived(
    result?.worktrees.filter((wt) => isManaged(wt.path)) ?? [],
  );

  const externalWorktrees = $derived(
    result?.worktrees.filter((wt) => !isManaged(wt.path)) ?? [],
  );

  const activeBranch = $derived(
    selectedWorktree?.branch ?? (selectedWorktree?.detached ? "detached" : "unknown"),
  );

  const stagedFiles = [
    { status: "M", path: "src/routes/+page.svelte" },
    { status: "A", path: "docs/requirements.md" },
  ];

  const unstagedFiles = [
    { status: "M", path: "src-tauri/src/lib.rs" },
    { status: "D", path: "src/lib/legacy-theme.css" },
  ];

  loadGitInfo();
</script>

<main class="min-h-screen p-3 text-[13px] text-[var(--sprout-ink)] md:p-4">
  <div class="mx-auto flex max-w-[1700px] flex-col gap-3">
    <header class="rounded-xl border border-[var(--sprout-border)] bg-[var(--sprout-surface)] px-3 py-2 shadow-sm">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <span class="rounded bg-[#244f2f] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">repo</span>
          <span class="truncate font-medium">{result?.repoPath ?? "No repository selected"}</span>
          <span class="text-[var(--sprout-muted)]">&gt;</span>
          <span class="rounded bg-[#486e4b] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">worktree</span>
          <span class="truncate font-medium">{selectedWorktree?.path ?? "none"}</span>
          <span class="text-[var(--sprout-muted)]">&gt;</span>
          <span class="rounded bg-[#7a4f2c] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">branch</span>
          <span class="truncate font-medium">{activeBranch}</span>
        </div>
        <div class="rounded-md border border-[var(--sprout-border)] bg-[#f7f2e7] px-2 py-1 text-[11px] font-medium">
          {#if git.installed}
            Git: {git.version}
          {:else}
            Git not detected
          {/if}
        </div>
      </div>
    </header>

    <form
      onsubmit={loadWorktrees}
      class="grid gap-2 rounded-xl border border-[var(--sprout-border)] bg-[var(--sprout-surface)] p-3 shadow-sm md:grid-cols-[1fr_auto]"
    >
      <input
        bind:value={repoPath}
        class="rounded-md border border-[var(--sprout-border)] bg-white px-3 py-2 outline-none transition focus:border-[#2f6b3c]"
        placeholder="Repository path, e.g. /Users/liam/Projects/sproutgit"
      />
      <button
        type="submit"
        disabled={loading || !git.installed}
        class="rounded-md bg-[#2f6b3c] px-4 py-2 font-semibold text-white transition hover:bg-[#244f2f] disabled:cursor-not-allowed disabled:bg-[#9fb49f]"
      >
        {#if loading}Loading...{:else}Load Repository{/if}
      </button>
      {#if error}
        <p class="md:col-span-2 rounded-md border border-[#d8b4aa] bg-[#fff3f0] px-3 py-2 text-[#8a2616]">{error}</p>
      {/if}
    </form>

    <section class="grid min-h-[72vh] gap-3 xl:grid-cols-[220px_320px_1fr_360px]">
      <aside class="rounded-xl border border-[var(--sprout-border)] bg-[var(--sprout-surface)] p-2 shadow-sm">
        <h2 class="px-2 pb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--sprout-muted)]">Repositories</h2>
        <ul class="space-y-1">
          <li class="rounded-md border border-[#bcd3bf] bg-[#eff8f1] px-2 py-2">
            <p class="truncate font-semibold">{result?.repoPath ?? "No active repo"}</p>
            <p class="text-[11px] text-[var(--sprout-muted)]">Active</p>
          </li>
        </ul>
      </aside>

      <aside class="rounded-xl border border-[var(--sprout-border)] bg-[var(--sprout-surface)] p-2 shadow-sm">
        <div class="mb-2 flex items-center justify-between px-2">
          <h2 class="text-[11px] font-bold uppercase tracking-wide text-[var(--sprout-muted)]">Worktrees</h2>
          <span class="rounded bg-[#e7efe7] px-2 py-1 text-[10px] font-semibold text-[#2f6b3c]">managed first</span>
        </div>

        <div class="space-y-1">
          <p class="px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--sprout-muted)]">Managed (.worktrees)</p>
          {#if managedWorktrees.length === 0}
            <p class="px-2 py-1 text-[11px] text-[var(--sprout-muted)]">No managed worktrees</p>
          {/if}
          {#each managedWorktrees as wt}
            <button
              class="w-full rounded-md border px-2 py-2 text-left transition hover:bg-[#f4f8f4] {wt.path === activeWorktreePath ? 'border-[#6aa076] bg-[#edf6ee]' : 'border-[var(--sprout-border)] bg-white'}"
              onclick={() => (activeWorktreePath = wt.path)}
            >
              <p class="font-semibold">{wt.branch ?? (wt.detached ? "detached" : "unknown")}</p>
              <p class="truncate text-[11px] text-[var(--sprout-muted)]">{wt.path}</p>
            </button>
          {/each}
        </div>

        <div class="mt-3 space-y-1">
          <p class="px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--sprout-muted)]">External</p>
          {#if externalWorktrees.length === 0}
            <p class="px-2 py-1 text-[11px] text-[var(--sprout-muted)]">No external worktrees</p>
          {/if}
          {#each externalWorktrees as wt}
            <button
              class="w-full rounded-md border border-[var(--sprout-border)] bg-white px-2 py-2 text-left transition hover:bg-[#f8f6f2]"
              onclick={() => (activeWorktreePath = wt.path)}
            >
              <p class="font-semibold">{wt.branch ?? (wt.detached ? "detached" : "unknown")}</p>
              <p class="truncate text-[11px] text-[var(--sprout-muted)]">{wt.path}</p>
            </button>
          {/each}
        </div>
      </aside>

      <section class="rounded-xl border border-[var(--sprout-border)] bg-[var(--sprout-surface)] p-2 shadow-sm">
        <div class="mb-2 flex items-center justify-between px-2">
          <h2 class="text-[11px] font-bold uppercase tracking-wide text-[var(--sprout-muted)]">Status</h2>
          <span class="text-[11px] text-[var(--sprout-muted)]">{stagedFiles.length} staged, {unstagedFiles.length} unstaged</span>
        </div>

        <div class="grid gap-2 md:grid-cols-2">
          <div class="rounded-md border border-[var(--sprout-border)] bg-white p-2">
            <p class="mb-2 text-[10px] font-bold uppercase tracking-wide text-[#2f6b3c]">Staged</p>
            <ul class="space-y-1">
              {#each stagedFiles as file}
                <li class="flex items-center gap-2 rounded border border-[#dfe8df] px-2 py-1">
                  <span class="inline-flex h-5 min-w-5 items-center justify-center rounded bg-[#e7efe7] text-[10px] font-bold text-[#2f6b3c]">{file.status}</span>
                  <span class="truncate">{file.path}</span>
                </li>
              {/each}
            </ul>
          </div>

          <div class="rounded-md border border-[var(--sprout-border)] bg-white p-2">
            <p class="mb-2 text-[10px] font-bold uppercase tracking-wide text-[#7a4f2c]">Unstaged</p>
            <ul class="space-y-1">
              {#each unstagedFiles as file}
                <li class="flex items-center gap-2 rounded border border-[#eadfce] px-2 py-1">
                  <span class="inline-flex h-5 min-w-5 items-center justify-center rounded bg-[#f6efe3] text-[10px] font-bold text-[#7a4f2c]">{file.status}</span>
                  <span class="truncate">{file.path}</span>
                </li>
              {/each}
            </ul>
          </div>
        </div>
      </section>

      <section class="rounded-xl border border-[var(--sprout-border)] bg-[var(--sprout-surface)] p-2 shadow-sm">
        <div class="mb-2 px-2">
          <h2 class="text-[11px] font-bold uppercase tracking-wide text-[var(--sprout-muted)]">Diff and Commit</h2>
        </div>

        <div class="rounded-md border border-[var(--sprout-border)] bg-white p-2">
          <p class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--sprout-muted)]">Diff preview</p>
          <pre class="h-52 overflow-auto rounded bg-[#1e2320] p-2 text-[11px] leading-relaxed text-[#d8e2d8]"><code>@@ -12,7 +12,10 @@
+&lt;section class="context-cascade"&gt;
+  Repo &gt; Worktree &gt; Branch
+&lt;/section&gt;
 const status = await listWorktrees(repoPath);
 </code></pre>
        </div>

        <div class="mt-2 rounded-md border border-[var(--sprout-border)] bg-white p-2">
          <p class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--sprout-muted)]">Commit message</p>
          <textarea
            class="h-28 w-full resize-none rounded-md border border-[var(--sprout-border)] px-2 py-2 outline-none focus:border-[#2f6b3c]"
            placeholder="feat(worktrees): enforce managed path policy"
          ></textarea>
          <button class="mt-2 w-full rounded-md bg-[#2f6b3c] px-3 py-2 font-semibold text-white transition hover:bg-[#244f2f]">
            Commit [Cmd+K]
          </button>
        </div>
      </section>
    </section>
  </div>
</main>
