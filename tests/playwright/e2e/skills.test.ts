import { test, expect } from '../fixtures/extension';
import { openOptionsAfterSetup } from '../helpers/setup';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';

const BUNDLED_SKILLS = ['Daily Journal', 'Skill Creator', 'Tool Creator'];

/** Options > Skills lists global (imported) skills; bundled skills live on each agent. */
const openGlobalSkillsTab = async (page: Page, extensionId: string) => {
  await page.goto(`chrome-extension://${extensionId}/options/index.html`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('h1')).toContainText('AskTab Settings', { timeout: 10000 });
  await page.locator('nav button', { hasText: 'Skills' }).click();
  await expect(page.getByText('Installed Skills')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('text=Loading skills')).not.toBeVisible({ timeout: 15000 });
};

/** Options > Agents > (main agent) > Skills sub-tab, after first-run setup seeds the agent. */
const openAgentSkillsTab = async (page: Page, extensionId: string) => {
  await openOptionsAfterSetup(page, extensionId);
  await page.locator('nav button', { hasText: 'Agents' }).click();
  await page.locator('div.border-b.px-6 > button', { hasText: 'Skills' }).click();
  await expect(page.getByText(BUNDLED_SKILLS[0], { exact: true })).toBeVisible({
    timeout: 10000,
  });
};

const skillZip = async () => {
  const zip = new JSZip();
  zip.file(
    'e2e-skill/SKILL.md',
    '---\nname: E2E Skill\ndescription: Imported by the E2E suite\n---\n\n# E2E Skill\n',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
};

test.describe('Skill System — Agent Skills', () => {
  test('agent Skills tab shows bundled skills with descriptions', async ({
    extensionId,
    context,
  }) => {
    const page = await context.newPage();
    await openAgentSkillsTab(page, extensionId);

    for (const skillName of BUNDLED_SKILLS) {
      await expect(page.getByText(skillName, { exact: true })).toBeVisible();
    }

    // Card header + one ZapIcon per skill row
    expect(await page.locator('svg.lucide-zap').count()).toBeGreaterThanOrEqual(
      BUNDLED_SKILLS.length + 1,
    );

    await page.close();
  });

  test('user can toggle a skill enabled/disabled', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await openAgentSkillsTab(page, extensionId);

    const toggleBtn = page.locator('.divide-y > div button', { hasText: /^(ON|OFF)$/ }).first();
    await expect(toggleBtn).toBeVisible();
    const initialText = (await toggleBtn.textContent())?.trim();
    const expectedText = initialText === 'ON' ? 'OFF' : 'ON';

    await toggleBtn.click();
    await expect(toggleBtn).toHaveText(expectedText, { timeout: 5000 });

    await toggleBtn.click();
    await expect(toggleBtn).toHaveText(initialText!, { timeout: 5000 });

    await page.close();
  });

  test('bundled skills have no delete button', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await openAgentSkillsTab(page, extensionId);

    // Each bundled row has only the ON/OFF toggle
    const skillRows = page.locator('.divide-y > div');
    const rowCount = await skillRows.count();
    expect(rowCount).toBeGreaterThanOrEqual(BUNDLED_SKILLS.length);
    for (let i = 0; i < rowCount; i++) {
      await expect(skillRows.nth(i).locator('button')).toHaveCount(1);
    }

    await page.close();
  });
});

test.describe('Skill System — Global Skills', () => {
  test('import zip button exists with file input', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await openGlobalSkillsTab(page, extensionId);

    await expect(page.locator('button', { hasText: 'Import Zip' })).toBeVisible();
    await expect(page.locator('input[type="file"][accept=".zip"]')).toHaveCount(1);

    await page.close();
  });

  test('importing invalid zip shows error toast', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await openGlobalSkillsTab(page, extensionId);

    await page.locator('input[type="file"][accept=".zip"]').setInputFiles({
      name: 'invalid.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('not a valid zip file'),
    });

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible({
      timeout: 5000,
    });

    await page.close();
  });

  test('user can import a skill zip and delete it', async ({ extensionId, context }) => {
    const page = await context.newPage();
    await openGlobalSkillsTab(page, extensionId);

    await page.locator('input[type="file"][accept=".zip"]').setInputFiles({
      name: 'e2e-skill.zip',
      mimeType: 'application/zip',
      buffer: await skillZip(),
    });

    await expect(page.locator('[data-sonner-toast][data-type="success"]')).toBeVisible({
      timeout: 5000,
    });
    const row = page.locator('.divide-y > div').filter({ hasText: 'E2E Skill' });
    await expect(row).toBeVisible();

    // Imported skills have a delete button next to the toggle
    await expect(row.locator('button')).toHaveCount(2);
    await row.locator('button').last().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();

    await expect(row).toHaveCount(0);
    await expect(page.getByText('No skills installed')).toBeVisible();

    await page.close();
  });
});
