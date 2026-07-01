/**
 * A built-in generator preset — seeds the default preset list shown in Settings.
 * Presets are just starting points; users edit `command`/`args` to taste.
 */
export type CommitMessageGeneratorPreset = {
  id: string;
  name: string;
  command: string;
  args: string[];
};

/**
 * User's configured generator, persisted under the `commitMessageGenerator`
 * settings key (JSON-encoded) in the config DB `settings` k/v table.
 */
export type CommitMessageGeneratorSettings = {
  presetId: string;
  command: string;
  args: string[];
};

const AGENT_PROMPT =
  'Write a commit message for this staged diff. Match the style of the recent commit subjects in $SPROUTGIT_RECENT_COMMITS. Output ONLY the commit message, no preamble.';

export const COMMIT_MESSAGE_GENERATOR_PRESETS: CommitMessageGeneratorPreset[] = [
  { id: 'claude-code', name: 'Claude Code', command: 'claude', args: ['-p', AGENT_PROMPT] },
  { id: 'kiro', name: 'Kiro', command: 'kiro', args: ['-p', AGENT_PROMPT] },
  { id: 'codex', name: 'Codex', command: 'codex', args: ['-p', AGENT_PROMPT] },
  { id: 'gemini', name: 'Gemini', command: 'gemini', args: ['-p', AGENT_PROMPT] },
  { id: 'custom', name: 'Custom', command: '', args: [] },
];

export const DEFAULT_COMMIT_MESSAGE_GENERATOR_SETTINGS: CommitMessageGeneratorSettings = {
  presetId: COMMIT_MESSAGE_GENERATOR_PRESETS[0]!.id,
  command: COMMIT_MESSAGE_GENERATOR_PRESETS[0]!.command,
  args: COMMIT_MESSAGE_GENERATOR_PRESETS[0]!.args,
};

/** Result of a COMMITMSG_GENERATE call — exactly one of the two fields is set. */
export type CommitMessageGenerateResult =
  | { message: string; error?: undefined }
  | { message?: undefined; error: string };
