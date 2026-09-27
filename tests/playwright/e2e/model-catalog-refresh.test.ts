import { test, expect } from '../fixtures/extension';
import { openChat, releaseSync, syncCalls } from '../helpers/chat-catalog';
import type { Page } from '@playwright/test';

const cachedModel = {
  id: 'ask:ucloud-kimi-k3',
  modelId: 'ucloud-kimi-k3',
  name: 'UCloud · kimi-k3',
  provider: 'custom',
};
const syncedModel = { ...cachedModel, name: 'Kimi K3' };

const modelPicker = (page: Page) => page.getByRole('combobox').filter({ hasText: /kimi/i });

for (const pagePath of ['side-panel', 'full-page-chat'] as const) {
  test(`${pagePath} shows renamed models without signing in again`, async ({
    context,
    extensionId,
  }) => {
    const page = await openChat(context, extensionId, pagePath, {
      cached: [cachedModel],
      synced: [syncedModel],
      reply: 'synced',
    });
    await expect(modelPicker(page)).toContainText('UCloud · kimi-k3');
    await expect.poll(() => syncCalls(page)).toBe(1);

    await releaseSync(page);
    await expect(modelPicker(page)).toContainText('Kimi K3');
    await expect(modelPicker(page)).not.toContainText('UCloud');
    expect(await syncCalls(page)).toBe(1);
  });
}

test('an unreachable server keeps the cached models', async ({ context, extensionId }) => {
  const page = await openChat(context, extensionId, 'side-panel', { cached: [cachedModel] });
  await expect.poll(() => syncCalls(page)).toBe(1);

  await releaseSync(page);
  await expect(modelPicker(page)).toContainText('UCloud · kimi-k3');
  await expect(page.getByTestId('setup-email')).toHaveCount(0);
});

test('first-run setup stays open when a sync writes models', async ({ context, extensionId }) => {
  const page = await openChat(context, extensionId, 'side-panel', {
    cached: [],
    synced: [syncedModel],
    reply: 'synced',
  });
  await expect(page.getByTestId('setup-email')).toBeVisible({ timeout: 10000 });
  await expect.poll(() => syncCalls(page)).toBe(1);

  await releaseSync(page);
  await page.waitForTimeout(500);
  await expect(page.getByTestId('setup-email')).toBeVisible();
});
