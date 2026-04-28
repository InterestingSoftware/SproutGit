<script lang="ts">
  import { onMount } from 'svelte';

  type Props = {
    items: { label: string; value: string; detail?: string }[];
    value: string;
    placeholder?: string;
    id?: string;
    testId?: string;
    onselect?: (value: string) => void;
  };

  let { items, value = $bindable(), placeholder = '', id, testId, onselect }: Props = $props();

  let query = $state('');
  let open = $state(false);
  let highlightIdx = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLDivElement | null>(null);

  // Sync query from selected value's label
  $effect(() => {
    const match = items.find(i => i.value === value);
    query = match ? match.label : value;
  });

  const filtered = $derived.by(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(
      i =>
        i.label.toLowerCase().includes(q) ||
        i.value.toLowerCase().includes(q) ||
        (i.detail?.toLowerCase().includes(q) ?? false)
    );
  });

  function select(item: { label: string; value: string }) {
    value = item.value;
    query = item.label;
    open = false;
    onselect?.(item.value);
  }

  function handleInput() {
    const selected = items.find(item => item.value === value);
    if (!selected || query !== selected.label) {
      value = query;
    }
    open = true;
    highlightIdx = 0;
  }

  function handleFocus() {
    open = true;
    highlightIdx = 0;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightIdx = Math.min(highlightIdx + 1, filtered.length - 1);
      scrollHighlightIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightIdx = Math.max(highlightIdx - 1, 0);
      scrollHighlightIntoView();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && filtered[highlightIdx]) {
        select(filtered[highlightIdx]);
      }
    } else if (e.key === 'Escape') {
      open = false;
    }
  }

  function scrollHighlightIntoView() {
    requestAnimationFrame(() => {
      listEl?.children[highlightIdx]?.scrollIntoView({ block: 'nearest' });
    });
  }

  function handleClickOutside(e: MouseEvent) {
    if (inputEl && !inputEl.closest('.sg-autocomplete')?.contains(e.target as Node)) {
      open = false;
    }
  }

  onMount(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  });
</script>

<div class="sg-autocomplete relative">
  <input
    bind:this={inputEl}
    bind:value={query}
    data-testid={testId}
    oninput={handleInput}
    onfocus={handleFocus}
    onkeydown={handleKeydown}
    {id}
    {placeholder}
    class="w-full rounded border border-[var(--sg-input-border)] bg-[var(--sg-input-bg)] px-2 py-1 text-xs text-[var(--sg-text)] placeholder-[var(--sg-text-faint)] outline-none focus:border-[var(--sg-input-focus)]"
    role="combobox"
    aria-expanded={open}
    aria-controls="sg-autocomplete-list"
    aria-autocomplete="list"
    autocomplete="off"
    spellcheck="false"
    autocorrect="off"
    autocapitalize="off"
  />

  {#if open && filtered.length > 0}
    <div
      bind:this={listEl}
      id="sg-autocomplete-list"
      class="absolute left-0 right-0 top-full z-40 mt-1 max-h-48 overflow-auto rounded border border-[var(--sg-border)] bg-[var(--sg-surface)] shadow-lg"
      style="animation: sg-slide-up 0.12s ease-out"
      role="listbox"
    >
      {#each filtered as item, i}
        <button
          class="flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-xs {i ===
          highlightIdx
            ? 'bg-[var(--sg-surface-raised)] text-[var(--sg-text)]'
            : 'text-[var(--sg-text-dim)]'}"
          onmouseenter={() => (highlightIdx = i)}
          onclick={() => select(item)}
          role="option"
          aria-selected={i === highlightIdx}
        >
          <span class="min-w-0 flex-1 truncate">{item.label}</span>
          {#if item.detail}
            <span class="shrink-0 text-[10px] text-[var(--sg-text-faint)]">{item.detail}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
