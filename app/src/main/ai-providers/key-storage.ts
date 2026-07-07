/**
 * API-key storage for the AI provider registry, via Electron `safeStorage`.
 *
 * Same pattern as `getStoredGithubToken`/`saveToken` in `ipc/github.ts`: one
 * encrypted blob under `userData`, never in the workspace DB or any file
 * that could end up committed to a repo. Key material never crosses the IPC
 * boundary to the renderer — callers here only ever return booleans.
 */
import { safeStorage } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

type KeyMap = Record<string, string>;

function keyFilePath(userDataPath: string): string {
  return join(userDataPath, 'ai-provider-keys.bin');
}

function readKeyMap(userDataPath: string): KeyMap {
  const path = keyFilePath(userDataPath);
  if (!existsSync(path)) return {};
  try {
    const buf = readFileSync(path);
    // The blob may have been written as plaintext (encryption unavailable
    // at the time) even though encryption is available now, e.g. after
    // switching machines/OS keychains — try decrypting first, but fall back
    // to reading it as plaintext JSON rather than treating a decrypt
    // failure as "no keys stored" and silently losing them.
    let raw: string;
    if (safeStorage.isEncryptionAvailable()) {
      try {
        raw = safeStorage.decryptString(buf);
      } catch {
        raw = buf.toString('utf8');
      }
    } else {
      raw = buf.toString('utf8');
    }
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as KeyMap) : {};
  } catch {
    return {};
  }
}

function writeKeyMap(userDataPath: string, keyMap: KeyMap): void {
  const payload = JSON.stringify(keyMap);
  const encrypted = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(payload)
    : Buffer.from(payload, 'utf8');
  writeFileSync(keyFilePath(userDataPath), encrypted);
}

export function setProviderApiKey(userDataPath: string, providerId: string, apiKey: string): void {
  const keyMap = readKeyMap(userDataPath);
  keyMap[providerId] = apiKey;
  writeKeyMap(userDataPath, keyMap);
}

export function getProviderApiKey(userDataPath: string, providerId: string): string | null {
  return readKeyMap(userDataPath)[providerId] ?? null;
}

export function hasProviderApiKey(userDataPath: string, providerId: string): boolean {
  return Object.prototype.hasOwnProperty.call(readKeyMap(userDataPath), providerId);
}

export function clearProviderApiKey(userDataPath: string, providerId: string): void {
  const keyMap = readKeyMap(userDataPath);
  if (!(providerId in keyMap)) return;
  delete keyMap[providerId];
  writeKeyMap(userDataPath, keyMap);
}
