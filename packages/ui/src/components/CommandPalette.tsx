import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { fuzzyFilterSort } from '../fuzzy.js';

export type CommandPaletteItem = {
  id: string;
  label: string;
  group?: string;
  keywords?: string;
  icon?: ReactNode;
  shortcut?: string;
  onSelect: () => void;
};

type Props = {
  open: boolean;
  onClose: () => void;
  items: CommandPaletteItem[];
  placeholder?: string;
};

/** Cmd/Ctrl+K palette: fuzzy-searchable list of actions. Rendered via portal so it always sits above the rest of the app. */
export function CommandPalette({ open, onClose, items, placeholder = 'Type a command or search…' }: Props) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const filtered = useMemo(
    () => fuzzyFilterSort(items, query, item => `${item.label} ${item.keywords ?? ''}`),
    [items, query],
  );

  useEffect(() => { setActiveIndex(0); }, [query]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(i => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = filtered[activeIndex];
        if (item) {
          item.onSelect();
          onClose();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, activeIndex, onClose]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  // Group items, preserving first-appearance order of each group name.
  const groups: { name: string; items: CommandPaletteItem[] }[] = [];
  for (const item of filtered) {
    const name = item.group ?? '';
    let group = groups.find(g => g.name === name);
    if (!group) { group = { name, items: [] }; groups.push(group); }
    group.items.push(item);
  }
  let runningIndex = -1;

  return createPortal(
    <div
      className="fixed inset-0 z-9999 bg-black/45 flex items-start justify-center pt-[15vh]"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="command-palette"
    >
      <div
        className="w-full max-w-[560px] mx-4 bg-(--sg-surface) border border-(--sg-border) rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.35)] overflow-hidden"
        role="dialog"
        aria-modal
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-(--sg-border)">
          <Search size={15} className="text-(--sg-text-faint) shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent border-none outline-none text-sm text-(--sg-text) placeholder:text-(--sg-text-faint)"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            data-testid="command-palette-input"
          />
        </div>
        <div ref={listRef} className="max-h-[360px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="text-center text-xs text-(--sg-text-faint) py-6 m-0">No matching commands</p>
          ) : groups.map(group => (
            <div key={group.name || '_'} className="mb-1 last:mb-0">
              {group.name && (
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-(--sg-text-faint)">
                  {group.name}
                </div>
              )}
              {group.items.map(item => {
                runningIndex++;
                const index = runningIndex;
                const active = index === activeIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-index={index}
                    data-testid="command-palette-item"
                    className={`sg-command-palette-item flex w-full items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-[13px] border-none cursor-pointer transition-colors ${active
                        ? 'bg-[color-mix(in_srgb,var(--sg-primary)_12%,transparent)] text-(--sg-text)'
                        : 'bg-transparent text-(--sg-text-dim) hover:bg-(--sg-surface-raised)'
                      }`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => { item.onSelect(); onClose(); }}
                  >
                    {item.icon && (
                      <span className="flex items-center justify-center w-4 h-4 shrink-0 text-(--sg-text-faint) [&>svg]:h-3.5 [&>svg]:w-3.5">
                        {item.icon}
                      </span>
                    )}
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.shortcut && (
                      <span className="text-[10px] text-(--sg-text-faint) shrink-0">{item.shortcut}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
