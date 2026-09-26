import { test, expect } from '../fixtures/extension';
import { SidePanelPage } from '../pages/side-panel';

test.describe('Session Management', () => {
  test('New Session button creates a fresh session', async ({ extensionId, context }) => {
    const page = await context.newPage();
    const sidePanel = new SidePanelPage(page, extensionId);
    await sidePanel.navigate();
    await sidePanel.waitForLoad();

    // Click "New Session" button in header
    const newSessionBtn = sidePanel.getNewSessionButton();
    await expect(newSessionBtn).toBeVisible({ timeout: 10000 });
    await newSessionBtn.click();

    // Verify the page is in a fresh state (chat input is available)
    const input = page.locator('textarea').last();
    await expect(input).toBeVisible();

    await page.close();
  });

  test('session labels show "New Session" and "Sessions" tab', async ({ extensionId, context }) => {
    const page = await context.newPage();
    const sidePanel = new SidePanelPage(page, extensionId);
    await sidePanel.navigate();
    await sidePanel.waitForLoad();

    // Verify "New Session" button text in header
    const newSessionBtn = sidePanel.getNewSessionButton();
    await expect(newSessionBtn).toBeVisible();

    // Open sidebar and verify the "Sessions" header is present
    await sidePanel.openSidebar();
    const sessionsHeader = page.getByText('Sessions', { exact: true });
    await expect(sessionsHeader).toBeVisible();

    await page.close();
  });
});

test.describe('Token Usage', () => {
  test('Options page shows Usage tab', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/index.html`);
    await page.waitForLoadState('domcontentloaded');

    // Usage tab should be in the nav
    const usageTab = page.locator('nav button', { hasText: 'Usage' });
    await expect(usageTab).toBeVisible();

    await page.close();
  });
});
