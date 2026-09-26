import { test, expect } from '../fixtures/extension';
import { waitForAppReady } from '../helpers/setup';

test.describe('Direct Mode @phase-9', () => {
  test('MVP-16: first-run setup asks for an account instead of an API key', async ({
    extensionId,
    context,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/side-panel/index.html`);
    await page.waitForLoadState('domcontentloaded');
    await waitForAppReady(page);

    // A fresh profile is signed out, so the account step must be showing.
    await expect(page.locator('#setup-email')).toBeVisible();
    await expect(page.locator('[data-testid="setup-api-key"]')).toHaveCount(0);

    await page.locator('[data-testid="setup-email"]').fill('not-an-email');
    await page.locator('[data-testid="setup-start-button"]').click();
    await expect(page.getByText('Enter a valid email address')).toBeVisible();

    await page.close();
  });
});
