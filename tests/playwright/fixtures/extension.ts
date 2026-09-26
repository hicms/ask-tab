/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import type { BrowserContext } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pathToExtension = path.resolve(__dirname, '../../../dist');

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [background] = context.serviceWorkers();
    if (!background) background = await context.waitForEvent('serviceworker');
    const extensionId = background.url().split('/')[2]!;
    await use(extensionId);
  },
});

export { expect } from '@playwright/test';
