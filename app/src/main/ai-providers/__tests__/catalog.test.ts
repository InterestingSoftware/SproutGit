import { describe, it, expect } from 'vitest';
import {
  normalizeAnthropicModels,
  normalizeGoogleModels,
  normalizeOllamaModels,
  normalizeOpenAIModels,
  normalizeOpenRouterModels,
} from '../catalog.js';

describe('normalizeAnthropicModels', () => {
  it('maps id/display_name and drops entries without an id', () => {
    const raw = {
      data: [
        { id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet' },
        { id: '', display_name: 'Nameless' },
        { display_name: 'No id at all' },
      ],
    };
    expect(normalizeAnthropicModels(raw)).toEqual([
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
    ]);
  });

  it('falls back to id as the name when display_name is missing', () => {
    expect(normalizeAnthropicModels({ data: [{ id: 'claude-3-opus' }] })).toEqual([
      { id: 'claude-3-opus', name: 'claude-3-opus' },
    ]);
  });

  it('returns an empty array for malformed input', () => {
    expect(normalizeAnthropicModels({})).toEqual([]);
    expect(normalizeAnthropicModels(null)).toEqual([]);
  });
});

describe('normalizeOpenAIModels', () => {
  it('maps each entry\'s id as both id and name (no metadata in this endpoint)', () => {
    const raw = { data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] };
    expect(normalizeOpenAIModels(raw)).toEqual([
      { id: 'gpt-4o', name: 'gpt-4o' },
      { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
    ]);
  });
});

describe('normalizeGoogleModels', () => {
  it('strips the "models/" prefix and sums input+output token limits into a context window', () => {
    const raw = {
      models: [
        { name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', inputTokenLimit: 2_000_000, outputTokenLimit: 8_192 },
      ],
    };
    expect(normalizeGoogleModels(raw)).toEqual([
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', contextWindow: 2_008_192 },
    ]);
  });

  it('omits contextWindow when token limits are missing', () => {
    const raw = { models: [{ name: 'models/gemini-nano', displayName: 'Gemini Nano' }] };
    const result = normalizeGoogleModels(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: 'gemini-nano', name: 'Gemini Nano' });
    expect('contextWindow' in result[0]!).toBe(false);
  });
});

describe('normalizeOpenRouterModels', () => {
  it('converts per-token string pricing to USD-per-million-tokens', () => {
    const raw = {
      data: [
        {
          id: 'openai/gpt-4o',
          name: 'GPT-4o',
          context_length: 128_000,
          pricing: { prompt: '0.0000025', completion: '0.00001' },
        },
      ],
    };
    expect(normalizeOpenRouterModels(raw)).toEqual([
      {
        id: 'openai/gpt-4o',
        name: 'GPT-4o',
        contextWindow: 128_000,
        pricing: { inputPerMTok: 2.5, outputPerMTok: 10 },
      },
    ]);
  });

  it('omits pricing entirely when neither prompt nor completion price is present', () => {
    const raw = { data: [{ id: 'free/model', name: 'Free Model', context_length: 8192 }] };
    const result = normalizeOpenRouterModels(raw);
    expect(result[0]).toEqual({ id: 'free/model', name: 'Free Model', contextWindow: 8192 });
    expect('pricing' in result[0]!).toBe(false);
  });
});

describe('normalizeOllamaModels', () => {
  it('maps the native /api/tags shape (name field)', () => {
    const raw = { models: [{ name: 'llama3.2:latest' }, { name: 'mistral:7b' }] };
    expect(normalizeOllamaModels(raw)).toEqual([
      { id: 'llama3.2:latest', name: 'llama3.2:latest' },
      { id: 'mistral:7b', name: 'mistral:7b' },
    ]);
  });

  it('falls back to the model field when name is absent', () => {
    expect(normalizeOllamaModels({ models: [{ model: 'phi3' }] })).toEqual([
      { id: 'phi3', name: 'phi3' },
    ]);
  });
});
