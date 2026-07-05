import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export type ErrorModalData = {
  title?: string;
  message: string;
  stack?: string;
};

type Props = {
  error: ErrorModalData;
  onDismiss: () => void;
};

/**
 * Last-resort modal for genuinely unexpected errors (uncaught exceptions,
 * unhandled rejections, renderer/child-process crashes). Not meant to be
 * "friendly" — just legible and copyable so the user can attach it to a bug
 * report.
 */
export function ErrorModal({ error, onDismiss }: Props) {
  const [copied, setCopied] = useState(false);

  function copyDetails() {
    const details = [error.title ?? 'Unexpected error', error.message, error.stack]
      .filter(Boolean)
      .join('\n\n');
    // Clipboard access can be denied/unavailable — that's non-fatal here, so
    // swallow it rather than let it become an unhandled rejection (which
    // would otherwise trip the app's own global error handler).
    navigator.clipboard.writeText(details).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => undefined);
  }

  const secondaryBtn = 'inline-flex items-center gap-[5px] px-3 py-[5px] rounded-[6px] cursor-pointer text-xs font-medium transition-colors whitespace-nowrap bg-transparent border border-(--sg-border) text-(--sg-text-dim) hover:bg-(--sg-surface-raised)';
  const primaryBtn = 'inline-flex items-center gap-[5px] px-3 py-[5px] rounded-[6px] border-none cursor-pointer text-xs font-medium transition-colors whitespace-nowrap bg-(--sg-primary) text-white hover:bg-(--sg-primary-hover)';

  return (
    <div className="fixed inset-0 z-500 bg-black/45 flex items-center justify-center" onClick={onDismiss}>
      <div
        className="bg-(--sg-surface) border border-(--sg-border) rounded-[12px] p-6 w-[560px] max-w-[90vw] max-h-[80vh] flex flex-col shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-modal
        aria-labelledby="sg-error-modal-title"
        data-testid="error-modal"
      >
        <h2 id="sg-error-modal-title" className="text-[15px] font-semibold m-0 mb-[10px] text-(--sg-danger)">
          {error.title ?? 'Unexpected error'}
        </h2>
        <p className="text-[13px] text-(--sg-text) m-0 mb-3 break-words select-text">{error.message}</p>
        {error.stack && (
          <pre className="flex-1 overflow-auto text-[11px] leading-[1.5] font-mono bg-(--sg-surface-raised) border border-(--sg-border-subtle) rounded-[8px] p-3 m-0 mb-4 whitespace-pre-wrap break-words text-(--sg-text-dim) select-text">
            {error.stack}
          </pre>
        )}
        <div className="flex gap-2 justify-end mt-auto">
          <button className={secondaryBtn} onClick={copyDetails}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy details'}
          </button>
          <button className={primaryBtn} onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}
