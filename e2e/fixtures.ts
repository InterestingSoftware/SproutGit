import { createTauriTest } from '@srsholmes/tauri-playwright';

const DEV_HOST = process.env.SPROUTGIT_E2E_DEV_HOST ?? 'localhost';
const DEV_PORT = Number.parseInt(process.env.SPROUTGIT_E2E_DEV_PORT ?? '1420', 10);
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`;
const MCP_SOCKET = process.env.SPROUTGIT_PLAYWRIGHT_SOCKET_PATH ?? '/tmp/sproutgit-playwright.sock';
const TAURI_COMMAND = process.env.SPROUTGIT_E2E_TAURI_COMMAND;
const TAURI_CWD = process.env.SPROUTGIT_E2E_TAURI_CWD;

export const { test, expect } = createTauriTest({
  devUrl: DEV_URL,
  mcpSocket: MCP_SOCKET,
  startTimeout: 120,
  ...(TAURI_COMMAND
    ? {
        tauriCommand: TAURI_COMMAND,
        tauriCwd: TAURI_CWD,
      }
    : {}),
});
