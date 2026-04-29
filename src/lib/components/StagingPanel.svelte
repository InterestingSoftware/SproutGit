<script lang="ts">
  import {
    getWorktreeStatus,
    stageFiles,
    unstageFiles,
    createCommit,
    getWorkingDiff,
    type StatusFileEntry,
    type WorktreeStatusResult,
  } from '$lib/sproutgit';
  import { toast } from '$lib/toast.svelte';
  import { validateCommitMessage } from '$lib/validation';
  import Spinner from './Spinner.svelte';
  import hljs from 'highlight.js/lib/core';
  import typescript from 'highlight.js/lib/languages/typescript';
  import javascript from 'highlight.js/lib/languages/javascript';
  import rust from 'highlight.js/lib/languages/rust';
  import css from 'highlight.js/lib/languages/css';
  import json from 'highlight.js/lib/languages/json';
  import xml from 'highlight.js/lib/languages/xml';
  import bash from 'highlight.js/lib/languages/bash';
  import markdown from 'highlight.js/lib/languages/markdown';
  import yaml from 'highlight.js/lib/languages/yaml';
  import sql from 'highlight.js/lib/languages/sql';
  import python from 'highlight.js/lib/languages/python';
  import go from 'highlight.js/lib/languages/go';

  hljs.registerLanguage('typescript', typescript);
  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('rust', rust);
  hljs.registerLanguage('css', css);
  hljs.registerLanguage('json', json);
  hljs.registerLanguage('xml', xml);
  hljs.registerLanguage('bash', bash);
  hljs.registerLanguage('markdown', markdown);
  hljs.registerLanguage('yaml', yaml);
  hljs.registerLanguage('sql', sql);
  hljs.registerLanguage('python', python);
  hljs.registerLanguage('go', go);

  type Props = {
    worktreePath: string;
    branch: string | null;
    oncommit: () => void;
    onclose: () => void;
    /** Called whenever the total changed-file count changes (after load/stage/commit). */
    onstatuschange?: (count: number) => void;
    /** Increment to trigger a status reload from outside (e.g., file watcher). */
    refreshSignal?: number;
  };

  const {
    worktreePath,
    branch,
    oncommit,
    onclose,
    onstatuschange,
    refreshSignal = 0,
  }: Props = $props();

  let statusFiles = $state<StatusFileEntry[]>([]);
  let loading = $state(true);
  let staging = $state<string | null>(null);
  let stagingAll = $state(false);
  let unstaging = $state<string | null>(null);
  let unstagingAll = $state(false);
  let committing = $state(false);
  let commitMessage = $state('');
  let commitTouched = $state(false);

  // Diff state
  let diffContent = $state('');
  let diffLoading = $state(false);
  let diffFile = $state<string | null>(null);
  let diffStaged = $state(false);

  const commitError = $derived(commitTouched ? validateCommitMessage(commitMessage) : null);

  const stagedFiles = $derived(
    statusFiles.filter(f => f.indexStatus !== ' ' && f.indexStatus !== '?')
  );

  const unstagedFiles = $derived(statusFiles.filter(f => f.workTreeStatus !== ' '));

  const hasStagedChanges = $derived(stagedFiles.length > 0);

  async function loadStatus() {
    loading = true;
    try {
      const result: WorktreeStatusResult = await getWorktreeStatus(worktreePath);
      statusFiles = result.files;
    } catch (err) {
      toast.error(`Failed to load status: ${err}`);
    } finally {
      loading = false;
    }
  }

  async function handleStageFile(path: string) {
    staging = path;
    try {
      const result = await stageFiles(worktreePath, [path]);
      statusFiles = result.files;
      // If we were viewing this file's unstaged diff, refresh
      if (diffFile === path && !diffStaged) {
        await loadDiff(path, false);
      }
    } catch (err) {
      toast.error(`Failed to stage: ${err}`);
    } finally {
      staging = null;
    }
  }

  async function handleUnstageFile(path: string) {
    unstaging = path;
    try {
      const result = await unstageFiles(worktreePath, [path]);
      statusFiles = result.files;
      // If we were viewing this file's staged diff, refresh
      if (diffFile === path && diffStaged) {
        await loadDiff(path, true);
      }
    } catch (err) {
      toast.error(`Failed to unstage: ${err}`);
    } finally {
      unstaging = null;
    }
  }

  async function handleStageAll() {
    stagingAll = true;
    try {
      const result = await stageFiles(worktreePath, []);
      statusFiles = result.files;
      diffContent = '';
      diffFile = null;
    } catch (err) {
      toast.error(`Failed to stage all: ${err}`);
    } finally {
      stagingAll = false;
    }
  }

  async function handleUnstageAll() {
    unstagingAll = true;
    try {
      const result = await unstageFiles(worktreePath, []);
      statusFiles = result.files;
      diffContent = '';
      diffFile = null;
    } catch (err) {
      toast.error(`Failed to unstage all: ${err}`);
    } finally {
      unstagingAll = false;
    }
  }

  async function handleCommit() {
    commitTouched = true;
    if (validateCommitMessage(commitMessage)) return;

    committing = true;
    try {
      const result = await createCommit(worktreePath, commitMessage);
      toast.success(`Committed: ${result.shortHash} ${result.subject}`);
      commitMessage = '';
      commitTouched = false;
      diffContent = '';
      diffFile = null;
      await loadStatus();
      oncommit();
    } catch (err) {
      toast.error(`Commit failed: ${err}`);
    } finally {
      committing = false;
    }
  }

  async function loadDiff(path: string, staged: boolean) {
    diffFile = path;
    diffStaged = staged;
    diffLoading = true;
    try {
      const result = await getWorkingDiff(worktreePath, staged, path);
      diffContent = result.diff;
    } catch (err) {
      toast.error(`Failed to load diff: ${err}`);
      diffContent = '';
    } finally {
      diffLoading = false;
    }
  }

  function handleFileClick(path: string, staged: boolean) {
    if (diffFile === path && diffStaged === staged) {
      // Toggle off
      diffFile = null;
      diffContent = '';
    } else {
      loadDiff(path, staged);
    }
  }

  function statusIcon(status: string): string {
    switch (status) {
      case 'M':
        return 'M';
      case 'A':
        return 'A';
      case 'D':
        return 'D';
      case 'R':
        return 'R';
      case 'C':
        return 'C';
      case '?':
        return '?';
      case 'U':
        return 'U';
      default:
        return status;
    }
  }

  function statusColor(status: string): string {
    switch (status) {
      case 'M':
        return 'var(--sg-warning)';
      case 'A':
      case '?':
        return 'var(--sg-primary)';
      case 'D':
        return 'var(--sg-danger)';
      case 'R':
      case 'C':
        return 'var(--sg-accent)';
      case 'U':
        return 'var(--sg-danger)';
      default:
        return 'var(--sg-text-dim)';
    }
  }

  function displayStatus(file: StatusFileEntry, forStaged: boolean): string {
    return forStaged ? file.indexStatus : file.workTreeStatus;
  }

  // Parse unified diff into structured lines with line numbers
  type DiffLine = {
    type: 'header' | 'hunk' | 'add' | 'del' | 'context' | 'empty';
    content: string;
    oldNum: number | null;
    newNum: number | null;
  };

  const parsedDiff = $derived.by((): DiffLine[] => {
    if (!diffContent) return [];
    const lines = diffContent.split('\n');
    const result: DiffLine[] = [];
    let oldLine = 0;
    let newLine = 0;
    for (const line of lines) {
      if (
        line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('---') ||
        line.startsWith('+++')
      ) {
        result.push({ type: 'header', content: line, oldNum: null, newNum: null });
      } else if (line.startsWith('@@')) {
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          oldLine = parseInt(match[1], 10);
          newLine = parseInt(match[2], 10);
        }
        result.push({ type: 'hunk', content: line, oldNum: null, newNum: null });
      } else if (line.startsWith('+')) {
        result.push({ type: 'add', content: line.slice(1), oldNum: null, newNum: newLine });
        newLine++;
      } else if (line.startsWith('-')) {
        result.push({ type: 'del', content: line.slice(1), oldNum: oldLine, newNum: null });
        oldLine++;
      } else if (line === '') {
        result.push({ type: 'empty', content: '', oldNum: null, newNum: null });
      } else {
        const content = line.startsWith(' ') ? line.slice(1) : line;
        result.push({ type: 'context', content, oldNum: oldLine, newNum: newLine });
        oldLine++;
        newLine++;
      }
    }
    return result;
  });

  const extToLang: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    svelte: 'xml',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    rs: 'rust',
    css: 'css',
    scss: 'css',
    less: 'css',
    json: 'json',
    html: 'xml',
    svg: 'xml',
    sh: 'bash',
    zsh: 'bash',
    bash: 'bash',
    md: 'markdown',
    yml: 'yaml',
    yaml: 'yaml',
    sql: 'sql',
    py: 'python',
    go: 'go',
    toml: 'bash',
  };

  function langForFile(path: string | null): string | null {
    if (!path) return null;
    const ext = path.split('.').pop()?.toLowerCase();
    return ext ? (extToLang[ext] ?? null) : null;
  }

  const highlightedLines = $derived.by((): Map<number, string> => {
    const map = new Map<number, string>();
    const lang = langForFile(diffFile);
    if (!lang) return map;
    const codeIndices: number[] = [];
    const codeLines: string[] = [];
    for (let i = 0; i < parsedDiff.length; i++) {
      const line = parsedDiff[i];
      if (line.type === 'add' || line.type === 'del' || line.type === 'context') {
        codeIndices.push(i);
        codeLines.push(line.content);
      }
    }
    if (codeLines.length === 0) return map;
    try {
      for (let i = 0; i < codeIndices.length; i++) {
        const result = hljs.highlight(codeLines[i], { language: lang, ignoreIllegals: true });
        map.set(codeIndices[i], result.value);
      }
    } catch {
      // Highlighting failed, return empty map
    }
    return map;
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (hasStagedChanges && !committing) {
        handleCommit();
      }
    }
  }

  // Initial load + reload whenever refreshSignal is incremented from outside.
  $effect(() => {
    void refreshSignal; // track as dependency
    loadStatus();
  });

  // Keep parent change-count badge in sync.
  $effect(() => {
    if (!loading) {
      onstatuschange?.(statusFiles.length);
    }
  });
