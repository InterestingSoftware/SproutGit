import { Pencil, FlaskConical, CheckCircle2, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Spinner } from '@sproutgit/ui';
import type { ToolTestResult } from '@sproutgit/types';

/**
 * Shared settings row: current-value display + icon, an "Edit" toggle that
 * reveals preset buttons plus a custom-command input and Save, and an
 * optional "Test" button that runs a real scenario and shows the result
 * inline. Modeled on the editor/diff-tool/merge-tool rows in GitSection.tsx
 * — reused by AgentsSection, CommitMessageGeneratorSection, and
 * ShellSection so every "configure an external tool" row looks and behaves
 * the same way.
 */

export type ToolPreset = {
  id: string;
  name: string;
  /** Whether this preset is currently selected/active, for the highlighted-button style. */
  active?: boolean;
};

type Props = {
  icon: ReactNode;
  title: string;
  /** Current-value summary shown when not editing, e.g. the resolved tool name or "(not set)". */
  currentValueLabel: string;
  /** Preset quick-pick buttons shown while editing. */
  presets?: ToolPreset[];
  onSelectPreset?: (id: string) => void;
  /** Custom command input, shown while editing. */
  customValue: string;
  onCustomValueChange: (value: string) => void;
  customPlaceholder?: string;
  onSaveCustom: () => void | Promise<void>;
  /** Extra content rendered under the custom input while editing (e.g. "not found" hints). */
  editExtra?: ReactNode;
  /** Extra content always rendered under the summary line (e.g. mode toggle). */
  belowSummary?: ReactNode;
  /** When provided, shows a "Test" button that runs a real scenario for this row. */
  onTest?: () => Promise<ToolTestResult>;
  testId?: string;
  /** Fires a toast with the pass/fail headline alongside the inline detail panel. */
  onToast?: (msg: string, variant?: 'success' | 'error') => void;
};

export function SettingsToolRow({
  icon,
  title,
  currentValueLabel,
  presets = [],
  onSelectPreset,
  customValue,
  onCustomValueChange,
  customPlaceholder,
  onSaveCustom,
  editExtra,
  belowSummary,
  onTest,
  testId,
  onToast,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ToolTestResult | null>(null);

  async function runTest() {
    if (!onTest) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await onTest();
      setTestResult(result);
      const headline = result.ok ? `${title}: test passed` : `${title}: test failed`;
      const body = result.ok ? result.detail : (result.error || result.detail);
      onToast?.(body ? `${headline} — ${body}` : headline, result.ok ? 'success' : 'error');
    } catch (err) {
      setTestResult({ ok: false, resolvedCommand: '', detail: '', error: String(err) });
      onToast?.(`${title}: test failed — ${String(err)}`, 'error');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="px-5 py-4" data-testid={testId}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex gap-2.5 min-w-0">
          <div className="mt-0.5 shrink-0 text-(--sg-text-faint)">{icon}</div>
          <div className="min-w-0">
            <p className="sg-heading text-xs font-semibold text-(--sg-text)">{title}</p>
            <p className="text-[11px] text-(--sg-text-faint) truncate">{currentValueLabel}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onTest && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-(--sg-border) px-2.5 py-1 text-xs text-(--sg-text-dim) disabled:opacity-50 cursor-pointer bg-transparent"
              onClick={() => void runTest()}
              disabled={testing}
              data-testid={testId ? `${testId}-btn-test` : undefined}
            >
              {testing ? <Spinner size="sm" /> : <FlaskConical size={12} />} Test
            </button>
          )}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-(--sg-border) px-2.5 py-1 text-xs text-(--sg-text-dim) cursor-pointer bg-transparent"
            onClick={() => setEditing(v => !v)}
            data-testid={testId ? `${testId}-btn-edit` : undefined}
          >
            {editing ? 'Done' : <><Pencil size={12} /> Edit</>}
          </button>
        </div>
      </div>

      {belowSummary}

      {testResult && (
        <div
          className={`mt-2 rounded border px-2.5 py-2 text-[11px] ${testResult.ok ? 'border-(--sg-primary)/30 bg-(--sg-primary)/8 text-(--sg-text)' : 'border-(--sg-danger)/30 bg-(--sg-danger)/8 text-(--sg-text)'}`}
          data-testid={testId ? `${testId}-test-result` : undefined}
        >
          <div className="flex items-center gap-1.5 font-semibold">
            {testResult.ok ? <CheckCircle2 size={12} className="text-(--sg-primary)" /> : <XCircle size={12} className="text-(--sg-danger)" />}
            {testResult.ok ? 'Test passed' : 'Test failed'}
          </div>
          {testResult.resolvedCommand && (
            <p className="mt-1 font-mono text-[10px] text-(--sg-text-dim) break-all">{testResult.resolvedCommand}</p>
          )}
          {testResult.detail && <p className="mt-1 text-(--sg-text-dim)">{testResult.detail}</p>}
          {testResult.error && <p className="mt-1 text-(--sg-danger)">{testResult.error}</p>}
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-2 border-t border-(--sg-border) pt-3">
          {presets.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {presets.map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  className={`rounded border px-3 py-1.5 text-xs cursor-pointer ${preset.active ? 'border-(--sg-primary) text-(--sg-primary)' : 'border-(--sg-border) text-(--sg-text-dim)'}`}
                  onClick={() => onSelectPreset?.(preset.id)}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={customValue}
              onChange={e => onCustomValueChange(e.target.value)}
              className="min-w-0 flex-1 rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-2.5 py-1.5 font-mono text-xs text-(--sg-text)"
              placeholder={customPlaceholder}
              data-testid={testId ? `${testId}-input-custom` : undefined}
            />
            <button
              type="button"
              className="rounded border border-(--sg-border) px-3 py-1.5 text-xs text-(--sg-text) cursor-pointer bg-transparent"
              onClick={() => void onSaveCustom()}
              data-testid={testId ? `${testId}-btn-save` : undefined}
            >
              Save
            </button>
          </div>
          {editExtra}
        </div>
      )}
    </div>
  );
}
