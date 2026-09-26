import { test, expect } from '../fixtures/extension';

test('the built extension starts and renders its side panel', async ({ context, extensionId }) => {
  expect(context.serviceWorkers().some(worker => worker.url().includes(extensionId))).toBe(true);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/side-panel/index.html`);
  await expect(page).toHaveTitle('AskTab');
  await expect(
    page.locator('#setup-email, textarea, [data-testid="user-menu-button"]').first(),
  ).toBeVisible({ timeout: 10000 });
  await page.close();
});
