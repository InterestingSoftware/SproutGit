// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ToolTestResult } from '@sproutgit/types';

// @sproutgit/ui's barrel (index.ts) eagerly re-exports MonacoEditor alongside
// Spinner, which pulls in monaco-editor at module-eval time — monaco probes
// document.queryCommandSupported, which jsdom doesn't implement, crashing the
// import before any test body (and any beforeAll stub) can run. SettingsToolRow
// only actually uses Spinner, so mock the barrel down to just that.
vi.mock('@sproutgit/ui', () => ({
  Spinner: ({ size }: { size?: string }) => <div role="status" data-size={size} />,
}));

import { SettingsToolRow, type ToolPreset } from '../SettingsToolRow.js';

afterEach(() => { cleanup(); });

const presets: ToolPreset[] = [
  { id: 'vscode', name: 'VS Code', active: false },
  { id: 'sublime', name: 'Sublime Text', active: true },
];

function renderRow(overrides: Partial<React.ComponentProps<typeof SettingsToolRow>> = {}) {
  const onSelectPreset = vi.fn();
  const onCustomValueChange = vi.fn();
  const onSaveCustom = vi.fn();
  const onToast = vi.fn();
  const props = {
    icon: <span data-testid="icon" />,
    title: 'Editor',
    currentValueLabel: 'Sublime Text',
    presets,
    onSelectPreset,
    customValue: '',
    onCustomValueChange,
    onSaveCustom,
    onToast,
    testId: 'editor-row',
    ...overrides,
  };
  const utils = render(<SettingsToolRow {...props} />);
  return { ...utils, onSelectPreset, onCustomValueChange, onSaveCustom, onToast };
}

describe('SettingsToolRow', () => {
  it('renders the title and current value summary, with the edit panel collapsed by default', () => {
    renderRow();
    expect(screen.getByText('Editor')).toBeTruthy();
    expect(screen.getByText('Sublime Text')).toBeTruthy();
    expect(screen.queryByTestId('editor-row-input-custom')).toBeNull();
    expect(screen.queryByText('VS Code')).toBeNull();
  });

  it('clicking Edit reveals the preset buttons and custom input; clicking again (Done) hides them', async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(screen.getByTestId('editor-row-btn-edit'));
    expect(screen.getByText('VS Code')).toBeTruthy();
    expect(screen.getByText('Sublime Text', { selector: 'button' })).toBeTruthy();
    expect(screen.getByTestId('editor-row-input-custom')).toBeTruthy();

    await user.click(screen.getByTestId('editor-row-btn-edit'));
    expect(screen.queryByTestId('editor-row-input-custom')).toBeNull();
  });

  it('marks the active preset with distinct styling from inactive ones', async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByTestId('editor-row-btn-edit'));

    const activeBtn = screen.getByText('Sublime Text', { selector: 'button' });
    const inactiveBtn = screen.getByText('VS Code');
    expect(activeBtn.className).toContain('border-(--sg-primary)');
    expect(inactiveBtn.className).not.toContain('border-(--sg-primary)');
  });

  it('selecting a preset calls onSelectPreset with that preset\'s id', async () => {
    const user = userEvent.setup();
    const { onSelectPreset } = renderRow();
    await user.click(screen.getByTestId('editor-row-btn-edit'));

    await user.click(screen.getByText('VS Code'));
    expect(onSelectPreset).toHaveBeenCalledWith('vscode');
    expect(onSelectPreset).toHaveBeenCalledTimes(1);
  });

  it('typing in the custom input calls onCustomValueChange with the new value', async () => {
    const user = userEvent.setup();
    const { onCustomValueChange } = renderRow();
    await user.click(screen.getByTestId('editor-row-btn-edit'));

    await user.type(screen.getByTestId('editor-row-input-custom'), 'x');
    expect(onCustomValueChange).toHaveBeenCalledWith('x');
  });

  it('clicking Save calls onSaveCustom', async () => {
    const user = userEvent.setup();
    const { onSaveCustom } = renderRow();
    await user.click(screen.getByTestId('editor-row-btn-edit'));

    await user.click(screen.getByTestId('editor-row-btn-save'));
    expect(onSaveCustom).toHaveBeenCalledTimes(1);
  });

  it('does not render a Test button when onTest is not provided', () => {
    renderRow();
    expect(screen.queryByTestId('editor-row-btn-test')).toBeNull();
  });

  it('clicking Test shows a passing result and fires a success toast', async () => {
    const user = userEvent.setup();
    const result: ToolTestResult = { ok: true, resolvedCommand: '/usr/bin/subl /tmp/scratch.txt', detail: 'Editor launched successfully (pid 123).' };
    const onTest = vi.fn().mockResolvedValue(result);
    const { onToast } = renderRow({ onTest });

    await user.click(screen.getByTestId('editor-row-btn-test'));

    await waitFor(() => {
      expect(screen.getByTestId('editor-row-test-result')).toBeTruthy();
    });
    expect(screen.getByText('Test passed')).toBeTruthy();
    expect(screen.getByText(/pid 123/)).toBeTruthy();
    expect(onToast).toHaveBeenCalledWith('Editor: test passed — Editor launched successfully (pid 123).', 'success');
  });

  it('clicking Test shows a failing result with the error message and fires an error toast', async () => {
    const user = userEvent.setup();
    const result: ToolTestResult = { ok: false, resolvedCommand: '/usr/bin/subl', detail: '', error: 'Command not found on PATH: subl' };
    const onTest = vi.fn().mockResolvedValue(result);
    const { onToast } = renderRow({ onTest });

    await user.click(screen.getByTestId('editor-row-btn-test'));

    await waitFor(() => {
      expect(screen.getByTestId('editor-row-test-result')).toBeTruthy();
    });
    expect(screen.getByText('Test failed')).toBeTruthy();
    expect(screen.getByText('Command not found on PATH: subl')).toBeTruthy();
    expect(onToast).toHaveBeenCalledWith('Editor: test failed — Command not found on PATH: subl', 'error');
  });

  it('handles onTest rejecting (thrown error) as a failed result with a toast', async () => {
    const user = userEvent.setup();
    const onTest = vi.fn().mockRejectedValue(new Error('spawn failed'));
    const { onToast } = renderRow({ onTest });

    await user.click(screen.getByTestId('editor-row-btn-test'));

    await waitFor(() => {
      expect(screen.getByTestId('editor-row-test-result')).toBeTruthy();
    });
    expect(screen.getByText('Test failed')).toBeTruthy();
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining('test failed'), 'error');
  });

  it('disables the Test button while a test is in flight', async () => {
    const user = userEvent.setup();
    let resolveTest!: (r: ToolTestResult) => void;
    const onTest = vi.fn(() => new Promise<ToolTestResult>(resolve => { resolveTest = resolve; }));
    renderRow({ onTest });

    const testBtn = screen.getByTestId('editor-row-btn-test');
    await user.click(testBtn);
    expect((testBtn as HTMLButtonElement).disabled).toBe(true);

    resolveTest({ ok: true, resolvedCommand: 'cmd', detail: 'done' });
    await waitFor(() => expect((testBtn as HTMLButtonElement).disabled).toBe(false));
  });

  it('renders belowSummary content when provided', () => {
    renderRow({ belowSummary: <div data-testid="mode-toggle">Mode toggle</div> });
    expect(screen.getByTestId('mode-toggle')).toBeTruthy();
  });
});
