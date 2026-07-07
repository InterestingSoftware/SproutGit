import { api } from '../api.js';
import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { ToastContainer, ErrorModal, type ToastData, type ToastAction, type ErrorModalData } from '@sproutgit/ui';
import { useState, useEffect } from 'react';
import { ToastContext, setGlobalToast } from '../toast-context.js';

// ── Root layout ───────────────────────────────────────────────────────────────

function RootLayout() {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [globalError, setGlobalError] = useState<ErrorModalData | null>(null);
  const navigate = useNavigate();

  function addToast(message: string, variant: ToastData['variant'] = 'info', action?: ToastAction) {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, message, variant, ...(action ? { action } : {}) }]);
  }

  // Wire up the module-level escape hatch so QueryCache.onError can fire toasts.
  useEffect(() => {
    setGlobalToast(addToast);
    return () => setGlobalToast(() => undefined);
  // addToast is stable (defined inline in render) — the ref pattern is intentional.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss(id: string) {
    setToasts(prev => prev.filter(t => t.id !== id));
  }

  // Last-resort safety net for crashes/programmer errors: uncaught exceptions
  // and unhandled rejections in this process, plus anything forwarded from
  // the main process (its own uncaughtException/unhandledRejection, or a
  // renderer/child-process crash). Shown via ErrorModal — distinct from
  // toast/reportError, which are for expected, recoverable failures.
  useEffect(() => {
    function onWindowError(event: ErrorEvent) {
      setGlobalError({ title: 'Unexpected error', message: event.message, ...(event.error?.stack ? { stack: event.error.stack as string } : {}) });
    }
    function onUnhandledRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      setGlobalError({ title: 'Unhandled promise rejection', message, ...(reason instanceof Error && reason.stack ? { stack: reason.stack } : {}) });
    }
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    const offGlobalError = api.onGlobalError(event => {
      setGlobalError({ title: 'Unexpected error (main process)', message: event.message, ...(event.stack ? { stack: event.stack } : {}) });
    });
    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      offGlobalError();
    };
  }, []);

  // Open workspaces requested by the OS (macOS "Open Recent" dock menu,
  // Windows taskbar jump list, double-clicking a workspace folder, etc.).
  useEffect(() => {
    const offOpenWorkspace = api.onOpenWorkspace((workspacePath: string) => {
      void navigate({ to: '/workspace', search: { path: workspacePath } });
    });
    return () => {
      offOpenWorkspace();
    };
  }, [navigate]);

  // "New Window" shortcut. On macOS this is already handled by the native
  // File → New Window menu item (Cmd+N) — binding it here too would open two
  // windows per press. Windows/Linux have no application menu at all, so
  // Ctrl+N is the only shortcut path there.
  useEffect(() => {
    if (/mac/i.test(navigator.platform)) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        void api.openNewWindow();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <ToastContext.Provider value={addToast}>
      <Outlet />
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
      {globalError && <ErrorModal error={globalError} onDismiss={() => setGlobalError(null)} />}
    </ToastContext.Provider>
  );
}

export const rootRoute = createRootRoute({ component: RootLayout });
