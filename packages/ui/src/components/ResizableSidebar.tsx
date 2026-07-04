import { useRef, useState } from 'react';

type Props = {
  /** Starting width in pixels. */
  initialWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  side?: 'left' | 'right';
  children: React.ReactNode;
  className?: string;
  /**
   * Enables a collapsed state that shrinks the sidebar down to `collapsedWidth`
   * instead of hiding it entirely — useful for keeping an icon rail visible.
   * When omitted, the sidebar behaves exactly as before (resize-only).
   */
  collapsible?: boolean;
  /**
   * Controlled collapsed state — the caller owns the toggle button/shortcut
   * (e.g. a rail-content button, a menu item, Cmd/Ctrl+B) and passes the
   * resulting boolean in here.
   */
  collapsed?: boolean;
  /** Width (px) used while collapsed. Defaults to 48 — enough for an icon rail. */
  collapsedWidth?: number;
  /** Content rendered while collapsed, in place of `children` (e.g. an icon rail). */
  railContent?: React.ReactNode;
};

/**
 * A panel with a drag handle that lets the user resize it horizontally.
 * Works for both left and right sidebars. Optionally supports a collapsed
 * "icon rail" state in addition to free resizing.
 */
export function ResizableSidebar({
  initialWidth = 240,
  minWidth = 160,
  maxWidth = 600,
  side = 'left',
  children,
  className,
  collapsible = false,
  collapsed = false,
  collapsedWidth = 48,
  railContent,
}: Props) {
  const [width, setWidth] = useState(initialWidth);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  function onMouseDown(e: React.MouseEvent) {
    if (collapsed) return;
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = side === 'left' ? ev.clientX - startX.current : startX.current - ev.clientX;
      const next = Math.min(maxWidth, Math.max(minWidth, startWidth.current + delta));
      setWidth(next);
    };

    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const isCollapsed = collapsible && collapsed;
  const effectiveWidth = isCollapsed ? collapsedWidth : width;

  return (
    <div
      className={['relative flex shrink-0 transition-[width] duration-150 ease-out', className]
        .filter(Boolean)
        .join(' ')}
      style={{ width: effectiveWidth, minWidth: 0 }}
      data-collapsed={isCollapsed ? 'true' : 'false'}
    >
      {side === 'right' && !isCollapsed && (
        <div
          className="absolute top-0 bottom-0 left-0 w-1 cursor-col-resize hover:bg-(--sg-primary) active:bg-(--sg-primary) z-10 transition-colors"
          onMouseDown={onMouseDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
        />
      )}
      <div className="flex-1 overflow-hidden">{isCollapsed ? (railContent ?? children) : children}</div>
      {side === 'left' && !isCollapsed && (
        <div
          className="absolute top-0 bottom-0 right-0 w-1 cursor-col-resize hover:bg-(--sg-primary) active:bg-(--sg-primary) z-10 transition-colors"
          onMouseDown={onMouseDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
        />
      )}
    </div>
  );
}
