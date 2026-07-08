/**
 * Per-provider model catalog fetching + normalization.
 *
 * Each provider kind returns models in its own shape; `normalize*` functions
 * below are pure (no network) so they can be unit tested directly, while
 * `fetchCatalog` does the actual HTTP call and is exercised only via mocked
 * fetch in main-process tests.
 */
import type { AiModelInfo, AiProviderConfig } from '@sproutgit/types';

const FETCH_TIMEOUT_MS = 15_000;

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ── Anthropic ────────────────────────────────────────────────────────────────
// https://docs.anthropic.com/en/api/models-list — GET /v1/models

export function normalizeAnthropicModels(raw: unknown): AiModelInfo[] {
  const data = (raw as { data?: unknown[] })?.data ?? [];
  return data
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => ({
      id: String(m.id ?? ''),
      name: typeof m.display_name === 'string' ? m.display_name : String(m.id ?? ''),
    }))
    .filter((m) => m.id);
}

// ── OpenAI ───────────────────────────────────────────────────────────────────
// https://platform.openai.com/docs/api-reference/models/list — GET /models
// (no pricing/context metadata in this endpoint)

export function normalizeOpenAIModels(raw: unknown): AiModelInfo[] {
  const data = (raw as { data?: unknown[] })?.data ?? [];
  return data
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => ({ id: String(m.id ?? ''), name: String(m.id ?? '') }))
    .filter((m) => m.id);
}

// ── Google (Gemini) ──────────────────────────────────────────────────────────
// https://ai.google.dev/api/models — GET /v1beta/models

export function normalizeGoogleModels(raw: unknown): AiModelInfo[] {
  const models = (raw as { models?: unknown[] })?.models ?? [];
  return models
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => {
      const name = typeof m.name === 'string' ? m.name : '';
      const id = name.startsWith('models/') ? name.slice('models/'.length) : name;
      const contextWindow =
        typeof m.inputTokenLimit === 'number' && typeof m.outputTokenLimit === 'number'
          ? m.inputTokenLimit + m.outputTokenLimit
          : undefined;
      return {
        id,
        name: typeof m.displayName === 'string' ? m.displayName : id,
        ...(contextWindow !== undefined ? { contextWindow } : {}),
      };
    })
    .filter((m) => m.id);
}

// ── OpenRouter ───────────────────────────────────────────────────────────────
// https://openrouter.ai/docs/api-reference/list-available-models — GET /models
// Includes pricing (USD per token, as strings) + context_length.

export function normalizeOpenRouterModels(raw: unknown): AiModelInfo[] {
  const data = (raw as { data?: unknown[] })?.data ?? [];
  return data
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => {
      const pricingRaw = m.pricing as Record<string, unknown> | undefined;
      const perTokenToPerMTok = (v: unknown): number | undefined => {
        const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : undefined;
        return n !== undefined && Number.isFinite(n) ? n * 1_000_000 : undefined;
      };
      const inputPerMTok = perTokenToPerMTok(pricingRaw?.prompt);
      const outputPerMTok = perTokenToPerMTok(pricingRaw?.completion);
      const contextWindow = typeof m.context_length === 'number' ? m.context_length : undefined;
      return {
        id: String(m.id ?? ''),
        name: typeof m.name === 'string' ? m.name : String(m.id ?? ''),
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        ...(inputPerMTok !== undefined || outputPerMTok !== undefined
          ? {
              pricing: {
                ...(inputPerMTok !== undefined ? { inputPerMTok } : {}),
                ...(outputPerMTok !== undefined ? { outputPerMTok } : {}),
              },
            }
          : {}),
      };
    })
    .filter((m) => m.id);
}

// ── Ollama (native /api/tags shape) ──────────────────────────────────────────
// https://github.com/ollama/ollama/blob/main/docs/api.md#list-local-models

export function normalizeOllamaModels(raw: unknown): AiModelInfo[] {
  const models = (raw as { models?: unknown[] })?.models ?? [];
  return models
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => ({ id: String(m.name ?? m.model ?? ''), name: String(m.name ?? m.model ?? '') }))
    .filter((m) => m.id);
}

/**
 * Fetches + normalizes the model catalog for one configured provider.
 * `openai-compatible` covers Ollama/LM Studio/vLLM/Azure/proxies — most
 * speak the OpenAI-style `/models` list, but Ollama's native API only
 * exposes `/api/tags`, so that's tried as a fallback.
 */
export async function fetchCatalog(provider: AiProviderConfig, apiKey: string | null): Promise<AiModelInfo[]> {
  const baseUrl = provider.baseUrl.replace(/\/+$/, '');

  switch (provider.kind) {
    case 'anthropic': {
      const raw = await fetchJson(`${baseUrl}/v1/models`, {
        'x-api-key': apiKey ?? '',
        'anthropic-version': '2023-06-01',
      });
      return normalizeAnthropicModels(raw);
    }
    case 'openai': {
      const raw = await fetchJson(`${baseUrl}/models`, {
        Authorization: `Bearer ${apiKey ?? ''}`,
      });
      return normalizeOpenAIModels(raw);
    }
    case 'google': {
      const raw = await fetchJson(`${baseUrl}/models?key=${encodeURIComponent(apiKey ?? '')}`, {});
      return normalizeGoogleModels(raw);
    }
    case 'openrouter': {
      const raw = await fetchJson(`${baseUrl}/models`, {
        Authorization: `Bearer ${apiKey ?? ''}`,
      });
      return normalizeOpenRouterModels(raw);
    }
    case 'openai-compatible': {
      const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      try {
        const raw = await fetchJson(`${baseUrl}/models`, headers);
        return normalizeOpenAIModels(raw);
      } catch {
        const raw = await fetchJson(`${baseUrl}/api/tags`, headers);
        return normalizeOllamaModels(raw);
      }
    }
  }
}
