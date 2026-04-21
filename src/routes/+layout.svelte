<script lang="ts">
  import "../app.css";
  import ToastContainer from "$lib/components/ToastContainer.svelte";
  import { toast } from "$lib/toast.svelte";
  import { onMount } from "svelte";

  if (typeof navigator !== 'undefined' && typeof document !== 'undefined') {
    const root = document.documentElement;
    root.classList.remove('platform-macos', 'platform-windows');

    if (navigator.platform.startsWith('Mac') || /Mac/.test(navigator.userAgent)) {
      root.classList.add('platform-macos');
    } else if (navigator.platform.startsWith('Win') || /Windows/.test(navigator.userAgent)) {
      root.classList.add('platform-windows');
    }
  }

  onMount(async () => {
    if (import.meta.env.DEV) return;

    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        toast.info(`Update v${update.version} available — open Settings to install`);
      }
    } catch {
      // Silently ignore — update check is best-effort
    }
  });
</script>

<slot />
<ToastContainer />
