<script lang="ts">
  import { getToasts, removeToast } from '$lib/toast.svelte';

  const iconPaths: Record<string, string> = {
    success: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    error: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
    warning:
      'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
    info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  };

  const colorMap: Record<string, string> = {
    success: 'var(--sg-primary)',
    error: 'var(--sg-danger)',
    warning: 'var(--sg-warning)',
    info: 'var(--sg-accent)',
  };

  function toasts() {
    return getToasts();
  }
</script>

<div class="pointer-events-none fixed right-0 top-0 z-50 flex flex-col gap-2 p-4">
  {#each toasts() as t (t.id)}
    <div
      data-testid="toast-item"
      data-toast-type={t.type}
      class="pointer-events-auto relative flex max-w-xs items-start gap-2 overflow-hidden rounded-lg border border-[var(--sg-border-subtle)] bg-[var(--sg-surface)] py-2.5 pr-3 pl-3.5 shadow-lg backdrop-blur-sm"
      style="animation: {t.removing ? 'sg-toast-out' : 'sg-toast-in'} 0.2s ease-out forwards"
    >
      <span
        aria-hidden="true"
        class="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full"
        style:background={colorMap[t.type]}
      ></span>
      <svg
        class="mt-0.5 h-4 w-4 shrink-0"
        fill="none"
        stroke={colorMap[t.type]}
        viewBox="0 0 24 24"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d={iconPaths[t.type]} />
      </svg>
      <div class="min-w-0 flex-1">
        <p
          data-testid="toast-message"
          class="select-text text-xs leading-relaxed text-[var(--sg-text)]"
        >
          {t.message}
        </p>
        {#if t.action}
          <button
            onclick={() => {
              t.action!.onClick();
              removeToast(t.id);
            }}
            class="mt-1 text-xs font-medium text-[var(--sg-accent)] hover:underline"
          >
            {t.action.label}
          </button>
        {/if}
      </div>
      <button
        onclick={() => removeToast(t.id)}
        class="shrink-0 rounded p-0.5 text-[var(--sg-text-faint)] hover:text-[var(--sg-text)]"
        aria-label="Dismiss"
      >
        <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"
          ><path d="M18 6 6 18M6 6l12 12" stroke-width="2" stroke-linecap="round" /></svg
        >
      </button>
    </div>
  {/each}
</div>
