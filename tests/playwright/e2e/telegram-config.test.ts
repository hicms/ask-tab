import { test, expect } from '../fixtures/extension';
import { openChannelsTab, mockTelegramApi } from '../helpers/setup';

test.describe('Telegram Channel Config @phase-10', () => {
  // ── Card rendering ──

  test('TG-1: Telegram Bot card is visible on Channels tab', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    // Card title and description should be visible
    await expect(page.getByText('Telegram Bot', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Connect a Telegram bot so you can chat with your AI assistant'),
    ).toBeVisible();

    // Status dot should be present
    await expect(page.locator('[data-testid="tg-status-dot"]')).toBeVisible();

    await page.close();
  });

  test('TG-2: status dot shows idle (gray) by default', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    const statusDot = page.locator('[data-testid="tg-status-dot"]');
    await expect(statusDot).toBeVisible();
    // Default status should be idle → bg-gray-400
    await expect(statusDot).toHaveClass(/bg-gray-400/);

    await page.close();
  });

  test('TG-3: Telegram card not visible on other tabs', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/index.html`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('AskTab Settings', { timeout: 10000 });

    // General tab (default) — no Telegram card
    await expect(page.locator('[data-testid="tg-status-dot"]')).not.toBeVisible();

    // Model tab — no Telegram card
    await page.locator('nav button', { hasText: 'Model' }).click();
    await expect(page.locator('[data-testid="tg-status-dot"]')).not.toBeVisible();

    // Tool tab — no Telegram card
    await page.locator('nav button', { hasText: 'Tool' }).click();
    await expect(page.locator('[data-testid="tg-status-dot"]')).not.toBeVisible();

    await page.close();
  });

  // ── Bot token validation ──

  test('TG-4: Validate button disabled when token is empty', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    const validateBtn = page.locator('[data-testid="tg-validate-btn"]');
    await expect(validateBtn).toBeDisabled();

    await page.close();
  });

  test('TG-5: enter token and validate — success shows bot identity', async ({
    context,
    extensionId,
  }) => {
    await mockTelegramApi(context, { valid: true, username: 'my_test_bot' });

    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    await page.locator('[data-testid="tg-token-input"]').fill('123:fake-test-token');
    await page.locator('[data-testid="tg-validate-btn"]').click();

    // Should show bot identity with username
    await expect(page.locator('[data-testid="tg-bot-identity"]')).toContainText('@my_test_bot', {
      timeout: 10000,
    });

    await page.close();
  });

  test('TG-6: changing token resets validation state', async ({ context, extensionId }) => {
    await mockTelegramApi(context, { valid: true, username: 'reset_bot' });

    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    // Validate first
    const tokenInput = page.locator('[data-testid="tg-token-input"]');
    await tokenInput.fill('123:valid-token');
    await page.locator('[data-testid="tg-validate-btn"]').click();
    await expect(page.locator('[data-testid="tg-bot-identity"]')).toBeVisible({ timeout: 10000 });

    // Change token — identity should disappear
    await tokenInput.fill('123:new-token');
    await expect(page.locator('[data-testid="tg-bot-identity"]')).not.toBeVisible();

    await page.close();
  });

  // ── Allowed user IDs ──

  test('TG-7: no-users warning shown when list is empty', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    await expect(page.locator('[data-testid="tg-no-users-warning"]')).toBeVisible();
    await expect(page.locator('[data-testid="tg-no-users-warning"]')).toContainText(
      'No users allowed yet',
    );

    await page.close();
  });

  test('TG-8: add a numeric user ID — badge appears', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    await page.locator('[data-testid="tg-user-id-input"]').fill('123456789');
    await page.locator('[data-testid="tg-add-user-btn"]').click();

    // Badge should appear
    await expect(page.locator('[data-testid="tg-user-badges"]')).toBeVisible();
    await expect(page.locator('[data-testid="tg-user-badges"]')).toContainText('123456789');

    // No-users warning should disappear
    await expect(page.locator('[data-testid="tg-no-users-warning"]')).not.toBeVisible();

    await page.close();
  });

  test('TG-9: non-numeric user ID — Add button stays disabled', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    const addBtn = page.locator('[data-testid="tg-add-user-btn"]');

    // "abc" is non-numeric
    await page.locator('[data-testid="tg-user-id-input"]').fill('abc');
    await expect(addBtn).toBeDisabled();

    // "12.34" contains a dot
    await page.locator('[data-testid="tg-user-id-input"]').fill('12.34');
    await expect(addBtn).toBeDisabled();

    // Valid numeric
    await page.locator('[data-testid="tg-user-id-input"]').fill('999');
    await expect(addBtn).toBeEnabled();

    await page.close();
  });

  test('TG-10: duplicate user ID is prevented', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    const userInput = page.locator('[data-testid="tg-user-id-input"]');
    const addBtn = page.locator('[data-testid="tg-add-user-btn"]');

    // Add "111" first time
    await userInput.fill('111');
    await addBtn.click();
    await expect(page.locator('[data-testid="tg-user-badges"]')).toContainText('111');

    // Add "111" again
    await userInput.fill('111');
    await addBtn.click();

    // Should still only have one badge — count child badge elements by their X button
    const badges = page.locator('[data-testid="tg-user-badges"] button');
    await expect(badges).toHaveCount(1);

    await page.close();
  });

  test('TG-11: remove user ID via X button', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    // Add a user
    await page.locator('[data-testid="tg-user-id-input"]').fill('222');
    await page.locator('[data-testid="tg-add-user-btn"]').click();
    await expect(page.locator('[data-testid="tg-user-badges"]')).toContainText('222');

    // Click the X button on the badge
    await page.locator('[data-testid="tg-user-badges"] button').click();

    // Badge should disappear, warning should return
    await expect(page.locator('[data-testid="tg-no-users-warning"]')).toBeVisible();

    await page.close();
  });

  // ── Enable/Disable toggle ──

  test('TG-12: enable toggle disabled without valid token + users', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    // Toggle should be disabled by default (no token validated, no users)
    await expect(page.locator('[data-testid="tg-enable-toggle"]')).toBeDisabled();

    await page.close();
  });

  // ── Save & persistence ──

  test('TG-13: auto-save shows confirmation after adding user', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    // Add a user ID — triggers immediate auto-save
    await page.locator('[data-testid="tg-user-id-input"]').fill('555555');
    await page.locator('[data-testid="tg-add-user-btn"]').click();

    // Should show "Saved" indicator
    await expect(page.locator('[data-testid="tg-saved-indicator"]')).toBeVisible({ timeout: 5000 });

    await page.close();
  });

  test('TG-14: configuration persists across page reload', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    // Add a user ID — triggers immediate auto-save
    await page.locator('[data-testid="tg-user-id-input"]').fill('987654321');
    await page.locator('[data-testid="tg-add-user-btn"]').click();
    await expect(page.locator('[data-testid="tg-user-badges"]')).toContainText('987654321');

    // Wait for auto-save to complete
    await expect(page.locator('[data-testid="tg-saved-indicator"]')).toBeVisible({ timeout: 5000 });

    // Reload and navigate back
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toContainText('AskTab Settings', { timeout: 10000 });
    await page.locator('nav button', { hasText: 'Channels' }).click();
    await expect(page.getByText('Telegram Bot', { exact: true })).toBeVisible({ timeout: 10000 });

    // User badge should still be present
    await expect(page.locator('[data-testid="tg-user-badges"]')).toContainText('987654321');

    await page.close();
  });

  test('TG-15: invalid token shows validation error', async ({ context, extensionId }) => {
    await mockTelegramApi(context, { valid: false });

    const page = await context.newPage();
    await openChannelsTab(page, extensionId);

    await page.locator('[data-testid="tg-token-input"]').fill('bad-token-value');
    await page.locator('[data-testid="tg-validate-btn"]').click();

    await expect(page.locator('[data-testid="tg-validation-error"]')).toBeVisible({
      timeout: 10000,
    });

    await page.close();
  });
});
