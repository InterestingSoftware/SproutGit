import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { fuzzyScore } from '../fuzzy.js';

export type ModelPickerModel = {
  id: string;
  label: string;
  description?: string;
  /** Max context tokens, if known. */
  contextWindow?: number;
  /** USD per million tokens, if known. */
  pricing?: {
    inputPerMTok?: number;
    outputPerMTok?: number;
  };
};

export type ModelPickerGroup = {
  groupId: string;
  groupLabel: string;
  models: ModelPickerModel[];
};

type Props = {
  groups: ModelPickerGroup[];
  value?: string;
  onChange: (modelId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
};

type FlatRow = { group: ModelPickerGroup; model: ModelPickerModel; score: number };

function formatContextWindow(tokens: number): string {
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K ctx`;
  return `${tokens} ctx`;
}

function formatPricePerMTok(n: number): string {
  return n >= 10 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;
}

function formatPricing(pricing: ModelPickerModel['pricing']): string | undefined {
  if (!pricing) return undefined;
  const { inputPerMTok, outputPerMTok } = pricing;
  if (inputPerMTok === undefined && outputPerMTok === undefined) return undefined;
  const inStr = inputPerMTok !== undefined ? formatPricePerMTok(inputPerMTok) : '?';
  const outStr = outputPerMTok !== undefined ? formatPricePerMTok(outputPerMTok) : '?';
  return `${inStr}/${outStr} per MTok`;
}

/** Meta line shown under a model's label: context window + pricing, when known. */
export function modelMetaLabel(model: ModelPickerModel): string | undefined {
  const parts = [
    model.contextWindow !== undefined ? formatContextWindow(model.contextWindow) : undefined,
    formatPricing(model.pricing),
  ].filter((p): p is string => !!p);
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * Searchable, provider-grouped model picker. Fuzzy-matches against the
 * model label, description, and group label so typing a provider name
 * (e.g. "openrouter") narrows results too.
 */
export function ModelPicker({ groups, value, onChange, placeholder = 'Select a model…', disabled, className, id }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const allRows = useMemo<FlatRow[]>(
    () => groups.flatMap((group) => group.models.map((model) => ({ group, model, score: 0 }))),
    [groups],
  );

  const filteredRows = useMemo<FlatRow[]>(() => {
    const q = query.trim();
    if (!q) return allRows;
    return allRows
      .map((row) => {
        const haystack = `${row.model.label} ${row.model.description ?? ''} ${row.group.groupLabel}`;
        const score = fuzzyScore(q, haystack);
        return score === null ? null : { ...row, score };
      })
      .filter((r): r is FlatRow => r !== null)
      .sort((a, b) => b.score - a.score);
  }, [allRows, query]);

  const selected = allRows.find((r) => r.model.id === value)?.model;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-row-index="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  function select(row: FlatRow) {
    onChange(row.model.id);
    setOpen(false);
    setQuery('');
  }

  function handleOpen() {
    if (disabled) return;
    setOpen(true);
    setActiveIdx(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filteredRows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = filteredRows[activeIdx];
      if (row) select(row);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }

  const inputCls = 'w-full pl-7 pr-[10px] py-[6px] bg-(--sg-input-bg) border border-(--sg-input-border) rounded-[6px] text-xs text-(--sg-text) outline-none focus:border-(--sg-input-focus)';
  const triggerCls = 'w-full flex items-center justify-between gap-2 px-[10px] py-[6px] bg-(--sg-input-bg) border border-(--sg-input-border) rounded-[6px] text-xs text-(--sg-text) cursor-pointer hover:border-(--sg-input-focus) disabled:opacity-50 disabled:cursor-not-allowed';

  let rowIndex = -1;

  return (
    <div ref={containerRef} className={['relative w-full', className].filter(Boolean).join(' ')} data-testid="model-picker">
      {open ? (
        <div className="relative">
          <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-(--sg-text-faint)" />
          <input
            ref={inputRef}
            id={id}
            className={inputCls}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={selected?.label ?? placeholder}
            aria-autocomplete="list"
            aria-expanded
            aria-controls="sg-model-picker-list"
            role="combobox"
            data-testid="model-picker-input"
          />
        </div>
      ) : (
        <button id={id} className={triggerCls} onClick={handleOpen} disabled={disabled} type="button" data-testid="model-picker-trigger">
          <span className="truncate">{selected?.label ?? <span className="text-(--sg-text-faint)">{placeholder}</span>}</span>
          <ChevronDown size={12} className="shrink-0 text-(--sg-text-faint)" />
        </button>
      )}

      {open && (
        <ul
          ref={listRef}
          id="sg-model-picker-list"
          className="absolute top-full left-0 right-0 mt-1 bg-(--sg-surface) border border-(--sg-border) rounded-[6px] shadow-[0_4px_16px_rgba(0,0,0,0.12)] max-h-[280px] overflow-y-auto z-100 p-0 m-0 list-none"
          role="listbox"
          data-testid="model-picker-list"
        >
          {filteredRows.length === 0 ? (
            <li className="px-3 py-2 text-xs text-(--sg-text-faint)" role="option" aria-disabled>
              No models found
            </li>
          ) : (
            Object.entries(
              filteredRows.reduce<Record<string, FlatRow[]>>((acc, row) => {
                (acc[row.group.groupId] ??= []).push(row);
                return acc;
              }, {}),
            ).map(([groupId, rows]) => (
              <li key={groupId} role="presentation">
                <div className="sticky top-0 bg-(--sg-surface) px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-(--sg-text-faint)">
                  {rows[0]!.group.groupLabel}
                </div>
                <ul className="p-0 m-0 list-none">
                  {rows.map((row) => {
                    rowIndex += 1;
                    const idx = rowIndex;
                    const meta = modelMetaLabel(row.model);
                    return (
                      <li
                        key={row.model.id}
                        data-row-index={idx}
                        className={`flex items-center justify-between gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors ${idx === activeIdx ? 'bg-(--sg-surface-raised)' : 'hover:bg-(--sg-surface-raised)'}`}
                        role="option"
                        aria-selected={row.model.id === value}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          select(row);
                        }}
                        onMouseEnter={() => setActiveIdx(idx)}
                        data-testid="model-picker-option"
                      >
                        <span className="truncate">{row.model.label}</span>
                        {meta && <span className="text-[10px] text-(--sg-text-faint) shrink-0 pl-2">{meta}</span>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
