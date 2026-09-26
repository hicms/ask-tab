import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { BrowserArgs } from '../../../chrome-extension/src/background/tools/browser-schema';
import type { Page } from '@playwright/test';

test.use({ headless: true, channel: process.env.CURSOR_TEST_BROWSER_CHANNEL });
let bundle: string;

interface ActionWindow {
  PageActions: { performPageAction: (...args: unknown[]) => Promise<string> };
  __askTabRefs: Map<number, Element>;
  events: string[];
  tracked: string;
}

test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: true,
      lib: {
        entry: resolve('chrome-extension/src/background/tools/browser-page-actions.ts'),
        name: 'PageActions',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Expected browser bundle');
  const chunk = output.output.find(item => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing browser bundle');
  bundle = chunk.code;
});

test.beforeEach(async ({ page }) => {
  await page.setContent(`
    <select id="select"><option value="a">Alpha</option><option value="b">Beta</option><option value="c" disabled>Disabled</option><option value="d">Same</option><option value="e">Same</option></select>
    <input id="input" value="old"><textarea id="textarea">old</textarea><input id="readonly" readonly value="old">
    <div id="editable" contenteditable="true">old</div><button id="button">Click</button><div id="plain">Plain</div>
    <div id="scroller" style="width:150px;height:100px;overflow:auto;scroll-behavior:smooth"><div style="width:600px;height:800px"><button id="inside">Inside</button></div></div>
  `);
  await page.evaluate(bundle);
  await page.evaluate(() => {
    const w = window as unknown as ActionWindow;
    w.events = [];
    const ids = [
      'select',
      'input',
      'textarea',
      'readonly',
      'editable',
      'button',
      'plain',
      'inside',
    ];
    w.__askTabRefs = new Map(ids.map((id, i) => [i + 1, document.getElementById(id)!]));
  });
});

const act = (page: Page, request: Partial<BrowserArgs>, cdp = false) =>
  page.evaluate(
    async ({ request, cdp }) => {
      const w = window as unknown as ActionWindow;
      // Deserializing catches accidental closure dependencies after production minification.
      const injected = (0, eval)(`(${w.PageActions.performPageAction.toString()})`);
      return (await injected.call(
        cdp ? w.__askTabRefs.get(request.ref!) : undefined,
        request,
        cdp,
      )) as string;
    },
    { request, cdp },
  );

for (const cdp of [false, true]) {
  test(`select by label/value, reject invalid/disabled/ambiguous options (${cdp ? 'CDP this' : 'scripting ref'})`, async ({
    page,
  }) => {
    await page.evaluate(() => {
      for (const name of ['input', 'change'])
        document
          .querySelector('select')!
          .addEventListener(name, () => (window as unknown as ActionWindow).events.push(name));
    });
    expect(await act(page, { action: 'select', ref: 1, text: 'Beta' }, cdp)).toContain('Selected');
    await expect(page.locator('select')).toHaveValue('b');
    expect(await page.evaluate(() => (window as unknown as ActionWindow).events)).toEqual([
      'input',
      'change',
    ]);
    expect(await act(page, { action: 'select', ref: 1, text: 'Same' }, cdp)).toContain('Multiple');
    expect(await act(page, { action: 'select', ref: 1, value: 'e' }, cdp)).toContain('Selected');
    expect(await act(page, { action: 'select', ref: 1, value: 'c' }, cdp)).toContain('disabled');
    expect(await act(page, { action: 'select', ref: 1, text: 'Missing' }, cdp)).toContain(
      'No matching',
    );
    expect(await act(page, { action: 'select', ref: 6, text: 'Alpha' }, cdp)).toContain('native');
    await page.locator('select').evaluate(element => {
      (element as HTMLSelectElement).add(new Option('Duplicate First', 'x'));
      (element as HTMLSelectElement).add(new Option('Duplicate Second', 'x'));
    });
    expect(await act(page, { action: 'select', ref: 1, text: 'Duplicate Second' }, cdp)).toContain(
      'Selected',
    );
    expect(
      await page
        .locator('select')
        .evaluate(element => (element as HTMLSelectElement).selectedIndex),
    ).toBe(6);
  });
}

