<script lang="ts">
  import { updateState } from '$lib/update.svelte';

  type Props = { href?: string };
  let { href = '/settings' }: Props = $props();
</script>

{#if updateState.available}
  <a
    {href}
    class="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-[var(--sg-warning)] hover:bg-[var(--sg-surface-raised)]"
    title="Update v{updateState.available.version} available - click to view in Settings"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
    v{updateState.available.version}
  </a>
{/if}
