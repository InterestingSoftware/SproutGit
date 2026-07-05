import { globalToast } from './toast-context.js';

/**
 * For expected/recoverable failures that should still be visible — as
 * opposed to genuinely unexpected crashes, which go through the global
 * uncaughtException/unhandledrejection handlers and ErrorModal instead.
 */
export function reportError(context: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console -- forwarded to main.log via the renderer console-message bridge
  console.error(`[${context}]`, err);
  globalToast(`${context}: ${message}`, 'error');
}
