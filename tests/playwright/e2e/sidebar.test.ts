import { test, expect } from '../fixtures/extension';
import { setupFullPageChat, setupSidePanel } from '../helpers/setup';

test.describe('Sidebar resize (full-page)', () => {
  test('sidebar is visible by default in full-page mode', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await setupFullPageChat(page, extensionId);

    // Sidebar should be visible in push mode
    const sidebar = page.locator('[data-testid="sidebar-push"]');
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    await page.close();
  });

  test('sidebar has resize handle', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await setupFullPageChat(page, extensionId);

    const handle = page.locator('[data-testid="sidebar-resize-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });

    await page.close();
  });

  test('sidebar pushes content aside, not overlays', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await setupFullPageChat(page, extensionId);

    const sidebar = page.locator('[data-testid="sidebar-push"]');
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    // Sidebar should NOT have fixed positioning (push mode uses relative)
    const position = await sidebar.evaluate(el => getComputedStyle(el).position);
    expect(position).not.toBe('fixed');

    // No overlay backdrop should exist
    const backdrop = page.locator('[role="presentation"]');
    await expect(backdrop).toHaveCount(0);

    await page.close();
  });

  test('toggle button collapses and expands sidebar', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await setupFullPageChat(page, extensionId);

    const sidebar = page.locator('[data-testid="sidebar-push"]');
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    // Use the hamburger menu button in the chat header to toggle
    const hamburger = page.locator('button[title="Toggle sidebar"]');
    await expect(hamburger).toBeVisible();
    await hamburger.click();
    await page.waitForTimeout(500);

    // Sidebar should be hidden
    await expect(sidebar).not.toBeVisible();

    // Click again to re-open
    await hamburger.click();
    await page.waitForTimeout(500);

    await expect(sidebar).toBeVisible();

    await page.close();
  });
});

test.describe('Sidebar overlay (side-panel)', () => {
  test('sidebar overlays content in side-panel mode', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await setupSidePanel(page, extensionId);

    // In side-panel, sidebar starts closed — no push sidebar
    const pushSidebar = page.locator('[data-testid="sidebar-push"]');
    await expect(pushSidebar).toHaveCount(0);

    // Open the sidebar via hamburger
    const hamburger = page.locator('button[title="Toggle sidebar"]');
    await expect(hamburger).toBeVisible();
    await hamburger.click();
    await page.waitForTimeout(500);

    // Sidebar should use fixed positioning (overlay mode)
    const sidebar = page.locator('.fixed.inset-y-0.left-0.z-50');
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    // Backdrop should exist
    const backdrop = page.locator('[role="presentation"]');
    await expect(backdrop).toBeVisible();

    await page.close();
  });

  test('clicking backdrop closes sidebar', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await setupSidePanel(page, extensionId);

    // Open sidebar
    const hamburger = page.locator('button[title="Toggle sidebar"]');
    await expect(hamburger).toBeVisible();
    await hamburger.click();
    await page.waitForTimeout(500);

    const sidebar = page.locator('.fixed.inset-y-0.left-0.z-50');
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    // Click the backdrop to close
    const backdrop = page.locator('[role="presentation"]');
    await backdrop.click({ force: true });
    await page.waitForTimeout(500);

    // Sidebar should be hidden (translated off-screen)
    await expect(sidebar).toHaveClass(/-translate-x-full/);

    await page.close();
  });
});
