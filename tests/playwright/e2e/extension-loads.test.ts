import { test, expect } from '../fixtures/extension';

test.describe('@phase-3 Extension loads', () => {
  test('MVP-3: extension loads in Chrome without errors', async ({ context, extensionId }) => {
    expect(extensionId).toBeTruthy();
    expect(extensionId.length).toBeGreaterThan(0);

    // Verify service worker is running
    const workers = context.serviceWorkers();
    expect(workers.length).toBeGreaterThan(0);
  });

  test('MVP-4: side panel page is accessible', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/side-panel/index.html`);

    // Side panel should load without error
    await expect(page).toHaveTitle('AskTab');

    // Should show either the auth form or the chat UI (depending on mode)
    const body = page.locator('body');
    await expect(body).toBeVisible();

    await page.close();
  });
});
