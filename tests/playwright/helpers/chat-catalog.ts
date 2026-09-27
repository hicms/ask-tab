import { expect } from '../fixtures/extension';
import type { BrowserContext, Page } from '@playwright/test';

type SyncReply = 'synced' | 'offline';
type SyncWindow = Window & { syncCalls: number; releaseSync?: () => Promise<void> };
type StoredModel = { id: string; modelId: string; name: string; provider: string } & Record<
  string,
  unknown
>;

/** Writes a cached server catalog and selects its first model. */
const seedCatalog = async (context: BrowserContext, models: StoredModel[], locale = 'zh_CN') => {
  const worker = context.serviceWorkers()[0]!;
  // The worker clears signed-out catalogs on startup; seeding earlier would be wiped.
  await expect
    .poll(() =>
      worker.evaluate(
        async () => 'server-models' in (await chrome.storage.local.get('server-models')),
      ),
    )
    .toBe(true);
  await worker.evaluate(
    ({ models, locale }) =>
      chrome.storage.local.set({
        settings: { theme: 'light', locale },
        'server-models': models,
        'selected-model-id': models[0]?.id ?? '',
      }),
    { models, locale },
  );
};

type OpenChatOptions = {
  cached: StoredModel[];
  /** Catalog written when the sync is released with `synced`. */
  synced?: StoredModel[];
  reply?: SyncReply;
  locale?: string;
};

/**
 * Answering the sync request in the page keeps the test independent of a running
 * AskTab server. The reply waits for `releaseSync`, so the cached catalog is seen first;
 * a reply that is never released leaves the cached catalog in place.
 */
const openChat = async (
  context: BrowserContext,
  extensionId: string,
  pagePath: 'side-panel' | 'full-page-chat',
  { cached, synced = cached, reply = 'offline', locale }: OpenChatOptions,
) => {
  await seedCatalog(context, cached, locale);
  const page = await context.newPage();
  await page.addInitScript(
    ({ reply, synced }) => {
      const target = window as unknown as SyncWindow;
      target.syncCalls = 0;
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      const replacement = (message: { type?: string }, ...rest: unknown[]) => {
        if (message?.type !== 'ASK_SYNC_MODELS') {
          return (original as (...args: unknown[]) => Promise<unknown>)(message, ...rest);
        }
        target.syncCalls++;
        return new Promise(resolve => {
          target.releaseSync = async () => {
            if (reply === 'offline') {
              resolve({ error: 'Cannot reach the AskTab server', status: 0 });
              return;
            }
            await chrome.storage.local.set({ 'server-models': synced });
            resolve({ models: synced.length });
          };
        });
      };
      Object.defineProperty(chrome.runtime, 'sendMessage', { value: replacement });
    },
    { reply, synced },
  );
  await page.goto(`chrome-extension://${extensionId}/${pagePath}/index.html`);
  return page;
};

const syncCalls = (page: Page) => page.evaluate(() => (window as unknown as SyncWindow).syncCalls);

const releaseSync = (page: Page) =>
  page.evaluate(() => (window as unknown as SyncWindow).releaseSync?.());

export type { StoredModel };
export { openChat, releaseSync, seedCatalog, syncCalls };
