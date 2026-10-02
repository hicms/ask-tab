import { test, expect } from '../fixtures/extension';
import { openChat } from '../helpers/chat-catalog';
import type { StoredModel } from '../helpers/chat-catalog';
import type { BrowserContext } from '@playwright/test';

const sonnet: StoredModel = {
  id: 'ask:claude-sonnet-5-5',
  modelId: 'claude-sonnet-5-5',
  name: 'Claude Sonnet 5.5',
  provider: 'anthropic',
  supportsReasoning: true,
};

// Shaped like the live catalog entry.
const sonnetControls = [
  { path: 'thinking.type', values: ['adaptive', 'disabled'], default: 'adaptive' },
  { path: 'thinking.display', values: ['omitted', 'summarized'], default: 'omitted' },
  { path: 'output_config.effort', values: ['low', 'medium', 'high', 'max'], default: 'high' },
];

const seedPublicModels = (context: BrowserContext) =>
  context.serviceWorkers()[0]!.evaluate(
    controls =>
      chrome.storage.local.set({
        'public-models': [
          {
            id: 'claude-sonnet-5-5',
            name: 'Claude Sonnet 5.5',
            protocol: 'anthropic-messages',
            kind: 'chat',
            embeddingSpaceId: null,
            isDefault: true,
            supportsTools: true,
            supportsReasoning: true,
            supportsImages: true,
            contextWindow: 200000,
            vendor: 'anthropic',
            tier: 'flagship',
            priceMultiplier: 3,
            reasoningControls: controls,
          },
        ],
        'reasoning-selections': {},
      }),
    sonnetControls,
  );

const cases = [
  {
    locale: 'zh_CN',
    chip: '高',
    title: '思考选项',
    sections: ['思考模式', '显示思考过程', '思考强度'],
    effortItems: ['低', '中', '高默认', '最高'],
    pick: '最高',
    tooltip: ['思考模式', '自适应', '显示思考过程', '隐藏', '思考强度', '最高'],
  },
  {
    locale: 'en',
    chip: 'High',
    title: 'Thinking options',
    sections: ['Thinking mode', 'Show thinking', 'Thinking effort'],
    effortItems: ['Low', 'Medium', 'HighDefault', 'Max'],
    pick: 'Max',
    tooltip: ['Thinking mode', 'Adaptive', 'Show thinking', 'Hidden', 'Thinking effort', 'Max'],
  },
] as const;

for (const expected of cases) {
  test(`thinking menu speaks ${expected.locale} instead of request field names`, async ({
    context,
    extensionId,
  }) => {
    const page = await openChat(context, extensionId, 'side-panel', {
      cached: [sonnet],
      locale: expected.locale,
    });
    await seedPublicModels(context);

    const trigger = page.getByTestId('reasoning-controls-button');
    await expect(trigger).toHaveText(expected.chip);
    await expect(trigger).not.toHaveAttribute('title');

    await trigger.click();
    const menu = page.getByTestId('reasoning-controls-menu');
    await expect(menu).toBeVisible();
    await expect(menu).not.toContainText(/thinking\.|output_config|adaptive|omitted/);
    for (const section of expected.sections) await expect(menu).toContainText(section);
    await expect(menu.getByRole('menuitemradio')).toHaveCount(2 + 2 + 4);
    const effortItems = await menu
      .getByRole('group')
      .nth(2)
      .getByRole('menuitemradio')
      .allTextContents();
    expect(effortItems).toEqual([...expected.effortItems]);
    await menu.screenshot({ path: `test-results/reasoning-menu-${expected.locale}.png` });

    await menu.getByRole('menuitemradio', { name: expected.pick, exact: true }).click();
    await expect(trigger).toHaveText(expected.pick);
    await expect
      .poll(() =>
        context
          .serviceWorkers()[0]!
          .evaluate(
            async () =>
              (await chrome.storage.local.get('reasoning-selections'))['reasoning-selections'],
          ),
      )
      .toEqual({ 'claude-sonnet-5-5': { 'output_config.effort': 'max' } });

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await trigger
      .locator('xpath=ancestor::form')
      .screenshot({ path: `test-results/reasoning-composer-${expected.locale}.png` });
    await page.mouse.move(0, 0);
    await trigger.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toContainText(expected.title);
    // Radix also renders a visually hidden copy for screen readers; check the drawn one.
    const bubble = page.locator('[data-radix-popper-content-wrapper]').first();
    const rows = bubble.locator('dl').first().locator('dt, dd');
    expect(await rows.allTextContents()).toEqual([...expected.tooltip]);
    await bubble.screenshot({ path: `test-results/reasoning-tooltip-${expected.locale}.png` });
  });
}
