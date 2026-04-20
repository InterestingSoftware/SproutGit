<script lang="ts">
  import "../app.css";
  import ToastContainer from "$lib/components/ToastContainer.svelte";

  if (typeof navigator !== 'undefined' && typeof document !== 'undefined') {
    const root = document.documentElement;
    root.classList.remove('platform-macos', 'platform-windows');

    if (navigator.platform.startsWith('Mac') || /Mac/.test(navigator.userAgent)) {
      root.classList.add('platform-macos');
    } else if (navigator.platform.startsWith('Win') || /Windows/.test(navigator.userAgent)) {
      root.classList.add('platform-windows');
    }
  }
</script>

<slot />
<ToastContainer />
