/**
 * AI provider registry — lets the user point SproutGit's built-in AI features
 * (and the searchable model picker) at one or more LLM providers.
 *
 * Non-secret config is persisted under the `aiProviders` settings key
 * (JSON-encoded) in the config DB `settings` k/v table, mirroring
 * `CommitMessageGeneratorSettings`. API keys never go through that path —
 * they're encrypted at rest via Electron `safeStorage` (see
 * `app/src/main/ai-providers/key-storage.ts`) and never cross the IPC
 * boundary to the renderer; the renderer only ever sees `hasApiKey`.
 */

/** Which wire format/catalog-fetch strategy a provider uses. */
export type AiProviderKind =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'openrouter'
  | 'openai-compatible';

/** A built-in starting point shown in Settings — presets are just defaults; base URL is editable except where fixed. */
export type AiProviderPreset = {
  id: string;
  name: string;
  kind: AiProviderKind;
  /** Fixed for hosted providers; editable (and required) for the generic OpenAI-compatible preset. */
  defaultBaseUrl: string;
  /** Whether the base URL field is user-editable (true for OpenRouter/generic; false for fixed hosted APIs). */
  baseUrlEditable: boolean;
  docsUrl?: string;
};

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  { id: 'anthropic', name: 'Anthropic', kind: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com', baseUrlEditable: false, docsUrl: 'https://docs.anthropic.com/en/api/models-list' },
  { id: 'openai', name: 'OpenAI', kind: 'openai', defaultBaseUrl: 'https://api.openai.com/v1', baseUrlEditable: false, docsUrl: 'https://platform.openai.com/docs/api-reference/models' },
  { id: 'google', name: 'Google (Gemini)', kind: 'google', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', baseUrlEditable: false, docsUrl: 'https://ai.google.dev/api/models' },
  { id: 'openrouter', name: 'OpenRouter', kind: 'openrouter', defaultBaseUrl: 'https://openrouter.ai/api/v1', baseUrlEditable: false, docsUrl: 'https://openrouter.ai/docs/api-reference/list-available-models' },
  { id: 'openai-compatible', name: 'OpenAI-compatible endpoint', kind: 'openai-compatible', defaultBaseUrl: '', baseUrlEditable: true },
];

/**
 * A configured provider instance. There can be more than one of the same
 * `kind` (e.g. two `openai-compatible` entries for Ollama and a corporate
 * proxy), so each gets its own generated `id` — never the preset id.
 */
export type AiProviderConfig = {
  id: string;
  presetId: string;
  kind: AiProviderKind;
  /** User-facing label; defaults to the preset name, editable for openai-compatible entries. */
  name: string;
  baseUrl: string;
};

/** Renderer-visible view of a configured provider — never includes key material, only whether one is set. */
export type AiProviderStatus = AiProviderConfig & {
  hasApiKey: boolean;
};

/** One model as normalized from a provider's catalog endpoint. */
export type AiModelInfo = {
  id: string;
  name: string;
  /** Max input+output tokens, if the provider reports it. */
  contextWindow?: number;
  /** USD per million tokens, if the provider reports it. */
  pricing?: {
    inputPerMTok?: number;
    outputPerMTok?: number;
  };
};

/** Cached catalog for one provider. */
export type AiProviderCatalog = {
  providerId: string;
  models: AiModelInfo[];
  /** Epoch ms of the last successful fetch; undefined if never fetched. */
  fetchedAt?: number;
  /** Set if the last fetch attempt failed — stale `models` (if any) are still shown. */
  error?: string;
};
