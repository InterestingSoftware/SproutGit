import { useEffect, useState } from "react";
import { Cloud, KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import { AI_PROVIDER_PRESETS } from "@sproutgit/types";
import type { AiProviderConfig, AiProviderPreset, AiProviderStatus } from "@sproutgit/types";
import type { ToastData } from "@sproutgit/ui";
import { api } from "../api.js";

interface Props {
  onToast: (msg: string, variant?: ToastData["variant"]) => void;
}

type DraftState = {
  preset: AiProviderPreset;
  name: string;
  baseUrl: string;
  apiKey: string;
};

function blankDraft(preset: AiProviderPreset): DraftState {
  return { preset, name: preset.name, baseUrl: preset.defaultBaseUrl, apiKey: "" };
}

/**
 * Settings: AI provider registry. Presets for Anthropic/OpenAI/Google/OpenRouter
 * plus a generic OpenAI-compatible endpoint (covers Ollama/LM Studio/vLLM/Azure/
 * proxies). API keys are entered here but never read back — the renderer only
 * ever learns "configured" via `hasApiKey`; the actual key material lives
 * encrypted under Electron `safeStorage` in the main process.
 */
export function AIProvidersSection({ onToast }: Props) {
  const [providers, setProviders] = useState<AiProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  function reload() {
    return api
      .listAiProviders()
      .then(setProviders)
      .catch((err: unknown) => onToast(`Failed to load AI providers: ${String(err)}`, "error"));
  }

  useEffect(() => {
    void reload().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveDraft() {
    if (!draft) return;
    if (draft.preset.baseUrlEditable && !draft.baseUrl.trim()) {
      onToast("Base URL is required", "error");
      return;
    }
    const config: AiProviderConfig = {
      id: "",
      presetId: draft.preset.id,
      kind: draft.preset.kind,
      name: draft.name.trim() || draft.preset.name,
      baseUrl: draft.baseUrl.trim(),
    };
    try {
      await api.upsertAiProvider(config, draft.apiKey.trim() || undefined);
      onToast(`${config.name} added`, "success");
      setDraft(null);
      await reload();
    } catch (err) {
      onToast(String(err), "error");
    }
  }

  async function removeProvider(providerId: string, name: string) {
    try {
      await api.deleteAiProvider(providerId);
      onToast(`${name} removed`, "success");
      await reload();
    } catch (err) {
      onToast(String(err), "error");
    }
  }

  async function refreshCatalog(providerId: string) {
    setRefreshingId(providerId);
    try {
      const catalog = await api.refreshAiProviderCatalog(providerId);
      if (catalog.error) onToast(`Refresh failed: ${catalog.error}`, "error");
      else onToast(`${catalog.models.length} model(s) found`, "success");
    } catch (err) {
      onToast(String(err), "error");
    } finally {
      setRefreshingId(null);
    }
  }

  if (loading) {
    return (
      <div className="px-5 py-5 text-xs text-(--sg-text-dim)" data-testid="ai-providers-section">
        Loading…
      </div>
    );
  }

  return (
    <div data-testid="ai-providers-section" className="px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-(--sg-text-dim) flex items-center gap-1.5">
          <Cloud size={13} /> AI Providers
        </h3>
        {!draft && (
          <div className="flex flex-wrap gap-1.5">
            {AI_PROVIDER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="inline-flex items-center gap-1 rounded border border-(--sg-border) px-2 py-1 text-[11px] text-(--sg-text-dim) cursor-pointer bg-transparent hover:border-(--sg-input-focus)"
                onClick={() => setDraft(blankDraft(preset))}
                data-testid={`btn-add-ai-provider-${preset.id}`}
              >
                <Plus size={11} /> {preset.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-(--sg-text-faint)">
        Powers the searchable model picker in the Chat panel and (later) other
        built-in AI features. API keys are encrypted at rest and never leave
        the main process.
      </p>

      {draft && (
        <div className="rounded border border-(--sg-border) p-3 space-y-2" data-testid="ai-provider-draft">
          <div className="text-[11px] font-medium text-(--sg-text-dim)">Add {draft.preset.name}</div>
          {draft.preset.kind === "openai-compatible" && (
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Name, e.g. Ollama (local)"
              className="w-full rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-2 py-1 text-xs text-(--sg-text)"
              data-testid="input-ai-provider-name"
            />
          )}
          {draft.preset.baseUrlEditable && (
            <input
              value={draft.baseUrl}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
              placeholder="Base URL, e.g. http://localhost:11434/v1"
              className="w-full rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-2 py-1 text-xs text-(--sg-text)"
              data-testid="input-ai-provider-base-url"
            />
          )}
          <input
            value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            placeholder="API key (leave blank if none needed)"
            type="password"
            className="w-full rounded border border-(--sg-input-border) bg-(--sg-input-bg) px-2 py-1 text-xs text-(--sg-text)"
            data-testid="input-ai-provider-api-key"
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border border-(--sg-primary) px-3 py-1 text-xs text-(--sg-primary) cursor-pointer bg-transparent"
              onClick={() => void saveDraft()}
              data-testid="btn-save-ai-provider"
            >
              Save
            </button>
            <button
              type="button"
              className="rounded border border-(--sg-border) px-3 py-1 text-xs text-(--sg-text-dim) cursor-pointer bg-transparent"
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {providers.length === 0 && !draft ? (
        <p className="text-[11px] text-(--sg-text-faint)">No providers configured yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {providers.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 rounded border border-(--sg-border) px-2.5 py-1.5"
              data-testid="ai-provider-row"
            >
              <div className="min-w-0">
                <div className="text-xs text-(--sg-text) truncate">{p.name}</div>
                <div className="text-[10px] text-(--sg-text-faint) truncate">{p.baseUrl}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`inline-flex items-center gap-1 text-[10px] ${p.hasApiKey ? "text-(--sg-primary)" : "text-(--sg-text-faint)"}`}
                  title={p.hasApiKey ? "API key configured" : "No API key set"}
                >
                  <KeyRound size={11} /> {p.hasApiKey ? "Configured" : "Not configured"}
                </span>
                <button
                  type="button"
                  className="rounded border border-(--sg-border) p-1 text-(--sg-text-dim) cursor-pointer bg-transparent disabled:opacity-50"
                  onClick={() => void refreshCatalog(p.id)}
                  disabled={refreshingId === p.id}
                  title="Refresh model catalog"
                  data-testid={`btn-refresh-ai-provider-${p.id}`}
                >
                  <RefreshCw size={11} className={refreshingId === p.id ? "animate-spin" : ""} />
                </button>
                <button
                  type="button"
                  className="rounded border border-(--sg-border) p-1 text-(--sg-danger) cursor-pointer bg-transparent"
                  onClick={() => void removeProvider(p.id, p.name)}
                  title="Remove provider"
                  data-testid={`btn-delete-ai-provider-${p.id}`}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
