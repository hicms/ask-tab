import { test, expect } from '../fixtures/extension';
import type { BrowserContext, Page } from '@playwright/test';

type SyncReply = 'synced' | 'offline';
type SyncWindow = Window & { syncCalls: number; releaseSync?: () => Promise<void> };

const cachedModel = {
  id: 'ask:ucloud-kimi-k3',
  modelId: 'ucloud-kimi-k3',
  name: 'UCloud · kimi-k3',
  provider: 'custom',
};
const syncedModel = { ...cachedModel, name: 'Kimi K3' };

/**
 * Answering the sync request in the page keeps the test independent of a running
 * AskTab server. The reply waits for `releaseSync`, so the cached catalog is seen first.
 */
const openChat = async (
  context: BrowserContext,
  extensionId: string,
  pagePath: 'side-panel' | 'full-page-chat',
  reply: SyncReply,
  cached = [cachedModel],
) => {
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
    models =>
      chrome.storage.local.set({
        settings: { theme: 'light', locale: 'zh_CN' },
        'server-models': models,
        'selected-model-id': models[0]?.id ?? '',
      }),
    cached,
  );

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
            await chrome.storage.local.set({ 'server-models': [synced] });
            resolve({ models: 1 });
          };
        });
      };
      Object.defineProperty(chrome.runtime, 'sendMessage', { value: replacement });
    },
    { reply, synced: syncedModel },
  );
  await page.goto(`chrome-extension://${extensionId}/${pagePath}/index.html`);
  return page;
};

const modelPicker = (page: Page) => page.getByRole('combobox').filter({ hasText: /kimi/i });

const syncCalls = (page: Page) => page.evaluate(() => (window as unknown as SyncWindow).syncCalls);

const releaseSync = (page: Page) =>
  page.evaluate(() => (window as unknown as SyncWindow).releaseSync?.());

for (const pagePath of ['side-panel', 'full-page-chat'] as const) {
  test(`${pagePath} shows renamed models without signing in again`, async ({
    context,
    extensionId,
  }) => {
    const page = await openChat(context, extensionId, pagePath, 'synced');
    await expect(modelPicker(page)).toContainText('UCloud · kimi-k3');
    await expect.poll(() => syncCalls(page)).toBe(1);

    await releaseSync(page);
    await expect(modelPicker(page)).toContainText('Kimi K3');
    await expect(modelPicker(page)).not.toContainText('UCloud');
    expect(await syncCalls(page)).toBe(1);
  });
}

test('an unreachable server keeps the cached models', async ({ context, extensionId }) => {
  const page = await openChat(context, extensionId, 'side-panel', 'offline');
  await expect.poll(() => syncCalls(page)).toBe(1);

  await releaseSync(page);
  await expect(modelPicker(page)).toContainText('UCloud · kimi-k3');
  await expect(page.getByTestId('setup-email')).toHaveCount(0);
});

test('first-run setup stays open when a sync writes models', async ({ context, extensionId }) => {
  const page = await openChat(context, extensionId, 'side-panel', 'synced', []);
  await expect(page.getByTestId('setup-email')).toBeVisible({ timeout: 10000 });
  await expect.poll(() => syncCalls(page)).toBe(1);

  await releaseSync(page);
  await page.waitForTimeout(500);
  await expect(page.getByTestId('setup-email')).toBeVisible();
});
