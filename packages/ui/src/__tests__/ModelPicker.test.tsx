import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelPicker, modelMetaLabel, type ModelPickerGroup } from '../components/ModelPicker.js';

afterEach(() => cleanup());

// jsdom doesn't implement scrollIntoView — stub it.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
});

const groups: ModelPickerGroup[] = [
  {
    groupId: 'anthropic',
    groupLabel: 'Anthropic',
    models: [
      { id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet', contextWindow: 200_000 },
      { id: 'claude-3-opus', label: 'Claude 3 Opus', contextWindow: 200_000 },
    ],
  },
  {
    groupId: 'openrouter',
    groupLabel: 'OpenRouter',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o', contextWindow: 128_000, pricing: { inputPerMTok: 2.5, outputPerMTok: 10 } },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', contextWindow: 1_000_000 },
    ],
  },
];

describe('ModelPicker', () => {
  it('renders the placeholder when nothing is selected', () => {
    render(<ModelPicker groups={groups} onChange={() => undefined} placeholder="Pick a model" />);
    expect(screen.getByText('Pick a model')).toBeTruthy();
  });

  it('shows all models grouped by provider when opened', async () => {
    const user = userEvent.setup();
    render(<ModelPicker groups={groups} onChange={() => undefined} />);
    await user.click(screen.getByTestId('model-picker-trigger'));
    expect(screen.getByText('Anthropic')).toBeTruthy();
    expect(screen.getByText('OpenRouter')).toBeTruthy();
    expect(screen.getAllByTestId('model-picker-option')).toHaveLength(4);
  });

  it('fuzzy-filters and ranks the best match first as the user types', async () => {
    const user = userEvent.setup();
    render(<ModelPicker groups={groups} onChange={() => undefined} />);
    await user.click(screen.getByTestId('model-picker-trigger'));
    await user.type(screen.getByTestId('model-picker-input'), 'gpt4o');
    const options = screen.getAllByTestId('model-picker-option');
    expect(options).toHaveLength(1);
    expect(options[0]!.textContent).toContain('GPT-4o');
  });

  it('filters by provider/group name too', async () => {
    const user = userEvent.setup();
    render(<ModelPicker groups={groups} onChange={() => undefined} />);
    await user.click(screen.getByTestId('model-picker-trigger'));
    await user.type(screen.getByTestId('model-picker-input'), 'anthropic');
    const options = screen.getAllByTestId('model-picker-option');
    expect(options).toHaveLength(2);
  });

  it('shows "No models found" when nothing matches', async () => {
    const user = userEvent.setup();
    render(<ModelPicker groups={groups} onChange={() => undefined} />);
    await user.click(screen.getByTestId('model-picker-trigger'));
    await user.type(screen.getByTestId('model-picker-input'), 'zzz-nonexistent');
    expect(screen.getByText('No models found')).toBeTruthy();
  });

  it('calls onChange with the selected model id and closes the dropdown', async () => {
    const user = userEvent.setup();
    let selected: string | undefined;
    render(<ModelPicker groups={groups} onChange={(id) => { selected = id; }} />);
    await user.click(screen.getByTestId('model-picker-trigger'));
    await user.click(screen.getByText('Gemini 1.5 Pro'));
    expect(selected).toBe('gemini-1.5-pro');
    expect(screen.queryByTestId('model-picker-list')).toBeNull();
  });

  it('keyboard-selects the visually highlighted row even when its match rank interleaves with another group', async () => {
    // Query "ap" scores 'Apple' (rank 0) > 'Zap' (rank 1, different group) >
    // 'Zulu Apple' (rank 2) by fuzzy match position — so the score-sorted
    // order splits group A's two entries across group B's one entry. Once
    // regrouped for display, group A's entries end up adjacent (indices 0-1)
    // and group B's entry is last (index 2). Arrowing down twice should land
    // on — and Enter should select — the row actually highlighted on screen
    // (Zap), not whatever sat at index 2 of the pre-group sorted list.
    const interleavedGroups: ModelPickerGroup[] = [
      { groupId: 'a', groupLabel: 'Group A', models: [
        { id: 'apple', label: 'Apple' },
        { id: 'zulu-apple', label: 'Zulu Apple' },
      ] },
      { groupId: 'b', groupLabel: 'Group B', models: [
        { id: 'zap', label: 'Zap' },
      ] },
    ];
    const user = userEvent.setup();
    let selected: string | undefined;
    render(<ModelPicker groups={interleavedGroups} onChange={(id) => { selected = id; }} />);
    await user.click(screen.getByTestId('model-picker-trigger'));
    await user.type(screen.getByTestId('model-picker-input'), 'ap');

    const options = screen.getAllByTestId('model-picker-option');
    expect(options.map((o) => o.textContent)).toEqual(['Apple', 'Zulu Apple', 'Zap']);

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(selected).toBe('zap');
  });

  it('ignores Arrow/Enter navigation when there are no matches, without throwing', async () => {
    const user = userEvent.setup();
    let selected: string | undefined;
    render(<ModelPicker groups={groups} onChange={(id) => { selected = id; }} />);
    await user.click(screen.getByTestId('model-picker-trigger'));
    await user.type(screen.getByTestId('model-picker-input'), 'zzz-nonexistent');

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(selected).toBeUndefined();
    expect(screen.getByText('No models found')).toBeTruthy();
  });
});

describe('modelMetaLabel', () => {
  it('formats context window and pricing together', () => {
    expect(modelMetaLabel({ id: 'x', label: 'X', contextWindow: 128_000, pricing: { inputPerMTok: 2.5, outputPerMTok: 10 } }))
      .toBe('128K ctx · $2.50/$10 per MTok');
  });

  it('returns just the context window when pricing is unknown', () => {
    expect(modelMetaLabel({ id: 'x', label: 'X', contextWindow: 200_000 })).toBe('200K ctx');
  });

  it('returns undefined when nothing is known', () => {
    expect(modelMetaLabel({ id: 'x', label: 'X' })).toBeUndefined();
  });
});
