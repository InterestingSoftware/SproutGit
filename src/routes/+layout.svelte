<script lang="ts">
  import '../app.css';
  import Spinner from '$lib/components/Spinner.svelte';
  import ToastContainer from '$lib/components/ToastContainer.svelte';
  import { updateState } from '$lib/update.svelte';
  import { isE2eBuild } from '$lib/sproutgit';
  import { onDestroy, onMount } from 'svelte';
  import { onNavigate } from '$app/navigation';

  type Props = {
    children: import('svelte').Snippet;
  };

  let { children }: Props = $props();

  let unlistenWindowResize: (() => void) | undefined;
  let isRouteNavigating = $state(false);

  onNavigate(navigation => {
    isRouteNavigating = true;

    void navigation.complete.finally(() => {
      isRouteNavigating = false;
    });

    const fromPath = navigation.from?.url.pathname ?? '';
    const toPath = navigation.to?.url.pathname ?? '';
    const skipViewTransition = fromPath.startsWith('/workspace') && toPath === '/';

    // Rendering a snapshot of the full workspace can be expensive on very large repos.
    // Skip view transitions on workspace -> home to keep navigation responsive.
    if (skipViewTransition || !document.startViewTransition) {
      return;
    }

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
          // Skip update check in E2E builds so screenshots and tests don't
          // capture a transient update badge.
          const isE2E = await isE2eBuild().catch(() => false);
          if (isE2E) return;
          const { check } = await import('@tauri-apps/plugin-updater');
          const update = await check();
          updateState.set(update);
        } catch {
          // Silently ignore — update check is best-effort
        }
      })();
    }

    // Suppress the native browser context menu app-wide. Allow it inside
    // editable form fields (input/textarea/contenteditable) so users can still
    // use Copy/Paste menus on text input. Custom oncontextmenu handlers in
    // components also call preventDefault and run before this listener.
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        event.preventDefault();
        return;
      }
      const editable = target.closest(
        'input, textarea, [contenteditable=""], [contenteditable="true"]'
      );
      if (!editable) {
        event.preventDefault();
      }
    };
    window.addEventListener('contextmenu', onContextMenu);

    return () => {
      window.removeEventListener('contextmenu', onContextMenu);
      unlistenWindowResize?.();
      unlistenWindowResize = undefined;
    };
  });

  onDestroy(() => {
    unlistenWindowResize?.();
    unlistenWindowResize = undefined;
  });
</script>

{@render children()}
{#if isRouteNavigating}
  <div
    class="pointer-events-none fixed inset-0 z-1000 flex items-center justify-center bg-(--sg-bg)/55 backdrop-blur-[1px]"
    style="animation: sg-fade-in 0.12s ease-out"
  >
    <div class="rounded-lg border border-(--sg-border) bg-(--sg-surface) px-4 py-3 shadow-sm">
      <Spinner size="md" label="Loading…" />
    </div>
  </div>
{/if}
<ToastContainer />
