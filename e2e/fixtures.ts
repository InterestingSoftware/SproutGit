import { createTauriTest } from '@srsholmes/tauri-playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEV_HOST = process.env.SPROUTGIT_E2E_DEV_HOST ?? 'localhost';
const DEV_PORT = Number.parseInt(process.env.SPROUTGIT_E2E_DEV_PORT ?? '1420', 10);
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`;
const MCP_SOCKET =
  process.env.SPROUTGIT_PLAYWRIGHT_SOCKET_PATH ??
  join(tmpdir(), 'sproutgit-playwright.sock');
const TAURI_COMMAND = process.env.SPROUTGIT_E2E_TAURI_COMMAND;
const TAURI_CWD = process.env.SPROUTGIT_E2E_TAURI_CWD;

export const { test, expect } = createTauriTest({
  mcpSocket: MCP_SOCKET,
  startTimeout: 120,
  ...(TAURI_COMMAND
    ? {
        tauriCommand: TAURI_COMMAND,
        tauriCwd: TAURI_CWD,
      }
    : {}),
});