</script>

<div class="flex h-full flex-col overflow-hidden">
  <!-- Header -->
  <div
    class="relative flex items-center justify-between border-b border-[var(--sg-border-subtle)] bg-gradient-to-b from-[var(--sg-primary)]/6 to-[var(--sg-surface)] px-4 py-2"
  >
    <span
      aria-hidden="true"
      class="absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-r-full bg-[var(--sg-primary)]"
    ></span>
    <div class="flex items-center gap-2">
      <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sg-text-dim)]">
        Changes
      </p>
      {#if branch}
        <span class="font-mono text-[10px] text-[var(--sg-primary)]">{branch}</span>
      {/if}
      {#if !loading}
        <span class="text-[10px] text-[var(--sg-text-faint)]"
          >· {statusFiles.length === 0
            ? 'Clean'
            : `${statusFiles.length} file${statusFiles.length !== 1 ? 's' : ''}`}</span
        >
      {/if}
    </div>
    <div class="flex items-center gap-1">
      <button
        onclick={() => loadStatus()}
        disabled={loading}
        class="rounded p-1 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)] disabled:opacity-40"
        title="Refresh status"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"
          ></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
          ></path></svg
        >
      </button>
      <button
        onclick={onclose}
        class="rounded p-1 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
        title="Close changes panel"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"
          ></line></svg
        >
      </button>
    </div>
  </div>

  {#if loading}
    <div
      class="flex flex-1 items-center justify-center gap-2"
      style="animation: sg-fade-in 0.3s ease-out"
    >
      <Spinner size="md" />
      <p class="text-xs text-[var(--sg-text-faint)]">Loading changes…</p>
    </div>
  {:else}
    <div class="flex min-h-0 flex-1">
      <!-- Left: file lists + commit form -->
      <div
        class="flex w-[280px] shrink-0 flex-col overflow-hidden border-r border-[var(--sg-border-subtle)]"
      >
        <div class="flex min-h-0 flex-1 flex-col overflow-auto">
          <!-- Staged changes section -->
          <div class="border-b border-[var(--sg-border-subtle)]">
            <div class="flex items-center justify-between px-3 py-1.5">
              <p
                class="text-[10px] font-semibold uppercase tracking-wider text-[var(--sg-text-faint)]"
              >
                Staged ({stagedFiles.length})
              </p>
              {#if stagedFiles.length > 0}
                <button
                  onclick={handleUnstageAll}
                  disabled={unstagingAll}
                  class="text-[9px] text-[var(--sg-text-dim)] hover:text-[var(--sg-text)] disabled:opacity-40"
                  title="Unstage all"
                >
                  {#if unstagingAll}
                    <Spinner size="sm" />
                  {:else}
                    Unstage all
                  {/if}
                </button>
              {/if}
            </div>
            {#if stagedFiles.length === 0}
              <p class="px-3 pb-2 text-[10px] text-[var(--sg-text-faint)]">No staged changes</p>
            {:else}
              {#each stagedFiles as file}
                <div
                  class="group flex items-center gap-1 px-2 py-0.5 hover:bg-[var(--sg-surface-raised)] {diffFile ===
                    file.path && diffStaged
                    ? 'bg-[var(--sg-surface-raised)]'
                    : ''}"
                >
                  <button
                    class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    onclick={() => handleFileClick(file.path, true)}
                    title={file.path}
                  >
                    <span
                      class="w-3 shrink-0 text-center font-mono text-[10px] font-bold"
                      style="color: {statusColor(displayStatus(file, true))}"
                    >
                      {statusIcon(displayStatus(file, true))}
                    </span>
                    <span class="truncate text-[11px] text-[var(--sg-text-dim)]">
                      {file.path}
                    </span>
                  </button>
                  <button
                    onclick={() => handleUnstageFile(file.path)}
                    disabled={unstaging === file.path}
                    class="shrink-0 rounded p-0.5 text-[var(--sg-text-faint)] opacity-0 hover:bg-[var(--sg-surface)] hover:text-[var(--sg-warning)] group-hover:opacity-100 disabled:opacity-40"
                    title="Unstage"
                  >
                    {#if unstaging === file.path}
                      <Spinner size="sm" />
                    {:else}
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg
                      >
                    {/if}
                  </button>
                </div>
              {/each}
            {/if}
          </div>

          <!-- Unstaged changes section -->
          <div>
            <div class="flex items-center justify-between px-3 py-1.5">
              <p
                class="text-[10px] font-semibold uppercase tracking-wider text-[var(--sg-text-faint)]"
              >
                Changes ({unstagedFiles.length})
              </p>
              {#if unstagedFiles.length > 0}
                <button
                  onclick={handleStageAll}
                  disabled={stagingAll}
                  class="text-[9px] text-[var(--sg-text-dim)] hover:text-[var(--sg-text)] disabled:opacity-40"
                  title="Stage all"
                >
                  {#if stagingAll}
                    <Spinner size="sm" />
                  {:else}
                    Stage all
                  {/if}
                </button>
              {/if}
            </div>
            {#if unstagedFiles.length === 0}
              <p class="px-3 pb-2 text-[10px] text-[var(--sg-text-faint)]">No unstaged changes</p>
            {:else}
              {#each unstagedFiles as file}
                <div
                  class="group flex items-center gap-1 px-2 py-0.5 hover:bg-[var(--sg-surface-raised)] {diffFile ===
                    file.path && !diffStaged
                    ? 'bg-[var(--sg-surface-raised)]'
                    : ''}"
                >
                  <button
                    class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    onclick={() => handleFileClick(file.path, false)}
                    title={file.path}
                  >
                    <span
                      class="w-3 shrink-0 text-center font-mono text-[10px] font-bold"
                      style="color: {statusColor(displayStatus(file, false))}"
                    >
                      {statusIcon(displayStatus(file, false))}
                    </span>
                    <span class="truncate text-[11px] text-[var(--sg-text-dim)]">
                      {file.path}
                    </span>
                  </button>
                  <button
                    onclick={() => handleStageFile(file.path)}
                    disabled={staging === file.path}
                    class="shrink-0 rounded p-0.5 text-[var(--sg-text-faint)] opacity-0 hover:bg-[var(--sg-surface)] hover:text-[var(--sg-primary)] group-hover:opacity-100 disabled:opacity-40"
                    title="Stage"
                  >
                    {#if staging === file.path}
                      <Spinner size="sm" />
                    {:else}
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        ><line x1="12" y1="5" x2="12" y2="19"></line><line
                          x1="5"
                          y1="12"
                          x2="19"
                          y2="12"
                        ></line></svg
                      >
                    {/if}
                  </button>
                </div>
              {/each}
            {/if}
          </div>
        </div>

        <!-- Commit form -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="border-t border-[var(--sg-border)] px-3 py-2" onkeydown={handleKeydown}>
          <textarea
            bind:value={commitMessage}
            oninput={() => (commitTouched = true)}
            placeholder="Commit message"
            rows="3"
            class="w-full resize-none rounded border bg-[var(--sg-input-bg)] px-2 py-1.5 text-xs text-[var(--sg-text)] placeholder-[var(--sg-text-faint)] outline-none {commitError
              ? 'border-[var(--sg-danger)] focus:border-[var(--sg-danger)]'
              : 'border-[var(--sg-input-border)] focus:border-[var(--sg-input-focus)]'}"
          ></textarea>
          {#if commitError}
            <p class="mt-0.5 text-[10px] text-[var(--sg-danger)]">
              {commitError}
            </p>
          {/if}
          <button
            onclick={handleCommit}
            disabled={committing || !hasStagedChanges}
            class="mt-1.5 flex w-full items-center justify-center gap-2 rounded bg-[var(--sg-primary)] px-2.5 py-1.5 text-xs font-semibold text-[var(--sg-bg)] hover:bg-[var(--sg-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            title={!hasStagedChanges ? 'Stage changes first' : 'Commit staged changes (Ctrl+Enter)'}
          >
            {#if committing}
              <Spinner size="sm" />
              Committing…
            {:else}
              Commit {stagedFiles.length > 0
                ? `(${stagedFiles.length} file${stagedFiles.length !== 1 ? 's' : ''})`
                : ''}
            {/if}
          </button>
          <p class="mt-1 text-center text-[9px] text-[var(--sg-text-faint)]">
            Ctrl+Enter to commit
          </p>
        </div>
      </div>

      <!-- Right: diff view -->
      <div class="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--sg-bg)]">
        {#if diffLoading}
          <div
            class="flex flex-1 items-center justify-center gap-2"
            style="animation: sg-fade-in 0.3s ease-out"
          >
            <Spinner size="md" />
            <p class="text-xs text-[var(--sg-text-faint)]">Loading diff…</p>
          </div>
        {:else if diffFile && diffContent}
          <div
            class="flex items-center gap-2 border-b border-[var(--sg-border-subtle)] bg-[var(--sg-surface)] px-4 py-1.5"
          >
            <span
              class="rounded-sm px-1 py-px text-[9px] font-bold {diffStaged
                ? 'bg-[var(--sg-primary)]/15 text-[var(--sg-primary)]'
                : 'bg-[var(--sg-warning)]/15 text-[var(--sg-warning)]'}"
            >
              {diffStaged ? 'STAGED' : 'UNSTAGED'}
            </span>
            <span class="truncate font-mono text-[11px] text-[var(--sg-text-dim)]">
              {diffFile}
            </span>
          </div>
          <div class="flex-1 overflow-auto">
            <table class="w-full border-collapse font-mono text-[11px] leading-[18px]">
              <tbody>
                {#each parsedDiff as line, idx}
                  {@const hl = highlightedLines.get(idx)}
                  {#if line.type === 'header'}
                    <tr class="bg-[var(--sg-surface)]">
                      <td
                        class="select-none px-1 text-right text-[var(--sg-text-faint)]"
                        colspan="2"
                      ></td>
                      <td class="px-2 text-[var(--sg-text-faint)]">{line.content}</td>
                    </tr>
                  {:else if line.type === 'hunk'}
                    <tr class="bg-[var(--sg-primary)]/5">
                      <td class="select-none px-1 text-right text-[var(--sg-primary)]" colspan="2"
                        >···</td
                      >
                      <td class="px-2 text-[var(--sg-primary)]">{line.content}</td>
                    </tr>
                  {:else if line.type === 'add'}
                    <tr class="bg-green-500/10">
                      <td
                        class="w-[1px] select-none whitespace-nowrap border-r border-[var(--sg-border-subtle)] px-1 text-right text-[var(--sg-text-faint)]"
                      ></td>
                      <td
                        class="w-[1px] select-none whitespace-nowrap border-r border-[var(--sg-border-subtle)] px-1 text-right text-[var(--sg-text-faint)]"
                        >{line.newNum}</td
                      >
                      {#if hl}
                        <td class="diff-hl-add whitespace-pre-wrap break-all px-2">+{@html hl}</td>
                      {:else}
                        <td class="whitespace-pre-wrap break-all px-2 text-green-400"
                          >+{line.content}</td
                        >
                      {/if}
                    </tr>
                  {:else if line.type === 'del'}
                    <tr class="bg-red-500/10">
                      <td
                        class="w-[1px] select-none whitespace-nowrap border-r border-[var(--sg-border-subtle)] px-1 text-right text-[var(--sg-text-faint)]"
                        >{line.oldNum}</td
                      >
                      <td
                        class="w-[1px] select-none whitespace-nowrap border-r border-[var(--sg-border-subtle)] px-1 text-right text-[var(--sg-text-faint)]"
                      ></td>
                      {#if hl}
                        <td class="diff-hl-del whitespace-pre-wrap break-all px-2">-{@html hl}</td>
                      {:else}
                        <td class="whitespace-pre-wrap break-all px-2 text-red-400"
                          >-{line.content}</td
                        >
                      {/if}
                    </tr>
                  {:else if line.type === 'context'}
                    <tr>
                      <td
                        class="w-[1px] select-none whitespace-nowrap border-r border-[var(--sg-border-subtle)] px-1 text-right text-[var(--sg-text-faint)]"
                        >{line.oldNum}</td
                      >
                      <td
                        class="w-[1px] select-none whitespace-nowrap border-r border-[var(--sg-border-subtle)] px-1 text-right text-[var(--sg-text-faint)]"
                        >{line.newNum}</td
                      >
                      {#if hl}
                        <td class="diff-hl whitespace-pre-wrap break-all px-2"> {@html hl}</td>
                      {:else}
                        <td class="whitespace-pre-wrap break-all px-2 text-[var(--sg-text-dim)]">
                          {line.content}</td
                        >
                      {/if}
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
          </div>
        {:else if diffFile && !diffContent}
          <div class="flex flex-1 items-center justify-center">
            <p class="text-xs text-[var(--sg-text-faint)]">
              No diff content (file may be binary or empty)
            </p>
          </div>
        {:else}
          <div class="flex flex-1 items-center justify-center">
            <p class="text-xs text-[var(--sg-text-faint)]">Select a file to view changes</p>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
