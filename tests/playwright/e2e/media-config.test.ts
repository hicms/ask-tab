import { test, expect } from '../fixtures/extension';
import { setupSidePanel } from '../helpers/setup';
import type { Page } from '@playwright/test';

const openOptions = async (page: Page, extensionId: string) => {
  await page.goto(`chrome-extension://${extensionId}/options/index.html`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('h1')).toContainText('AskTab Settings', { timeout: 10000 });
};

const openSpeechTab = async (page: Page, extensionId: string) => {
  await openOptions(page, extensionId);
  await page.locator('nav button', { hasText: 'Speech' }).click();
  await expect(page.locator('#stt-engine')).toBeVisible();
};

const selectEngine = async (page: Page, label: string) => {
  await page.locator('#stt-engine').click();
  await page.locator('[role="option"]', { hasText: label }).click();
};

test.describe('Speech settings and server model catalog', () => {
  test('only offers off and server transcription engines', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openSpeechTab(page, extensionId);

    await expect(page.locator('#stt-engine')).toContainText('Off');
    await page.locator('#stt-engine').click();
    await expect(page.locator('[role="option"]')).toHaveText(['Off', 'AskTab server']);
    await page.keyboard.press('Escape');
    await expect(page.locator('#stt-api-key, #stt-base-url')).toHaveCount(0);

    await page.close();
  });

  test('server transcription selects a published model and saves only its ID', async ({
    context,
    extensionId,
  }, testInfo) => {
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await setupSidePanel(page, extensionId);
    await openSpeechTab(page, extensionId);

    await selectEngine(page, 'AskTab server');
    await expect(page.locator('#stt-model')).toContainText('Test STT');
    await page.locator('#stt-model').click();
    await page.locator('[role="option"]', { hasText: 'Second STT' }).click();
    await expect(page.locator('#stt-model')).toContainText('Second STT');
    await expect(page.locator('#stt-api-key, #stt-base-url')).toHaveCount(0);
    await expect
      .poll(async () =>
        page.evaluate(
          async () => (await chrome.storage.local.get('stt-config'))['stt-config']?.openai?.modelId,
        ),
      )
      .toBe('test-stt-second');

    await page.screenshot({ path: testInfo.outputPath('server-stt.png') });
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);

    await page.close();
  });

  test('server transcription shows an actionable empty state', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openSpeechTab(page, extensionId);
    await selectEngine(page, 'AskTab server');

    await expect(page.getByText('Server STT is not configured.')).toBeVisible();
    await expect(page.locator('#stt-model, #stt-api-key, #stt-base-url')).toHaveCount(0);

    await page.close();
  });

  test('speech panel uses server models without credential fields', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await setupSidePanel(page, extensionId);
    await openSpeechTab(page, extensionId);

    await page.locator('#tts-engine').click();
    await page.locator('[role="option"]', { hasText: 'AskTab server' }).click();
    await expect(page.locator('#tts-openai-model')).toContainText('Test TTS');
    await expect(page.locator('#tts-api-key, #tts-base-url')).toHaveCount(0);

    await page.close();
  });
});
