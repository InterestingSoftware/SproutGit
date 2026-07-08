/**
 * IPC handlers for the AI provider registry (see `../ai-providers/`).
 */
import { IPC } from '@sproutgit/types';
import type { AiProviderCatalog, AiProviderConfig, AiProviderStatus } from '@sproutgit/types';
import type { ConfigDb } from '@sproutgit/database';
import { handle } from './handle.js';
import {
  clearApiKey,
  deleteProvider,
  getCatalog,
  listAllCatalogs,
  listProviders,
  refreshCatalog,
  upsertProvider,
} from '../ai-providers/registry.js';

export function registerAiProviderHandlers(configDb: ConfigDb, userDataPath: string): void {
  handle(IPC.AI_PROVIDER_LIST, (): AiProviderStatus[] => listProviders(configDb, userDataPath));

  handle(IPC.AI_PROVIDER_UPSERT, (_e, args: { config: AiProviderConfig; apiKey?: string }): AiProviderStatus =>
    upsertProvider(configDb, userDataPath, args.config, args.apiKey),
  );

  handle(IPC.AI_PROVIDER_DELETE, (_e, providerId: string): void => {
    deleteProvider(configDb, userDataPath, providerId);
  });

  handle(IPC.AI_PROVIDER_CLEAR_API_KEY, (_e, providerId: string): AiProviderStatus | null =>
    clearApiKey(configDb, userDataPath, providerId),
  );

  handle(IPC.AI_PROVIDER_GET_CATALOG, (_e, providerId: string): Promise<AiProviderCatalog> =>
    getCatalog(configDb, userDataPath, providerId),
  );

  handle(IPC.AI_PROVIDER_REFRESH_CATALOG, (_e, providerId: string): Promise<AiProviderCatalog> =>
    refreshCatalog(configDb, userDataPath, providerId),
  );

  handle(IPC.AI_PROVIDER_LIST_ALL_CATALOGS, (): Promise<AiProviderCatalog[]> =>
    listAllCatalogs(configDb, userDataPath),
  );
}