test('input bypasses framework value tracker; empty text clears input, textarea and contenteditable', async ({
  page,
}) => {
  await page.evaluate(() => {
    const input = document.querySelector('input')!;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    const w = window as unknown as ActionWindow;
    w.tracked = input.value;
    Object.defineProperty(input, 'value', {
      get: () => descriptor.get!.call(input),
      set: value => {
        w.tracked = value;
        descriptor.set!.call(input, value);
      },
    });
    input.addEventListener('input', () => {
      if (w.tracked !== input.value) w.events.push(input.value);
    });
  });
  expect(await act(page, { action: 'type', ref: 2, text: 'new' })).toContain('Typed');
  expect(await page.evaluate(() => (window as unknown as ActionWindow).events)).toEqual(['new']);
  for (const ref of [2, 3, 5])
    expect(await act(page, { action: 'type', ref, text: '' })).toContain('Typed');
  await expect(page.locator('#input')).toHaveValue('');
  await expect(page.locator('#textarea')).toHaveValue('');
  await expect(page.locator('#editable')).toHaveText('');
  expect(await act(page, { action: 'type', ref: 4, text: 'new' })).toContain('read-only');
  expect(await act(page, { action: 'type', ref: 7, text: 'new' })).toContain('not editable');
});

test('click emits pointer/mouse/focus events on the captured element, then rejects a stale ref', async ({
  page,
}) => {
  await page.evaluate(() => {
    const button = document.querySelector('#button')!;
    for (const name of ['pointerdown', 'mousedown', 'focus', 'pointerup', 'mouseup', 'click'])
      button.addEventListener(name, () => (window as unknown as ActionWindow).events.push(name));
    button.before(document.createElement('button'));
  });
  expect(await act(page, { action: 'click', ref: 6 })).toContain('Clicked');
  expect(await page.evaluate(() => (window as unknown as ActionWindow).events)).toEqual([
    'pointerdown',
    'mousedown',
    'focus',
    'pointerup',
    'mouseup',
    'click',
  ]);
  await page.locator('#button').evaluate(element => element.remove());
  expect(await act(page, { action: 'click', ref: 6 })).toContain('stale');
});

test('click rejects an occluded target without dispatching click', async ({ page }) => {
  await page.evaluate(() => {
    const button = document.querySelector('#button')!;
    button.addEventListener('click', () => {
      throw new Error('Blocked target clicked');
    });
    const blocker = document.createElement('div');
    blocker.style.cssText = 'position:fixed;inset:0;z-index:100;background:white';
    document.body.append(blocker);
  });
  expect(await act(page, { action: 'click', ref: 6 })).toContain('blocked');
});

test('scroll changes only nearest container on both axes, reports boundaries and supports page scrolling', async ({
  page,
}) => {
  expect(await act(page, { action: 'scroll', ref: 8, pixels: 70 })).toContain('70px');
  expect(
    await act(page, { action: 'scroll', ref: 8, direction: 'right', pixels: 90 }, true),
  ).toContain('90px');
  expect(await page.locator('#scroller').evaluate(el => [el.scrollTop, el.scrollLeft])).toEqual([
    70, 90,
  ]);
  expect(await act(page, { action: 'scroll', ref: 8, direction: 'up', pixels: 90 })).toContain(
    '70px',
  );
  expect(await act(page, { action: 'scroll', ref: 8, direction: 'up', pixels: 90 })).toContain(
    'boundary',
  );
  expect(await act(page, { action: 'scroll', ref: 8, direction: 'left', pixels: 90 })).toContain(
    '90px',
  );
  await page.evaluate(() => (document.body.style.height = '3000px'));
  expect(await act(page, { action: 'scroll', pixels: 120 })).toContain('120px');
});

test('scroll finds a container across a shadow root without scrolling another panel', async ({
  page,
}) => {
  await page.evaluate(() => {
    const host = document.createElement('div');
    const target = document.createElement('button');
    target.textContent = 'Shadow target';
    host.attachShadow({ mode: 'open' }).append(target);
    document.querySelector('#inside')!.after(host);
    (window as unknown as ActionWindow).__askTabRefs.set(9, target);
  });
  expect(await act(page, { action: 'scroll', ref: 9, pixels: 60 })).toContain('60px');
  expect(await page.locator('#scroller').evaluate(el => el.scrollTop)).toBe(60);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});
