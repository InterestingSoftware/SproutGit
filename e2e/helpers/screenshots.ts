import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import type { TestInfo } from '@playwright/test';
import type { BrowserPageAdapter, TauriPage } from '@srsholmes/tauri-playwright';

import { ROOT } from './fixtures';

function resolveTargetDir() {
  const target = process.env.PLAYWRIGHT_SCREENSHOT_TARGET;
  if (!target) {
    return join(ROOT, 'test-results', 'screenshots');
  }
  return isAbsolute(target) ? target : resolve(ROOT, target);
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function captureNamedScreenshot(tauriPage: TauriPage | BrowserPageAdapter, testInfo: TestInfo, name: string) {
  const dir = resolveTargetDir();
  const filename = `${slug(name)}.png`;
  const outputPath = join(dir, filename);
  mkdirSync(dirname(outputPath), { recursive: true });
  const png = await tauriPage.screenshot({ path: outputPath });
  await testInfo.attach(name, {
    body: png,
    contentType: 'image/png',
  });
  return outputPath;
}