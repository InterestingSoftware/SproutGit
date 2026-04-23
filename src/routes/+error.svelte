<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { toast } from '$lib/toast.svelte';

  type Props = {
    status: number;
  };

  const { status }: Props = $props();

  onMount(() => {
    if (status === 404) {
      toast.error('Route not found. Redirecting home...');
    } else {
      toast.error('Something went wrong. Redirecting home...');
    }

    if (window.location.pathname !== '/') {
      void goto('/', { replaceState: true });
    }
  });
</script>

<main class="flex h-screen items-center justify-center text-xs text-(--sg-text-faint)">
  Redirecting...
</main>