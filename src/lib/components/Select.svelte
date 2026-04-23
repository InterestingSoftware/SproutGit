<script lang="ts">
  type SelectOption = {
    value: string;
    label: string;
  };

  type Props = {
    value: string;
    options: SelectOption[];
    disabled?: boolean;
    className?: string;
    onChange?: (value: string) => void;
  };

  const {
    value,
    options,
    disabled = false,
    className = '',
    onChange,
  }: Props = $props();

  function handleChange(event: Event) {
    const next = (event.currentTarget as HTMLSelectElement).value;
    onChange?.(next);
  }
</script>

<div class={`relative ${className}`}>
  <select
    value={value}
    disabled={disabled}
    class="w-full appearance-none rounded border border-[var(--sg-input-border)] bg-[var(--sg-input-bg)] px-2.5 py-1.5 pr-8 text-xs text-[var(--sg-text)] outline-none focus:border-[var(--sg-input-focus)] disabled:opacity-60"
    onchange={handleChange}
  >
    {#each options as option}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
  <svg
    class="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--sg-text-faint)]"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      d="m6 9 6 6 6-6"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</div>
