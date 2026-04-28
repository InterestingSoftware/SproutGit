<script lang="ts">
  import type { CommitEntry, DiffFileEntry } from '$lib/sproutgit';
  import Spinner from './Spinner.svelte';
  import hljs from 'highlight.js/lib/core';

  // Register common languages
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
    diff: string;
    loading: boolean;
    // Optional: path of the displayed file (used for syntax-language detection in minimal mode).
    filePath?: string | null;
    // Full history-mode props (all optional – omit to use minimal/standalone mode).
    files?: DiffFileEntry[];
    selectedFile?: string | null;
    commitLabel?: string;
    commits?: CommitEntry[];
    onselectfile?: (path: string) => void;
    onclose?: () => void;
  };

  const {
    diff,
    loading,
    filePath = null,
    files,
    selectedFile = null,
    commitLabel = '',
    commits = [],
    onselectfile,
    onclose,
  }: Props = $props();

  // Effective path for syntax language detection: prefers the explicit filePath prop
  // (used by the staging panel) and falls back to the history-mode selectedFile.
  const effectivePath = $derived(filePath ?? selectedFile ?? null);

  function statusIcon(status: string): string {
    switch (status) {
      case 'A':
        return '+';
      case 'D':
        return '−';
      case 'M':
        return '●';
      case 'R':
        return '→';
      default:
        return '?';
    }
  }

  function statusColor(status: string): string {
    switch (status) {
      case 'A':
        return 'text-green-400';
      case 'D':
        return 'text-red-400';
      case 'M':
        return 'text-yellow-400';
      case 'R':
        return 'text-blue-400';
      default:
        return 'text-[var(--sg-text-faint)]';
    }
  }

  // Parse unified diff into structured lines
  type DiffLine = {
    type: 'header' | 'hunk' | 'add' | 'del' | 'context' | 'empty';
    content: string;
    oldNum: number | null;
    newNum: number | null;
  };

  const parsedDiff = $derived.by((): DiffLine[] => {
    if (!diff) return [];
    const lines = diff.split('\n');
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
        // Parse hunk header: @@ -old,count +new,count @@
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
        // Context line (starts with space or is plain text)
        const content = line.startsWith(' ') ? line.slice(1) : line;
        result.push({ type: 'context', content, oldNum: oldLine, newNum: newLine });
        oldLine++;
        newLine++;
      }
    }
    return result;
  });

  function fileName(path: string): string {
    return path.split('/').pop() ?? path;
  }

  function dirName(path: string): string {
    const parts = path.split('/');
    if (parts.length <= 1) return '';
    return parts.slice(0, -1).join('/') + '/';
  }

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

  // Pre-highlight all code lines together for consistent tokenization
  const highlightedLines = $derived.by((): Map<number, string> => {
    const map = new Map<number, string>();
    const lang = langForFile(effectivePath);
    if (!lang) return map;

    // Collect code lines with their indices
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
      // Highlight line by line to avoid broken unclosed span tags across lines.
      // Svelte {@html} won't work correctly with split multiline span tags.
      for (let i = 0; i < codeIndices.length; i++) {
        const result = hljs.highlight(codeLines[i], { language: lang, ignoreIllegals: true });
        map.set(codeIndices[i], result.value);
      }
    } catch {
      // Highlighting failed, return empty map (will fall back to plain text)
    }
    return map;
  });
</script>

{#snippet diffPane()}
  <div class="min-w-0 flex-1 overflow-auto bg-[var(--sg-bg)]">
    {#if loading}
      <div class="flex h-full items-center justify-center">
        <Spinner size="md" label="Loading diff…" />
      </div>
    {:else if files && !selectedFile}
      <div class="flex h-full items-center justify-center text-xs text-[var(--sg-text-faint)]">
        Select a file to view its diff
      </div>
    {:else if parsedDiff.length === 0}
      <div class="flex h-full items-center justify-center text-xs text-[var(--sg-text-faint)]">
        No diff content (file may be binary or empty)
      </div>
    {:else}
      <table class="sg-code w-full border-collapse font-mono text-[11px] leading-[18px]">
        <tbody>
          {#each parsedDiff as line, idx}
            {@const hl = highlightedLines.get(idx)}
            {#if line.type === 'header'}
              <tr class="bg-[var(--sg-surface)]">
                <td class="select-none px-1 text-right text-[var(--sg-text-faint)]" colspan="2"
                ></td>
                <td class="px-2 text-[var(--sg-text-faint)]">{line.content}</td>
              </tr>
            {:else if line.type === 'hunk'}
              <tr class="bg-[var(--sg-primary)]/5">
                <td class="select-none px-1 text-right text-[var(--sg-primary)]" colspan="2">···</td
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
                  <td class="whitespace-pre-wrap break-all px-2 text-green-400">+{line.content}</td>
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
                  <td class="whitespace-pre-wrap break-all px-2 text-red-400">-{line.content}</td>
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
    {/if}
  </div>
{/snippet}

{#if files}
  <!-- Full history mode: commit header + file list sidebar + diff content -->
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div
      class="flex shrink-0 items-center gap-2 border-b border-[var(--sg-border)] bg-[var(--sg-surface)] px-3 py-1.5"
    >
      <div class="min-w-0 flex-1">
        <p class="truncate text-xs text-[var(--sg-text)]">
          <span class="text-[var(--sg-text-faint)]">Changes in</span>
          <span class="font-mono font-medium">{commitLabel}</span>
          <span class="text-[var(--sg-text-faint)]"
            >· {files.length} file{files.length !== 1 ? 's' : ''}</span
          >
        </p>
        {#if commits.length === 1}
          <p class="truncate text-[10px] text-[var(--sg-text-faint)]">
            {commits[0].authorName} &lt;{commits[0].authorEmail}&gt; · {commits[0].authorDate}
            {#if commits[0].subject}
              — {commits[0].subject}
            {/if}
          </p>
        {/if}
      </div>
      <button
        onclick={onclose}
        class="rounded p-0.5 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
        title="Close diff view"
      >
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
          ><path d="M18 6 6 18M6 6l12 12" stroke-width="2" stroke-linecap="round" /></svg
        >
      </button>
    </div>

    <div class="flex min-h-0 flex-1">
      <!-- File list -->
      <div
        class="flex w-[220px] shrink-0 flex-col border-r border-[var(--sg-border)] bg-[var(--sg-surface)]"
      >
        <div class="flex-1 overflow-auto">
          {#each files as file}
            <button
              class="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] hover:bg-[var(--sg-surface-raised)] {selectedFile ===
              file.path
                ? 'bg-[var(--sg-surface-raised)] text-[var(--sg-text)]'
                : 'text-[var(--sg-text-dim)]'}"
              onclick={() => onselectfile?.(file.path)}
            >
              <span
                class="shrink-0 font-mono text-[10px] font-bold {statusColor(file.status)}"
                title={file.status}>{statusIcon(file.status)}</span
              >
              <span class="min-w-0 truncate">
                <span class="text-[var(--sg-text-faint)]">{dirName(file.path)}</span>{fileName(
                  file.path
                )}
              </span>
            </button>
          {/each}
        </div>
      </div>

      <!-- Diff content -->
      {@render diffPane()}
    </div>
  </div>
{:else}
  <!-- Minimal/standalone mode: just the highlighted diff pane, no header or file list.
       The parent is responsible for providing its own header above this component. -->
  {@render diffPane()}
{/if}
