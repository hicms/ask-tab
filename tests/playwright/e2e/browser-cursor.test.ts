import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { Frame, Page } from '@playwright/test';

test.use({ headless: true, channel: process.env.CURSOR_TEST_BROWSER_CHANNEL });

interface VisualTestWindow {
  BrowserVisuals: {
    sendVisualCommand: (
      tabId: number,
      world: string,
      action: string,
      ref?: number,
    ) => Promise<boolean>;
  };
  __askTabVisualRefs: Map<number, Element | null>;
  chrome: {
    scripting: {
      executeScript: (injection: {
        func: (...args: unknown[]) => unknown;
        args: unknown[];
      }) => Promise<Array<{ result: unknown }>>;
    };
  };
}

let bundle: string;

test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: true,
      lib: {
        entry: resolve('chrome-extension/src/background/tools/browser-visuals.ts'),
        name: 'BrowserVisuals',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Expected a browser bundle');
  const chunk = output.output.find(item => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing browser bundle');
  bundle = chunk.code;
});

const command = (page: Page | Frame, action: string, ref?: number) =>
  page.evaluate(
    ({ action, ref }) =>
      // The bundle exposes the same public injection path used by the background worker.
      (window as unknown as VisualTestWindow).BrowserVisuals.sendVisualCommand(
        1,
        'MAIN',
        action,
        ref,
      ),
    { action, ref },
  );

const register = (page: Page | Frame, ref = 7) =>
  page.evaluate(ref => {
    (window as unknown as VisualTestWindow).__askTabVisualRefs = new Map([
      [ref, document.querySelector('button')],
    ]);
  }, ref);

const install = async (page: Page | Frame) => {
  await page.evaluate(bundle);
  await page.evaluate(() => {
    const w = window as unknown as Partial<VisualTestWindow>;
    // Plain web pages in a non-extension browser have no `chrome` object.
    w.chrome ??= {} as VisualTestWindow['chrome'];
    w.chrome.scripting = {
      executeScript: async ({ func, args }) => {
        // Like executeScript, deserialize in the page without the module's closures.
        const injected = (0, eval)(`(${func.toString()})`);
        return [{ result: await injected(...args) }];
      },
    };
  });
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.setContent(`
    <meta http-equiv="Content-Security-Policy" content="img-src 'none'">
    <style>body { margin: 0; } button { margin: 100px; padding: 20px; } .cursor { display: none; }</style>
    <button onclick="this.textContent = 'Clicked'">Target</button>
  `);
  await install(page);
});

test('snapshot shows the original Page Agent cursor before any movement', async ({
  page,
}, info) => {
  await register(page);
  expect(await command(page, 'show')).toBe(true);
  const cursor = page.locator('[data-asktab-visuals] .cursor');
  await expect(cursor).toHaveCSS('opacity', '1');
  await expect(cursor).toBeVisible();
  await expect(cursor).toHaveCSS('width', '75px');
  await expect(cursor.locator('.cursorFilling svg')).toHaveAttribute('viewBox', '0 0 100 100');
  await expect(cursor.locator('.cursorBorder path')).toHaveAttribute('d', /^M 15 42/);
  await expect(cursor.locator('.cursorBorder path')).toHaveAttribute(
    'stroke',
    'url(#asktab-cursor-gradient)',
  );
  await page.screenshot({ path: info.outputPath('page-agent-cursor.png') });
  await page.locator('button').click();
  await expect(page.locator('button')).toHaveText('Clicked');
});

test('the next snapshot keeps the cursor visible at its last target', async ({ page }) => {
  await register(page);
  await command(page, 'show');
  await command(page, 'move', 7);
  await command(page, 'click', 7);
  const cursor = page.locator('[data-asktab-visuals] .cursor');
  const position = await cursor.boundingBox();
  await command(page, 'clear');
  await expect(cursor).toHaveCount(0);
  await command(page, 'prepare');
  await register(page);
  await command(page, 'show');
  await expect(cursor).toHaveCSS('opacity', '1');
  expect(await cursor.boundingBox()).toEqual(position);
});

test('a page without interactive refs still shows the cursor', async ({ page }) => {
  await command(page, 'prepare');
  expect(await command(page, 'show')).toBe(true);
  await expect(page.locator('[data-asktab-visuals] .cursor')).toBeVisible();
  await expect(page.locator('[data-asktab-visuals] .cursor')).toHaveCSS('opacity', '1');
});

test('task reset removes boxes, numbers, cursor and captured refs', async ({ page }) => {
  await register(page);
  await command(page, 'show');
  await expect(page.locator('[data-asktab-visuals] .label')).toHaveText('7');
  await command(page, 'reset');
  await expect(page.locator('[data-asktab-visuals]')).toHaveCount(0);
  expect(await command(page, 'move', 7)).toBe(false);
  await expect(page.locator('[data-asktab-visuals]')).toHaveCount(0);
});

test('boxes follow page changes and disappear with removed targets without scrolling', async ({
  page,
}) => {
  await register(page);
  await command(page, 'show');
  const box = page.locator('[data-asktab-visuals] .box');
  const label = page.locator('[data-asktab-visuals] .label');
  await expect(label).toHaveText('7');

  await page.evaluate(() => {
    document.querySelector('button')!.style.marginLeft = '400px';
  });
  await expect
    .poll(async () => Math.round((await box.boundingBox())?.x ?? -1))
    .toBe(Math.round((await page.locator('button').boundingBox())!.x));

  await command(page, 'click', 7);
  await page.evaluate(() => {
    const next = document.createElement('section');
    next.textContent = 'Next page';
    document.querySelector('button')!.replaceWith(next);
  });
  await expect(box).toHaveCount(0);
  await expect(label).toHaveCount(0);
});

test('only the targeted frame shows a moving cursor', async ({ page }) => {
  await page.evaluate(() => {
    const iframe = document.createElement('iframe');
    iframe.srcdoc = '<button>Frame target</button>';
    document.body.appendChild(iframe);
  });
  await expect(page.frameLocator('iframe').locator('button')).toBeVisible();
  const frame = page.frames().find(frame => frame !== page.mainFrame())!;
  await install(frame);
  await register(page);
  await register(frame, 9);
  await command(page, 'show');
  await command(frame, 'show');
  await expect(page.locator('[data-asktab-visuals] .cursor')).toBeVisible();
  await expect(frame.locator('[data-asktab-visuals] .cursor')).toBeHidden();
  await command(page, 'move', 9);
  await command(frame, 'move', 9);
  await expect(page.locator('[data-asktab-visuals] .cursor')).toBeHidden();
  await expect(frame.locator('[data-asktab-visuals] .cursor')).toBeVisible();
});
