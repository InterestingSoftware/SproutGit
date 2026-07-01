import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_COMMIT_MESSAGE_GENERATOR_SETTINGS } from '@sproutgit/types';

const { getSettingMock, setSettingMock } = vi.hoisted(() => ({
  getSettingMock: vi.fn(),
  setSettingMock: vi.fn(),
}));

vi.mock('../api.js', () => ({
  api: { getSetting: getSettingMock, setSetting: setSettingMock },
}));

import { loadCommitMessageGeneratorSettings, saveCommitMessageGeneratorSettings } from '../commit-message-generator-settings.js';

describe('loadCommitMessageGeneratorSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the default settings when nothing is persisted', async () => {
    getSettingMock.mockResolvedValue(null);
    const settings = await loadCommitMessageGeneratorSettings();
    expect(settings).toEqual(DEFAULT_COMMIT_MESSAGE_GENERATOR_SETTINGS);
  });

  it('returns the default settings when the persisted value is not valid JSON', async () => {
    getSettingMock.mockResolvedValue('not json{');
    const settings = await loadCommitMessageGeneratorSettings();
    expect(settings).toEqual(DEFAULT_COMMIT_MESSAGE_GENERATOR_SETTINGS);
  });

  it('returns a well-formed persisted setting as-is', async () => {
    getSettingMock.mockResolvedValue(JSON.stringify({ presetId: 'custom', command: 'echo', args: ['-n', 'hi'] }));
    const settings = await loadCommitMessageGeneratorSettings();
    expect(settings).toEqual({ presetId: 'custom', command: 'echo', args: ['-n', 'hi'] });
  });

  it('falls back per-field when persisted values have the wrong type', async () => {
    getSettingMock.mockResolvedValue(JSON.stringify({ presetId: 'custom', command: 123, args: 'not-an-array' }));
    const settings = await loadCommitMessageGeneratorSettings();
    expect(settings).toEqual({
      presetId: 'custom',
      command: DEFAULT_COMMIT_MESSAGE_GENERATOR_SETTINGS.command,
      args: DEFAULT_COMMIT_MESSAGE_GENERATOR_SETTINGS.args,
    });
  });

  it('falls back when args contains non-string entries', async () => {
    getSettingMock.mockResolvedValue(JSON.stringify({ presetId: 'custom', command: 'echo', args: ['-n', 42] }));
    const settings = await loadCommitMessageGeneratorSettings();
    expect(settings.args).toEqual(DEFAULT_COMMIT_MESSAGE_GENERATOR_SETTINGS.args);
  });
});

describe('saveCommitMessageGeneratorSettings', () => {
  it('persists settings as JSON under the expected key', async () => {
    setSettingMock.mockResolvedValue(undefined);
    await saveCommitMessageGeneratorSettings({ presetId: 'custom', command: 'echo', args: ['hi'] });
    expect(setSettingMock).toHaveBeenCalledWith('commitMessageGenerator', JSON.stringify({ presetId: 'custom', command: 'echo', args: ['hi'] }));
  });
});
