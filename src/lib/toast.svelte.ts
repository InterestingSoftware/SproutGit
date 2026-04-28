export type ToastType = 'info' | 'success' | 'error' | 'warning';

export type ToastAction = { label: string; onClick: () => void };

export type Toast = {
  id: number;
  type: ToastType;
  message: string;
  removing?: boolean;
  action?: ToastAction;
};

let nextId = 0;
let toasts = $state<Toast[]>([]);

export function getToasts(): Toast[] {
  return toasts;
}

export function addToast(
  type: ToastType,
  message: string,
  durationMs = 4000,
  action?: ToastAction
) {
  const id = nextId++;
  toasts = [...toasts, { id, type, message, action }];

  if (durationMs > 0) {
    setTimeout(() => removeToast(id), durationMs);
  }

  return id;
}

export function removeToast(id: number) {
  const idx = toasts.findIndex(t => t.id === id);
  if (idx === -1) return;

  // Mark as removing for exit animation
  toasts = toasts.map(t => (t.id === id ? { ...t, removing: true } : t));
  setTimeout(() => {
    toasts = toasts.filter(t => t.id !== id);
  }, 200);
}

export const toast = {
  info: (msg: string, duration?: number, action?: ToastAction) =>
    addToast('info', msg, duration, action),
  success: (msg: string, duration?: number, action?: ToastAction) =>
    addToast('success', msg, duration, action),
  error: (msg: string, duration?: number, action?: ToastAction) =>
    addToast('error', msg, duration, action),
  warning: (msg: string, duration?: number, action?: ToastAction) =>
    addToast('warning', msg, duration, action),
};
