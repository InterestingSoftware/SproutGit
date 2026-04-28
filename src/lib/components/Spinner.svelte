<script lang="ts">
  type Props = {
    size?: 'sm' | 'md' | 'lg';
    label?: string;
  };

  const { size = 'md', label }: Props = $props();

  const sizeMap = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8' };
</script>

<div data-testid="spinner" class="flex items-center justify-center gap-2">
  <svg
    class="{sizeMap[size]} text-[var(--sg-primary)]"
    style="animation: sg-spin 0.8s linear infinite"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.2" />
    <path
      d="M12 2a10 10 0 0 1 10 10"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
    />
  </svg>
  {#if label}
    <span class="text-xs text-[var(--sg-text-faint)]">{label}</span>
  {/if}
</div>
