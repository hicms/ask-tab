import { expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

/**
 * Waits for the extension page to finish loading React.
 * Resolves once either the FirstRunSetup or Chat UI is visible.
 */
export const waitForAppReady = async (page: Page) => {
  // Wait for React to render one of the possible root states
  await expect(
    page.locator('#setup-email, textarea, [data-testid="user-menu-button"]').first(),
  ).toBeVisible({ timeout: 15000 });
};

/**
 * Answers the AskTab service sign-in and model list so FirstRunSetup can finish
 * without a running server.
 */
export const mockAskService = async (context: BrowserContext) => {
  await context.route(/\/api\/auth\/(login|register)$/, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'e2e-token',
        expiresAt: Date.now() + 60 * 60_000,
        user: { id: 'e2e', email: 'e2e@example.com' },
      }),
    }),
  );
  await context.route(/\/api\/models$/, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'test-model',
          name: 'Test Model',
          protocol: 'openai-completions',
          kind: 'chat',
          embeddingSpaceId: null,
          isDefault: true,
          supportsTools: true,
          supportsReasoning: false,
          contextWindow: null,
        },
        {
          id: 'test-stt',
          name: 'Test STT',
          protocol: 'openai-transcriptions',
          kind: 'stt',
          embeddingSpaceId: null,
          isDefault: true,
          supportsTools: false,
          supportsReasoning: false,
          contextWindow: null,
        },
        {
          id: 'test-stt-second',
          name: 'Second STT',
          protocol: 'openai-transcriptions',
          kind: 'stt',
          embeddingSpaceId: null,
          isDefault: false,
          supportsTools: false,
          supportsReasoning: false,
          contextWindow: null,
        },
        {
          id: 'test-tts',
          name: 'Test TTS',
          protocol: 'openai-speech',
          kind: 'tts',
          embeddingSpaceId: null,
          isDefault: true,
          supportsTools: false,
          supportsReasoning: false,
          contextWindow: null,
        },
        {
          id: 'test-embedding',
          name: 'Test Embedding',
          protocol: 'openai-embeddings',
          kind: 'embedding',
          embeddingSpaceId: 'test-space',
          isDefault: true,
          supportsTools: false,
          supportsReasoning: false,
          contextWindow: null,
        },
      ]),
    }),
  );
};

/**
 * If the FirstRunSetup is showing (signed out, no models),
 * signs in against the mocked AskTab service so the Chat UI renders.
 */
export const bypassFirstRunSetup = async (page: Page) => {
  const setupVisible = await page
    .locator('#setup-email')
    .isVisible()
    .catch(() => false);

  if (setupVisible) {
    // Step 1: Account sign-in
    await mockAskService(page.context());
    await page.locator('[data-testid="setup-email"]').fill('e2e@example.com');
    await page.locator('[data-testid="setup-password"]').fill('e2e-password');
    await page.locator('[data-testid="setup-start-button"]').click();

    // Steps 2-5: Skip entire setup
    await page.locator('[data-testid="setup-skip-setup"]').click();

    // Wait for Chat UI to appear after setup completes
    await expect(page.locator('button[title="Toggle sidebar"], textarea').first()).toBeVisible({
      timeout: 10000,
    });
  }
};

/**
 * Navigates to the side panel, waits for load, and bypasses FirstRunSetup if needed.
 * Returns the page ready for Chat UI interactions.
 */
export const setupSidePanel = async (page: Page, extensionId: string) => {
  await page.goto(`chrome-extension://${extensionId}/side-panel/index.html`);
  await page.waitForLoadState('domcontentloaded');
  await waitForAppReady(page);
  await bypassFirstRunSetup(page);
};

/**
 * Navigates to the full-page chat, waits for load, and bypasses FirstRunSetup if needed.
 */
export const setupFullPageChat = async (page: Page, extensionId: string) => {
  await page.goto(`chrome-extension://${extensionId}/full-page-chat/index.html`);
  await page.waitForLoadState('domcontentloaded');
  await waitForAppReady(page);
  await bypassFirstRunSetup(page);
};

/**
 * Completes FirstRunSetup through the side panel so the default agent and its
 * workspace files exist, then opens the options page.
 */
export const openOptionsAfterSetup = async (page: Page, extensionId: string) => {
  await setupSidePanel(page, extensionId);
  await page.goto(`chrome-extension://${extensionId}/options/index.html`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('h1')).toContainText('AskTab Settings', { timeout: 10000 });
};

/**
 * Navigate to Options > Channels tab and wait for Telegram Bot card.
 */
export const openChannelsTab = async (page: Page, extensionId: string) => {
  await page.goto(`chrome-extension://${extensionId}/options/index.html`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('h1')).toContainText('AskTab Settings', { timeout: 10000 });
  await page.locator('nav button', { hasText: 'Channels' }).click();
  await expect(page.getByText('Telegram Bot', { exact: true })).toBeVisible({ timeout: 10000 });
};

/**
 * Mock Telegram Bot API responses at the network level for E2E tests.
 * Intercepts fetch calls to api.telegram.org from the service worker.
 */
export const mockTelegramApi = async (
  context: BrowserContext,
  overrides?: { valid?: boolean; username?: string },
) => {
  const { valid = true, username = 'test_e2e_bot' } = overrides ?? {};

  // Mock getMe (validate)
  await context.route('**/api.telegram.org/**/getMe', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        valid
          ? { ok: true, result: { id: 99999, is_bot: true, first_name: 'TestBot', username } }
          : { ok: false, description: 'Unauthorized' },
      ),
    }),
  );

  // Mock getUpdates (polling — return empty)
  await context.route('**/api.telegram.org/**/getUpdates**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, result: [] }),
    }),
  );

  // Mock setMyCommands (enable channel)
  await context.route('**/api.telegram.org/**/setMyCommands', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, result: true }),
    }),
  );
};
