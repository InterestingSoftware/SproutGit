/**
 * Non-secret provider config CRUD + in-memory catalog cache.
 *
 * Config (id/name/kind/baseUrl — no key material) is persisted under the
 * `aiProviders` settings key (JSON-encoded), the same k/v pattern as
 * `CommitMessageGeneratorSettings`. The model catalog cache is process
 * memory only (refetched on app restart) since it's cheap to refresh and
 * keeping it out of any file avoids ever persisting third-party pricing/model
 * data alongside user config.
 */
import { randomUUID } from 'node:crypto';
import { eq, type ConfigDb } from '@sproutgit/database';
import { settings } from '@sproutgit/database/schema/config';
import type { AiProviderCatalog, AiProviderConfig, AiProviderStatus } from '@sproutgit/types';
import {
  clearProviderApiKey,
  getProviderApiKey,
  hasProviderApiKey,
  setProviderApiKey,
} from './key-storage.js';
import { fetchCatalog } from './catalog.js';

const SETTINGS_KEY = 'aiProviders';

const catalogCache = new Map<string, AiProviderCatalog>();

function isAiProviderConfig(value: unknown): value is AiProviderConfig {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.presetId === 'string' &&
    typeof v.kind === 'string' &&
    typeof v.name === 'string' &&
    typeof v.baseUrl === 'string'
  );
}

function readConfigs(configDb: ConfigDb): AiProviderConfig[] {
  const row = configDb.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).get();
  if (!row?.value) return [];
  try {
    const parsed: unknown = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.filter(isAiProviderConfig) : [];
  } catch {
    return [];
  }
}

function writeConfigs(configDb: ConfigDb, configs: AiProviderConfig[]): void {
  configDb
    .insert(settings)
    .values({ key: SETTINGS_KEY, value: JSON.stringify(configs) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(configs) } })
    .run();
}

function toStatus(config: AiProviderConfig, userDataPath: string): AiProviderStatus {
  return { ...config, hasApiKey: hasProviderApiKey(userDataPath, config.id) };
}

export function listProviders(
  configDb: ConfigDb,
  userDataPath: string,
): AiProviderStatus[] {
  return readConfigs(configDb).map((c) => toStatus(c, userDataPath));
}

/** Creates a provider if `config.id` is empty, otherwise updates the existing entry. */
export function upsertProvider(
  configDb: ConfigDb,
  userDataPath: string,
  config: AiProviderConfig,
  apiKey: string | undefined,
): AiProviderStatus {
  const configs = readConfigs(configDb);
  const id = config.id || randomUUID();
  const next: AiProviderConfig = { ...config, id };
  const idx = configs.findIndex((c) => c.id === id);
  if (idx >= 0) configs[idx] = next;
  else configs.push(next);
  writeConfigs(configDb, configs);

  if (apiKey !== undefined) {
    if (apiKey.trim()) setProviderApiKey(userDataPath, id, apiKey.trim());
    else clearProviderApiKey(userDataPath, id);
  }

  catalogCache.delete(id);
  return toStatus(next, userDataPath);
}

export function deleteProvider(
  configDb: ConfigDb,
  userDataPath: string,
  providerId: string,
): void {
  const configs = readConfigs(configDb).filter((c) => c.id !== providerId);
  writeConfigs(configDb, configs);
  clearProviderApiKey(userDataPath, providerId);
  catalogCache.delete(providerId);
}

export function clearApiKey(
  configDb: ConfigDb,
  userDataPath: string,
  providerId: string,
): AiProviderStatus | null {
  const config = readConfigs(configDb).find((c) => c.id === providerId);
  if (!config) return null;
  clearProviderApiKey(userDataPath, providerId);
  return toStatus(config, userDataPath);
}

async function fetchAndCache(config: AiProviderConfig, userDataPath: string): Promise<AiProviderCatalog> {
  const apiKey = getProviderApiKey(userDataPath, config.id);
  try {
    const models = await fetchCatalog(config, apiKey);
    const catalog: AiProviderCatalog = { providerId: config.id, models, fetchedAt: Date.now() };
    catalogCache.set(config.id, catalog);
    return catalog;
  } catch (err) {
    const stale = catalogCache.get(config.id);
    const catalog: AiProviderCatalog = {
      providerId: config.id,
      models: stale?.models ?? [],
      ...(stale?.fetchedAt !== undefined ? { fetchedAt: stale.fetchedAt } : {}),
      error: err instanceof Error ? err.message : String(err),
    };
    catalogCache.set(config.id, catalog);
    return catalog;
  }
}

export async function getCatalog(
  configDb: ConfigDb,
  userDataPath: string,
  providerId: string,
): Promise<AiProviderCatalog> {
  const cached = catalogCache.get(providerId);
  if (cached) return cached;
  const config = readConfigs(configDb).find((c) => c.id === providerId);
  if (!config) return { providerId, models: [] };
  return fetchAndCache(config, userDataPath);
}

export async function refreshCatalog(
  configDb: ConfigDb,
  userDataPath: string,
  providerId: string,
): Promise<AiProviderCatalog> {
  const config = readConfigs(configDb).find((c) => c.id === providerId);
  if (!config) return { providerId, models: [] };
  return fetchAndCache(config, userDataPath);
}

export async function listAllCatalogs(
  configDb: ConfigDb,
  userDataPath: string,
): Promise<AiProviderCatalog[]> {
  const configs = readConfigs(configDb);
  return Promise.all(
    configs.map((c) => catalogCache.get(c.id) ?? fetchAndCache(c, userDataPath)),
  );
}
