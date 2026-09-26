import { test, expect } from '../fixtures/extension';
import { openOptionsAfterSetup } from '../helpers/setup';
import { SidePanelPage } from '../pages/side-panel';
import type { Page } from '@playwright/test';

const PREDEFINED_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'USER.md',
  'IDENTITY.md',
  'TOOLS.md',
  'MEMORY.md',
  'HEARTBEAT.md',
];

/** Options > Agents for the default agent. Setup runs first so workspace files are seeded. */
const openAgents = async (page: Page, extensionId: string) => {
  await openOptionsAfterSetup(page, extensionId);
  await page.locator('nav button', { hasText: 'Agents' }).click();
};

const openFilesTab = async (page: Page, extensionId: string) => {
  await openAgents(page, extensionId);
  await page.locator('div.border-b.px-6 > button', { hasText: 'Files' }).click();
  await expect(page.locator('button[title="AGENTS.md"]')).toBeVisible({ timeout: 10000 });
};

/** The tree row (role=button) that wraps a file's name button. */
const fileRow = (page: Page, name: string) =>
  page.locator('[role="button"]', { has: page.locator(`button[title="${name}"]`) });

test.describe('Workspace — Agents Page', () => {
  test('sidebar has no Workspace tab', async ({ extensionId, context }) => {
    const page = await context.newPage();
    const sidePanel = new SidePanelPage(page, extensionId);
    await sidePanel.navigate();
    await sidePanel.waitForLoad();

    await sidePanel.openSidebar();

    await expect(page.getByText('Sessions', { exact: true })).toBeVisible();
    await expect(page.locator('button', { hasText: 'Workspace' })).not.toBeVisible();

    await page.close();
  });

  test('Options Agents tab shows predefined files', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await openFilesTab(page, extensionId);

    for (const fileName of PREDEFINED_FILES) {
      await expect(page.locator(`button[title="${fileName}"]`)).toBeVisible();
    }

    await page.close();
  });

  test('user can edit a workspace file', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await openFilesTab(page, extensionId);

    await page.locator('button[title="MEMORY.md"]').dblclick();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'MEMORY.md' })).toBeVisible();

    const saveButton = dialog.locator('button', { hasText: 'Save' });
    await expect(saveButton).toBeDisabled();

    await dialog.locator('.cm-content').click();
    await page.keyboard.type('Test memory content');

    await expect(saveButton).toBeEnabled();

    await page.close();
  });

  test('user can toggle a workspace file enabled/disabled', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await openFilesTab(page, extensionId);

    const row = fileRow(page, 'MEMORY.md');
    await expect(row.getByText('OFF', { exact: true })).toHaveCount(0);

    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Disable' }).click();
    await expect(row.getByText('OFF', { exact: true })).toBeVisible();

    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Enable' }).click();
    await expect(row.getByText('OFF', { exact: true })).toHaveCount(0);

    await page.close();
  });

  test('user can create a custom workspace file', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await openFilesTab(page, extensionId);

    await page.locator('button:has(svg.lucide-file-plus)').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'untitled.md' })).toBeVisible();
    await expect(dialog.locator('.cm-content')).toBeVisible();

    await page.close();
  });

  test('predefined files cannot be deleted', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await openFilesTab(page, extensionId);

    await page.locator('button[title="AGENTS.md"]').click();
    await expect(page.locator('button:has(svg.lucide-trash)')).toBeDisabled();

    await fileRow(page, 'AGENTS.md').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Disable' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);

    await page.close();
  });

  test('Overview tab shows identity information', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId);

    // Overview is the default sub-tab
    await expect(page.getByText('Identity', { exact: true })).toBeVisible();

    for (const label of ['Name', 'Emoji', 'Creature', 'Vibe']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }

    await page.close();
  });

  test('Agent list panel shows main agent', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId);

    await expect(page.getByText('main').first()).toBeVisible();
    await expect(page.getByText('DEFAULT').first()).toBeVisible();

    await page.close();
  });
});
