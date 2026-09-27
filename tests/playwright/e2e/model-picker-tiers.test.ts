import { test, expect } from '../fixtures/extension';
import { openChat, seedCatalog } from '../helpers/chat-catalog';
import type { StoredModel } from '../helpers/chat-catalog';
import type { Page } from '@playwright/test';

const stored = (id: string, name: string, extra: Record<string, unknown> = {}): StoredModel => ({
  id: `ask:${id}`,
  modelId: id,
  name,
  provider: 'custom',
  supportsImages: true,
  ...extra,
});

const rated = (vendor: string | null, tier: string, priceMultiplier: number) => ({
  ...(vendor ? { vendor } : {}),
  tier,
  priceMultiplier,
});

// Deliberately out of tier order: groups must follow tiers, options the catalog order.
const catalog = [
  stored('grok-4-7-fast', 'Grok 4.7 Fast', rated('xai', 'flagship', 3.5)),
  stored('gemini-3-1-pro', 'Gemini 3.1 Pro Preview', rated('google', 'balanced', 2.5)),
  stored('unrated', 'Unrated Model'),
  stored('gemini-3-5-flash-lite', 'Gemini 3.5 Flash-Lite', rated('google', 'fast', 0.5)),
  stored('kimi-k3', 'Kimi K3', rated('moonshot', 'flagship', 3.5)),
  stored('gemini-3-8-flash', 'Gemini 3.8 Flash', rated('google', 'balanced', 0.9)),
  stored('mystery', 'Mystery Model', rated('acme', 'fast', 0.05)),
  stored('anon', 'Anon Model', rated(null, 'balanced', 1)),
];

const priceHint =
  'Approximate price relative to a reference price (1x), estimated from list prices';

/** Group headings, option texts and vendor icons as rendered in the open listbox. */
const pickerLayout = (page: Page) =>
  page.getByRole('listbox').evaluate(listbox =>
    [...listbox.querySelectorAll('[role="group"]')].map(group => {
      const labelId = group.getAttribute('aria-labelledby');
      return {
        label: labelId ? (document.getElementById(labelId)?.textContent ?? null) : null,
        options: [...group.querySelectorAll('[role="option"]')].map(option => {
          const icon = option.querySelector('[data-vendor]')!;
          return {
            text: option.textContent,
            vendor: icon.getAttribute('data-vendor'),
            title: icon.getAttribute('title'),
          };
        }),
      };
    }),
  );

const modelPicker = (page: Page) => page.getByRole('combobox').filter({ hasText: /grok|kimi/i });

