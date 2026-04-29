<script lang="ts">
  import '../app.css';
  import ToastContainer from '$lib/components/ToastContainer.svelte';
  import { updateState } from '$lib/update.svelte';
  import { onDestroy, onMount } from 'svelte';
  import { onNavigate } from '$app/navigation';

  let unlistenWindowResize: (() => void) | undefined;

  onNavigate(navigation => {
    if (!document.startViewTransition) return;
    return new Promise(resolve => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
    });
  });

  if (typeof navigator !== 'undefined' && typeof document !== 'undefined') {
    const root = document.documentElement;
    root.classList.remove('platform-macos', 'platform-windows');

    if (navigator.platform.startsWith('Mac') || /Mac/.test(navigator.userAgent)) {
      root.classList.add('platform-macos');
    } else if (navigator.platform.startsWith('Win') || /Windows/.test(navigator.userAgent)) {
      root.classList.add('platform-windows');
    }
  }

  onMount(() => {
    const root = document.documentElement;

    async function syncFullscreenClass() {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const isFullscreen = await getCurrentWindow().isFullscreen();
        root.classList.toggle('window-fullscreen', isFullscreen);
      } catch {
        root.classList.remove('window-fullscreen');
      }
    }

    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        await syncFullscreenClass();
        unlistenWindowResize = await win.onResized(() => {
          void syncFullscreenClass();
        });
      } catch {
        root.classList.remove('window-fullscreen');
      }
    })();

    if (!import.meta.env.DEV) {
      void (async () => {
        try {
          const { check } = await import('@tauri-apps/plugin-updater');
          const update = await check();
          updateState.set(update);
        } catch {
          // Silently ignore — update check is best-effort
        }
      })();
    }

    return () => {
      unlistenWindowResize?.();
      unlistenWindowResize = undefined;
    };
  });

  onDestroy(() => {
    unlistenWindowResize?.();
    unlistenWindowResize = undefined;
  });
</script>

<slot />
<ToastContainer />
