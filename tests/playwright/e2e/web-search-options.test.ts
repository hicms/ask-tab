import { test } from '../fixtures/extension';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Navigate to options and wait for the page to be ready. */
const openOptions = async (page: Page, extensionId: string) => {
  await page.goto(`chrome-extension://${extensionId}/options/index.html`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('h1')).toContainText('AskTab Settings', { timeout: 10000 });
};

/** Click a tab in the options page nav. */
const clickTab = async (page: Page, tabName: string) => {
  await page.locator('nav button', { hasText: tabName }).click();
};

/** Open the Tools tab and make sure web search is enabled. */
const openWebSearchConfig = async (page: Page, extensionId: string) => {
  await openOptions(page, extensionId);
  await clickTab(page, 'Tools');

  const wsCheckbox = page.locator('#tool-web_search');
  await expect(wsCheckbox).toBeVisible();
  if (!(await wsCheckbox.isChecked())) {
    await wsCheckbox.check();
  }
};

const selectSearchProvider = async (page: Page, label: string) => {
  await page.locator('#search-provider').click();
  await page.locator('[role="option"]', { hasText: label }).first().click();
};

test.describe('Web Search Provider Config @phase-10', () => {
  test('provider dropdown appears when web search is enabled', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openWebSearchConfig(page, extensionId);

    await expect(page.locator('#search-provider')).toBeVisible();

    await page.close();
  });

  test('the AskTab server provider needs no API key input', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openWebSearchConfig(page, extensionId);

    await selectSearchProvider(page, 'AskTab server');

    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator('#search-engine')).not.toBeVisible();

    await page.close();
  });

  test('selecting Browser shows engine dropdown and no-API-key text', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openWebSearchConfig(page, extensionId);

    await selectSearchProvider(page, 'Browser');

    await expect(page.locator('#search-engine')).toBeVisible();
    await expect(page.locator('text=No API key needed')).toBeVisible();

    await page.close();
  });

  test('browser engine selection shows Google/Bing/DuckDuckGo options', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openWebSearchConfig(page, extensionId);

    await selectSearchProvider(page, 'Browser');
    await page.locator('#search-engine').click();

    await expect(page.locator('[role="option"]', { hasText: 'Google' })).toBeVisible();
    await expect(page.locator('[role="option"]', { hasText: 'Bing' })).toBeVisible();
    await expect(page.locator('[role="option"]', { hasText: 'DuckDuckGo' })).toBeVisible();

    await page.close();
  });
});
