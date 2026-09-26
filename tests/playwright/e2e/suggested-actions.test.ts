import { test, expect } from '../fixtures/extension';
import type { Page } from '@playwright/test';

const openActions = async (page: Page, extensionId: string) => {
  await page.goto(`chrome-extension://${extensionId}/options/index.html`);
  await page.locator('nav').getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(page.getByPlaceholder('Button label (shown on chat screen)')).toHaveCount(4);
};

test.beforeEach(async ({ context, extensionId }) => {
  const background = context.serviceWorkers().find(worker => worker.url().includes(extensionId))!;
  // A fresh worker clears legacy models asynchronously. Seed only after that cleanup finishes.
  await expect
    .poll(() =>
      background.evaluate(
        async () => (await chrome.storage.local.get('server-models'))['server-models'],
      ),
    )
    .toEqual([]);
  // Keep a valid session with the model so startup cleanup does not remove it as signed-out data.
  await background.evaluate(async () => {
    // Extension service-worker requests bypass page routes. Keep account refresh offline
    // so the seeded cache is used without contacting a real server with test credentials.
    globalThis.fetch = async () => new Response('', { status: 503 });
    await chrome.storage.local.set({
      settings: { locale: 'en', theme: 'light' },
      'ask-session': {
        token: 'e2e-token',
        userId: 'e2e',
        email: 'e2e@example.com',
        expiresAt: Date.now() + 60 * 60_000,
      },
      'server-models': [
        { id: 'test-model', modelId: 'test-model', name: 'Test Model', provider: 'openai' },
      ],
    });
  });
});

for (const surface of ['side-panel', 'full-page-chat']) {
  test(`saved actions update an open ${surface} and survive reopening`, async ({
    context,
    extensionId,
  }) => {
    const chat = await context.newPage();
    await chat.goto(`chrome-extension://${extensionId}/${surface}/index.html`);
    const buttons = chat.getByTestId('suggested-actions').getByRole('button');
    await expect(buttons).toHaveCount(4, { timeout: 15000 });

    const options = await context.newPage();
    await openActions(options, extensionId);
    const labels = options.getByPlaceholder('Button label (shown on chat screen)');
    const prompts = options.getByPlaceholder('Full prompt sent to the AI when clicked');
    const label = '成都今天天气怎么样？';
    const prompt = '请介绍成都今天的天气，并给出出行建议。';
    await labels.nth(2).fill(label);
    await prompts.nth(2).fill(prompt);
    await expect(options.getByText('Saved', { exact: true })).toBeVisible();
    await expect(buttons.nth(2)).toHaveText(label);

    // Changing only the prompt must also persist, even though the label and IDs stay the same.
    const updatedPrompt = '请告诉我成都未来三天的天气。';
    await prompts.nth(2).fill(updatedPrompt);
    await expect
      .poll(() =>
        options.evaluate(async () => {
          const stored = await chrome.storage.local.get('suggested-actions');
          return stored['suggested-actions'][2].prompt;
        }),
      )
      .toBe(updatedPrompt);

    await openActions(options, extensionId);
    await expect(labels.nth(2)).toHaveValue(label);
    await expect(prompts.nth(2)).toHaveValue(updatedPrompt);
    await chat.reload();
    await expect(buttons.nth(2)).toHaveText(label);

    await options.evaluate(async () => {
      await chrome.storage.local.set({ settings: { locale: 'zh_CN', theme: 'light' } });
    });
    await expect(chat.getByText('你好！', { exact: true })).toBeVisible();
    await expect(buttons.nth(2)).toHaveText(label);
  });
}

test('reordering, adding, removing and resetting actions update the open chat', async ({
  context,
  extensionId,
}) => {
  const chat = await context.newPage();
  await chat.goto(`chrome-extension://${extensionId}/side-panel/index.html`);
  const buttons = chat.getByTestId('suggested-actions').getByRole('button');
  await expect(buttons).toHaveCount(4, { timeout: 15000 });
  const defaults = await buttons.allTextContents();

  const options = await context.newPage();
  await openActions(options, extensionId);
  await options.getByTitle('Move down', { exact: true }).first().click();
  await expect(buttons).toHaveText([defaults[1], defaults[0], defaults[2], defaults[3]]);

  await options.getByRole('button', { name: 'Add Action', exact: true }).click();
  await options.getByPlaceholder('Button label (shown on chat screen)').last().fill('Translate');
  await options
    .getByPlaceholder('Full prompt sent to the AI when clicked')
    .last()
    .fill('Translate this page into Chinese');
  await expect(buttons).toHaveCount(5);
  await expect(buttons.last()).toHaveText('Translate');

  for (let count = 5; count > 0; count--) {
    await options.getByTitle('Remove', { exact: true }).last().click();
    await expect(buttons).toHaveCount(count - 1);
  }
  await expect(chat.getByTestId('suggested-actions')).toHaveCount(0);

  await options.getByRole('button', { name: 'Reset to Defaults', exact: true }).click();
  await expect(buttons).toHaveText(defaults);

  await options.evaluate(async () => {
    await chrome.storage.local.set({ settings: { locale: 'zh_CN', theme: 'light' } });
  });
  await expect(buttons.nth(2)).toHaveText('北京今天天气怎么样？');
});
