<script lang="ts">
  import type { Snippet } from 'svelte';

  type CheckboxVariant = 'primary' | 'danger';
  type CheckboxAlign = 'start' | 'center';

  type Props = {
    checked: boolean;
    disabled?: boolean;
    variant?: CheckboxVariant;
    align?: CheckboxAlign;
    className?: string;
    onChange?: (checked: boolean) => void;
    children?: Snippet;
  };

  const {
    checked,
    disabled = false,
    variant = 'primary',
    align = 'start',
    className = '',
    onChange,
    children,
  }: Props = $props();

  function handleChange(event: Event) {
    const next = (event.currentTarget as HTMLInputElement).checked;
    onChange?.(next);
  }
</script>

<label
  class={`inline-flex cursor-pointer gap-2 ${align === 'center' ? 'items-center' : 'items-start'} ${disabled ? 'opacity-60' : ''} ${className}`}
>
  <input type="checkbox" class="sr-only" {checked} {disabled} onchange={handleChange} />
  <span
    class={`${align === 'center' ? 'mt-0' : 'mt-0.5'} inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[var(--sg-input-border)] leading-none ${
      checked
        ? variant === 'danger'
          ? 'border-[var(--sg-danger)] bg-[var(--sg-danger)]'
          : 'border-[var(--sg-primary)] bg-[var(--sg-primary)]'
        : 'bg-[var(--sg-input-bg)]'
    }`}
  >
    <svg
      class={`block h-3 w-3 text-white transition-opacity duration-100 ${checked ? 'opacity-100' : 'opacity-0'}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="m5 13 4 4L19 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </span>
  {@render children?.()}
</label>
