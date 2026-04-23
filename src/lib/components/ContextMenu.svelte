<script lang="ts">
  import { onMount } from "svelte";

  export type MenuItem = {
    label: string;
    action: () => void;
    icon?: string;
    danger?: boolean;
    separator?: false;
  } | {
    separator: true;
  };

  type Props = {
    items: MenuItem[];
    x: number;
    y: number;
    onclose: () => void;
  };

  const { items, x, y, onclose }: Props = $props();

  let menuEl = $state<HTMLDivElement | null>(null);

  // Adjust position to stay within viewport
  const adjustedPos = $derived.by(() => {
    if (!menuEl) return { x, y };
    const rect = menuEl.getBoundingClientRect();
    let ax = x;
    let ay = y;
    if (ax + rect.width > window.innerWidth - 8) ax = window.innerWidth - rect.width - 8;
    if (ay + rect.height > window.innerHeight - 8) ay = window.innerHeight - rect.height - 8;
    if (ax < 8) ax = 8;
    if (ay < 8) ay = 8;
    return { x: ax, y: ay };
  });

  function handleAction(item: MenuItem) {
    if (!("separator" in item && item.separator)) {
      item.action();
    }
    onclose();
  }

  onMount(() => {
    function handleClick(e: MouseEvent) {
      if (menuEl && !menuEl.contains(e.target as Node)) {
        onclose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onclose();
    }
    // Delay to avoid immediately closing from the same click
    requestAnimationFrame(() => {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleKey);
    });
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={menuEl}
  class="fixed z-50 min-w-[160px] rounded-lg border border-[var(--sg-border)] bg-[var(--sg-surface)] py-1 shadow-xl"
  style="left: {adjustedPos.x}px; top: {adjustedPos.y}px; animation: sg-slide-up 0.1s ease-out"
  oncontextmenu={(e) => e.preventDefault()}
>
  {#each items as item}
    {#if "separator" in item && item.separator}
      <div class="my-1 border-t border-[var(--sg-border-subtle)]"></div>
    {:else}
      <button
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--sg-surface-raised)] {item.danger ? 'text-[var(--sg-danger)]' : 'text-[var(--sg-text)]'}"
        onclick={() => handleAction(item)}
      >
        {#if item.icon}
          <span class="w-4 text-center text-[10px]">{item.icon}</span>
        {/if}
        <span>{item.label}</span>
      </button>
    {/if}
  {/each}
</div>
