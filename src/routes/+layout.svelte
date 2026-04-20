<script lang="ts">
  import { onMount } from 'svelte';
  import "../app.css";
  import ToastContainer from "$lib/components/ToastContainer.svelte";

  onMount(() => {
    if (navigator.platform.startsWith('Mac') || /Mac/.test(navigator.userAgent)) {
      document.documentElement.classList.add('platform-macos');
    } else if (navigator.platform.startsWith('Win') || /Windows/.test(navigator.userAgent)) {
      document.documentElement.classList.add('platform-windows');
    }
  });
</script>

<slot />
<ToastContainer />
