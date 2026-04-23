import { test as base } from '@playwright/test';
import {
  PluginClient,
  TauriPage,
  TauriProcessManager,
  tauriExpect as expect,
} from '@srsholmes/tauri-playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MCP_SOCKET =
  process.env.SPROUTGIT_PLAYWRIGHT_SOCKET_PATH ??
  join(tmpdir(), 'sproutgit-playwright.sock');
const TCP_PORT = Number.parseInt(process.env.SPROUTGIT_PLAYWRIGHT_TCP_PORT ?? '6274', 10) || 6274;
const TAURI_COMMAND = process.env.SPROUTGIT_E2E_TAURI_COMMAND;
const TAURI_CWD = process.env.SPROUTGIT_E2E_TAURI_CWD;
const IS_WINDOWS = process.platform === 'win32';

type Fixtures = {
  mode: 'tauri';
  tauriPage: TauriPage;
};

export const test = base.extend<Fixtures>({
  mode: ['tauri', { option: true }],
  tauriPage: async ({ mode }, use) => {
    if (mode !== 'tauri') {
      throw new Error(`Unsupported E2E mode: ${mode}`);
    }

    let processManager: TauriProcessManager | null = null;
    let client: PluginClient | null = null;

    try {
      if (TAURI_COMMAND) {
        const [command, ...args] = TAURI_COMMAND.split(' ');
        processManager = new TauriProcessManager({
          command,
          args,
          cwd: TAURI_CWD,
          socketPath: IS_WINDOWS ? undefined : MCP_SOCKET,
          tcpPort: TCP_PORT,
          startTimeout: 120,
        });

        const connection = await processManager.start();
        client = connection.tcpPort
          ? new PluginClient(undefined, connection.tcpPort)
          : new PluginClient(connection.socketPath ?? MCP_SOCKET, undefined);
      } else {
        if (!IS_WINDOWS) {
          const waitManager = new TauriProcessManager({ socketPath: MCP_SOCKET });
          await waitManager.waitForSocket(30_000);
        }

        client = IS_WINDOWS
          ? new PluginClient(undefined, TCP_PORT)
          : new PluginClient(MCP_SOCKET, undefined);
      }

      await client.connect();
      const ping = await client.send({ type: 'ping' });
      if (!ping.ok) {
        throw new Error('Plugin ping failed');
      }

      const tauriPage = new TauriPage(client);
      await use(tauriPage);
    } finally {
      client?.disconnect();
      processManager?.stop();
    }
  },
});

export { expect };