for (const pagePath of ['side-panel', 'full-page-chat'] as const) {
  test(`${pagePath} groups models by tier with vendor icons and prices`, async ({
    context,
    extensionId,
  }) => {
    const page = await openChat(context, extensionId, pagePath, { cached: catalog, locale: 'en' });
    await modelPicker(page).click();
    await expect(page.getByRole('listbox')).toBeVisible();

    expect(await pickerLayout(page)).toEqual([
      {
        label: 'Flagship',
        options: [
          { text: 'Grok 4.7 FastFlagship3.5x', vendor: 'xai', title: 'xAI' },
          { text: 'Kimi K3Flagship3.5x', vendor: 'moonshot', title: 'Moonshot AI' },
        ],
      },
      {
        label: 'Balanced',
        options: [
          { text: 'Gemini 3.1 Pro PreviewBalanced2.5x', vendor: 'google', title: 'Google' },
          { text: 'Gemini 3.8 FlashBalanced0.9x', vendor: 'google', title: 'Google' },
          { text: 'Anon ModelBalanced1x', vendor: 'unknown', title: null },
        ],
      },
      {
        label: 'Fast',
        options: [
          { text: 'Gemini 3.5 Flash-LiteFast0.5x', vendor: 'google', title: 'Google' },
          { text: 'Mystery ModelFast0.05x', vendor: 'unknown', title: 'acme' },
        ],
      },
      {
        label: null,
        options: [{ text: 'Unrated Model', vendor: 'unknown', title: null }],
      },
    ]);
    await expect(page.getByTestId('model-price-multiplier').first()).toHaveAttribute(
      'title',
      priceHint,
    );
    await expect(page.getByRole('option', { name: /Kimi K3/ })).toHaveAccessibleDescription(
      /Flagship\s*3\.5x/,
    );
    await expect(page.getByRole('option', { name: /Unrated Model/ })).toHaveAccessibleDescription(
      '',
    );

    // Three Gemini icons draw gradients: every instance needs its own IDs.
    const gradients = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[data-vendor] [id]')].map(el => el.id);
      const refs = [...document.querySelectorAll('[data-vendor] [fill^="url(#"]')].map(el =>
        el.getAttribute('fill')!.slice(5, -1),
      );
      return {
        ids: ids.length,
        unique: new Set(ids).size,
        unresolved: refs.filter(ref => !document.getElementById(ref)),
        // White marks vanish on the light theme.
        white: document.querySelectorAll('[data-vendor] [fill="#fff"]').length,
      };
    });
    expect(gradients.ids).toBeGreaterThanOrEqual(9);
    expect(gradients.unique).toBe(gradients.ids);
    expect(gradients.unresolved).toEqual([]);
    expect(gradients.white).toBe(0);

    // Type-ahead matches on the name alone.
    await page.keyboard.type('Kim');
    await expect(page.getByRole('option', { name: /Kimi K3/ })).toHaveAttribute(
      'data-highlighted',
      '',
    );
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toHaveCount(0);

    const picker = modelPicker(page);
    await expect(picker).toHaveText('Kimi K3');
    await expect(picker.locator('[data-vendor="moonshot"]')).toHaveCount(1);
    await expect(picker.locator('[data-tier], [data-testid="model-price-multiplier"]')).toHaveCount(
      0,
    );

    const badge = page.getByTestId('chat-header-model');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('Kimi K3');
    await expect(badge.locator('[data-vendor="moonshot"]')).toHaveAttribute('title', 'Moonshot AI');
    await expect(badge.getByTestId('model-price-multiplier')).toHaveText('3.5x');
    await expect(badge.getByTestId('model-price-multiplier')).toHaveAttribute('title', priceHint);

    await modelPicker(page).click();
    await page.getByRole('listbox').screenshot({
      path: `test-results/model-picker-${pagePath}.png`,
      animations: 'disabled',
      scale: 'device',
    });
  });
}

test('a catalog cached before tiers existed stays a flat list', async ({
  context,
  extensionId,
}) => {
  const legacy = [stored('grok-4-7-fast', 'Grok 4.7 Fast'), stored('kimi-k3', 'Kimi K3')];
  const page = await openChat(context, extensionId, 'side-panel', { cached: legacy, locale: 'en' });
  await modelPicker(page).click();
  expect(await pickerLayout(page)).toEqual([
    {
      label: null,
      options: [
        { text: 'Grok 4.7 Fast', vendor: 'unknown', title: null },
        { text: 'Kimi K3', vendor: 'unknown', title: null },
      ],
    },
  ]);
});

test('the settings model list shows vendor, tier and price', async ({ context, extensionId }) => {
  await seedCatalog(context, catalog, 'en');
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options/index.html`);
  await page.getByRole('button', { name: 'Models', exact: true }).click();

  const rows = page.getByTestId('server-model');
  await expect(rows).toHaveCount(catalog.length);
  const grok = rows.filter({ hasText: 'Grok 4.7 Fast' });
  await expect(grok.locator('[data-vendor="xai"]')).toHaveAttribute('title', 'xAI');
  await expect(grok.locator('[data-tier="flagship"]')).toHaveText('Flagship');
  await expect(grok.getByTestId('model-price-multiplier')).toHaveText('3.5x');
  await expect(grok.getByTestId('model-price-multiplier')).toHaveAttribute('title', priceHint);

  const unrated = rows.filter({ hasText: 'Unrated Model' });
  await expect(unrated.locator('[data-vendor="unknown"]')).toHaveCount(1);
  await expect(unrated.locator('[data-tier], [data-testid="model-price-multiplier"]')).toHaveCount(
    0,
  );
  await page.screenshot({ path: 'test-results/model-picker-settings.png', fullPage: true });
});
