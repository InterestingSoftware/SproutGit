import { createContext, useContext } from 'react';
import type { ToastData, ToastAction } from '@sproutgit/ui';

export type ToastFn = (message: string, variant?: ToastData['variant'], action?: ToastAction) => void;

export const ToastContext = createContext<ToastFn>(() => undefined);

export function useToast(): ToastFn {
  return useContext(ToastContext);
}

// Module-level escape hatch so code outside React (e.g. QueryCache.onError)
// can fire toasts.  Wired up by RootLayout on mount.
// eslint-disable-next-line no-underscore-dangle
let _globalToast: ToastFn = () => undefined;
export function setGlobalToast(fn: ToastFn) { _globalToast = fn; }
export function globalToast(message: string, variant?: ToastData['variant'], action?: ToastAction) {
  _globalToast(message, variant, action);
}
