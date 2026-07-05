import { IPC } from '@sproutgit/types';
import { openConfigDb, eq } from '@sproutgit/database';
import { settings } from '@sproutgit/database/schema/config';
import { handle } from './handle.js';

type ConfigDb = ReturnType<typeof openConfigDb>;

export function registerSettingsHandlers(configDb: ConfigDb): void {
  handle(IPC.SETTINGS_GET, (_e, key: string) => {
    const row = configDb.select().from(settings).where(eq(settings.key, key)).get();
    return row?.value ?? null;
  });

  handle(IPC.SETTINGS_SET, (_e, args: { key: string; value: string }) => {
    configDb
      .insert(settings)
      .values({ key: args.key, value: args.value })
      .onConflictDoUpdate({ target: settings.key, set: { value: args.value } })
      .run();
  });

  handle(IPC.SETTINGS_DELETE, (_e, key: string) => {
    configDb.delete(settings).where(eq(settings.key, key)).run();
  });

  handle(IPC.SETTINGS_GET_ALL, () => {
    return configDb.select().from(settings).all();
  });
}
