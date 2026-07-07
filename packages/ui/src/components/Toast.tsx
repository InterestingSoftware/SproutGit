import { useEffect, useState } from 'react';
import { X, CheckCircle2, AlertCircle, Info, Copy, Check } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'info';

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastData = {
  id: string;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
};

type ToastProps = {
  toast: ToastData;
  onDismiss: (id: string) => void;
};

const ICONS: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle2 size={15} />,
  error: <AlertCircle size={15} />,
  info: <Info size={15} />,
};

const AUTO_DISMISS_MS = 5000;

const VARIANT_STYLES: Record<ToastVariant, { wrap: string; icon: string; bar: string }> = {
  success: {
    wrap: 'border-(--sg-primary)/30 bg-(--sg-surface)',
    icon: 'text-(--sg-primary)',
    bar: 'bg-(--sg-primary)',
  },
  error: {
    wrap: 'border-(--sg-danger)/30 bg-(--sg-surface)',
    icon: 'text-(--sg-danger)',
    bar: 'bg-(--sg-danger)',
  },
  info: {
    wrap: 'border-(--sg-border) bg-(--sg-surface)',
    icon: 'text-(--sg-text-dim)',
    bar: 'bg-(--sg-text-dim)',
  },
};

/** Single toast notification. Auto-dismisses after 5 s. */
export function Toast({ toast, onDismiss }: ToastProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const id = toast.id;
    const t = setTimeout(() => onDismiss(id), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [onDismiss, toast.id]);

  const styles = VARIANT_STYLES[toast.variant];

  const handleCopy = () => {
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(toast.message)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  return (
    <div
      className={`relative flex items-start gap-3 px-4 py-3 rounded-[10px] border shadow-[0_8px_24px_rgba(0,0,0,0.18)] min-w-[280px] max-w-[420px] overflow-hidden ${styles.wrap}`}
      role="alert"
      aria-live="assertive"
      data-testid="toast"
      data-toast-variant={toast.variant}
    >
      {/* Accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${styles.bar} rounded-l-[10px]`} />
      <span className={`shrink-0 mt-px ${styles.icon}`}>{ICONS[toast.variant]}</span>
      <span
        className="flex-1 text-[13px] leading-[1.45] text-(--sg-text) select-text break-words"
        style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
      >
        {toast.message}
      </span>
      <div className="flex items-center gap-0.5 shrink-0">
        {toast.action && (
          <button
            className="sg-toast-undo inline-flex items-center px-2 py-1 rounded-[6px] border-none cursor-pointer text-xs font-medium text-(--sg-primary) hover:bg-(--sg-surface-raised) transition-colors"
            onClick={() => {
              toast.action!.onClick();
              onDismiss(toast.id);
            }}
            data-testid="toast-undo"
          >
            {toast.action.label}
          </button>
        )}
        <button
          className="inline-flex items-center justify-center p-1 bg-transparent border-none cursor-pointer text-(--sg-text-faint) rounded-[5px] hover:bg-(--sg-surface-raised) hover:text-(--sg-text) transition-colors"
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy message'}
          data-testid="toast-copy"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
        <button
          className="inline-flex items-center justify-center p-1 bg-transparent border-none cursor-pointer text-(--sg-text-faint) rounded-[5px] hover:bg-(--sg-surface-raised) hover:text-(--sg-text) transition-colors"
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

type ContainerProps = {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
};

/** Renders all active toasts in the bottom-left corner. */
export function ToastContainer({ toasts, onDismiss }: ContainerProps) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed bottom-5 left-5 z-300 flex flex-col gap-2"
      aria-label="Notifications"
      data-testid="toast-container"
    >
      {toasts.map(t => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
