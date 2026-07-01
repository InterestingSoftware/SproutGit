import { DEFAULT_COMMIT_MESSAGE_GENERATOR_SETTINGS, type CommitMessageGeneratorSettings } from '@sproutgit/types';
import { api } from './api.js';

export const COMMIT_MESSAGE_GENERATOR_SETTINGS_KEY = 'commitMessageGenerator';

/** Loads the configured commit-message generator, falling back to the default preset. */
export async function loadCommitMessageGeneratorSettings(): Promise<CommitMessageGeneratorSettings> {
  const raw = await api.getSetting(COMMIT_MESSAGE_GENERATOR_SETTINGS_KEY);
  if (!raw) return DEFAULT_COMMIT_MESSAGE_GENERATOR_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<CommitMessageGeneratorSettings>;
    return {
      presetId: parsed.presetId ?? DEFAULT_COMMIT_MESSAGE_GENERATOR_SETTINGS.presetId,
      command: parsed.command ?? DEFAULT_COMMIT_MESSAGE_GENERATOR_SETTINGS.command,
      args: parsed.args ?? DEFAULT_COMMIT_MESSAGE_GENERATOR_SETTINGS.args,
    };
  } catch {
    return DEFAULT_COMMIT_MESSAGE_GENERATOR_SETTINGS;
  }
}

export async function saveCommitMessageGeneratorSettings(settings: CommitMessageGeneratorSettings): Promise<void> {
  await api.setSetting(COMMIT_MESSAGE_GENERATOR_SETTINGS_KEY, JSON.stringify(settings));
}
