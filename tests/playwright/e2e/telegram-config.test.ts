import { test, expect } from '../fixtures/extension';
import { mockChannelApi, openChannelsTab, setupSidePanel } from '../helpers/setup';
import type { BrowserContext, Page } from '@playwright/test';

/** Signs in against the mocked AskTab service, mocks channel endpoints, opens the Channels tab. */
const openSignedInChannelsTab = async (
  context: BrowserContext,
  page: Page,
  extensionId: string,
) => {
  await mockChannelApi(context);
  await setupSidePanel(page, extensionId);
  await openChannelsTab(page, extensionId);
};

test.describe('Telegram Channel Config @phase-10', () => {
  // ── Card rendering ──

  test('TG-1: Telegram Bot card is visible on Channels tab', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    await expect(page.getByText('Telegram Bot', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Connect a Telegram bot so you can chat with your AI assistant'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="tg-status-dot"]')).toBeVisible();

    await page.close();
  });

  test('TG-2: status dot shows not-connected (gray) by default', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    const statusDot = page.locator('[data-testid="tg-status-dot"]');
    await expect(statusDot).toBeVisible();
    await expect(statusDot).toHaveClass(/bg-gray-400/);

    await page.close();
  });

  test('TG-3: Telegram card not visible on other tabs', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/index.html`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('AskTab Settings', { timeout: 10000 });

    await expect(page.locator('[data-testid="tg-status-dot"]')).not.toBeVisible();

    await page.locator('nav button', { hasText: 'Model' }).click();
    await expect(page.locator('[data-testid="tg-status-dot"]')).not.toBeVisible();

    await page.locator('nav button', { hasText: 'Tool' }).click();
    await expect(page.locator('[data-testid="tg-status-dot"]')).not.toBeVisible();

    await page.close();
  });

  // ── Signed-out state ──

  test('TG-4: signed-out users see a sign-in notice and a disabled Connect button', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    await expect(page.locator('[data-testid="tg-sign-in-required"]')).toBeVisible();
    await expect(page.locator('[data-testid="tg-sign-in-required"]')).toContainText(
      'Sign in to your AskTab account',
    );

    await page.locator('[data-testid="tg-token-input"]').fill('123:fake-test-token');
    await expect(page.locator('[data-testid="tg-connect-btn"]')).toBeDisabled();

    await page.close();
  });

  // ── Connect ──

  test('TG-5: Connect button disabled when token is empty', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openSignedInChannelsTab(context, page, extensionId);

    await expect(page.locator('[data-testid="tg-connect-btn"]')).toBeDisabled();

    await page.close();
  });

  test('TG-6: connecting a bot shows the bot identity and status', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openSignedInChannelsTab(context, page, extensionId);

    await page.locator('[data-testid="tg-token-input"]').fill('123:fake-test-token');
    await page.locator('[data-testid="tg-connect-btn"]').click();

    await expect(page.locator('[data-testid="tg-bot-identity"]')).toContainText('@test_e2e_bot', {
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="tg-status-text"]')).toContainText('Connected');
    // Token input is cleared after a successful connect
    await expect(page.locator('[data-testid="tg-token-input"]')).toHaveValue('');

    await page.close();
  });

  test('TG-7: failed connect shows an action error', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const state = await mockChannelApi(context);
    state.failConnect = true;
    await setupSidePanel(page, extensionId);
    await openChannelsTab(page, extensionId);

    await page.locator('[data-testid="tg-token-input"]').fill('bad-token-value');
    await page.locator('[data-testid="tg-connect-btn"]').click();

    await expect(page.locator('[data-testid="tg-action-error"]')).toBeVisible({ timeout: 10000 });

    await page.close();
  });

  // ── Enable / remove ──

  test('TG-8: enable toggle flips the channel state', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openSignedInChannelsTab(context, page, extensionId);

    await page.locator('[data-testid="tg-token-input"]').fill('123:fake-test-token');
    await page.locator('[data-testid="tg-connect-btn"]').click();
    await expect(page.locator('[data-testid="tg-bot-identity"]')).toBeVisible({ timeout: 10000 });

    const toggle = page.locator('[data-testid="tg-enable-toggle"]');
    await expect(toggle).toContainText('Enabled');
    await toggle.click();
    await expect(toggle).toContainText('Disabled', { timeout: 10000 });

    await page.close();
  });

  test('TG-9: Remove deletes the server channel', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openSignedInChannelsTab(context, page, extensionId);

    await page.locator('[data-testid="tg-token-input"]').fill('123:fake-test-token');
    await page.locator('[data-testid="tg-connect-btn"]').click();
    await expect(page.locator('[data-testid="tg-bot-identity"]')).toBeVisible({ timeout: 10000 });

    await page.locator('[data-testid="tg-remove-btn"]').click();
    await expect(page.locator('[data-testid="tg-bot-identity"]')).not.toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="tg-status-dot"]')).toHaveClass(/bg-gray-400/);

    await page.close();
  });

  // ── Allowed user IDs ──

  test('TG-10: no-users warning shown when list is empty', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    await expect(page.locator('[data-testid="tg-no-users-warning"]')).toBeVisible();
    await expect(page.locator('[data-testid="tg-no-users-warning"]')).toContainText(
      'No users allowed yet',
    );

    await page.close();
  });

  test('TG-11: add a numeric user ID — badge appears', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    await page.locator('[data-testid="tg-user-id-input"]').fill('123456789');
    await page.locator('[data-testid="tg-add-user-btn"]').click();

    await expect(page.locator('[data-testid="tg-user-badges"]')).toBeVisible();
    await expect(page.locator('[data-testid="tg-user-badges"]')).toContainText('123456789');
    await expect(page.locator('[data-testid="tg-no-users-warning"]')).not.toBeVisible();

    await page.close();
  });

  test('TG-12: non-numeric user ID — Add button stays disabled', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    const addBtn = page.locator('[data-testid="tg-add-user-btn"]');

    await page.locator('[data-testid="tg-user-id-input"]').fill('abc');
    await expect(addBtn).toBeDisabled();

    await page.locator('[data-testid="tg-user-id-input"]').fill('12.34');
    await expect(addBtn).toBeDisabled();

    await page.locator('[data-testid="tg-user-id-input"]').fill('999');
    await expect(addBtn).toBeEnabled();

    await page.close();
  });

  test('TG-13: duplicate user ID is prevented', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    const userInput = page.locator('[data-testid="tg-user-id-input"]');
    const addBtn = page.locator('[data-testid="tg-add-user-btn"]');

    await userInput.fill('111');
    await addBtn.click();
    await expect(page.locator('[data-testid="tg-user-badges"]')).toContainText('111');

    await userInput.fill('111');
    await addBtn.click();

    await expect(page.locator('[data-testid="tg-user-badges"] button')).toHaveCount(1);

    await page.close();
  });

  test('TG-14: remove user ID via X button', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    await page.locator('[data-testid="tg-user-id-input"]').fill('222');
    await page.locator('[data-testid="tg-add-user-btn"]').click();
    await expect(page.locator('[data-testid="tg-user-badges"]')).toContainText('222');

    await page.locator('[data-testid="tg-user-badges"] button').click();

    await expect(page.locator('[data-testid="tg-no-users-warning"]')).toBeVisible();

    await page.close();
  });

  // ── Save & persistence ──

  test('TG-15: auto-save shows confirmation after adding user', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    await page.locator('[data-testid="tg-user-id-input"]').fill('555555');
    await page.locator('[data-testid="tg-add-user-btn"]').click();

    await expect(page.locator('[data-testid="tg-saved-indicator"]')).toBeVisible({
      timeout: 5000,
    });

    await page.close();
  });

  test('TG-16: configuration persists across page reload', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    await page.locator('[data-testid="tg-user-id-input"]').fill('987654321');
    await page.locator('[data-testid="tg-add-user-btn"]').click();
    await expect(page.locator('[data-testid="tg-user-badges"]')).toContainText('987654321');
    await expect(page.locator('[data-testid="tg-saved-indicator"]')).toBeVisible({
      timeout: 5000,
    });

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('AskTab Settings', { timeout: 10000 });
    await page.locator('nav button', { hasText: 'Channels' }).click();
    await expect(page.getByText('Telegram Bot', { exact: true })).toBeVisible({ timeout: 10000 });

    await expect(page.locator('[data-testid="tg-user-badges"]')).toContainText('987654321');

    await page.close();
  });
});
