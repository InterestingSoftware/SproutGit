<script lang="ts">
  type Props = {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
  };

  const {
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
    onconfirm,
    oncancel,
  }: Props = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') oncancel();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-testid="confirm-dialog"
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
  style="animation: sg-fade-in 0.1s ease-out"
  onkeydown={handleKeydown}
  onmousedown={e => {
    if (e.target === e.currentTarget) oncancel();
  }}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="w-full max-w-sm rounded-lg border border-[var(--sg-border)] bg-[var(--sg-surface)] p-4 shadow-2xl"
    style="animation: sg-slide-up 0.15s ease-out"
    onmousedown={e => e.stopPropagation()}
  >
    <h3 class="mb-1 text-sm font-semibold text-[var(--sg-text)]">{title}</h3>
    <p class="mb-4 text-xs leading-relaxed text-[var(--sg-text-dim)]">{message}</p>
    <div class="flex items-center justify-end gap-2">
      <button
        onclick={oncancel}
        data-testid="confirm-dialog-cancel"
        class="rounded px-3 py-1.5 text-xs text-[var(--sg-text-dim)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
      >
        {cancelLabel}
      </button>
      <button
        onclick={onconfirm}
        data-testid="confirm-dialog-confirm"
        class="rounded px-3 py-1.5 text-xs font-semibold {danger
          ? 'bg-[var(--sg-danger)] text-white hover:opacity-90'
          : 'bg-[var(--sg-primary)] text-[var(--sg-bg)] hover:bg-[var(--sg-primary-hover)]'}"
      >
        {confirmLabel}
      </button>
    </div>
  </div>
</div>
