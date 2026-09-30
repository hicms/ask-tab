import { expect, test } from '@playwright/test';
import {
  createSourceFile,
  isVariableStatement,
  ModuleKind,
  ScriptTarget,
  transpileModule,
} from 'typescript';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VisualCommand } from '../../../chrome-extension/src/background/tools/browser-visuals';
import type { Page } from '@playwright/test';

// Chrome also serializes this declaration rather than loading its module in the page.
const sourcePath = resolve('chrome-extension/src/background/tools/browser-visuals.ts');
const source = createSourceFile(
  sourcePath,
  readFileSync(sourcePath, 'utf8'),
  ScriptTarget.Latest,
  true,
);
const declaration = source.statements.find(
  statement =>
    isVariableStatement(statement) &&
    statement.declarationList.declarations.some(
      declaration => declaration.name.getText(source) === 'renderBrowserVisuals',
    ),
);
if (!declaration) throw new Error('Missing renderBrowserVisuals declaration');
const script = transpileModule(`${declaration.getText(source)}\nrenderBrowserVisuals;`, {
  compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None },
}).outputText;

const render = (page: Page, command: VisualCommand, ref: number | null = null) =>
  page.evaluate(
    ({ script, command, ref }) => {
      const render = eval(script) as (
        command: string,
        ref: number | null,
        appearance: { style: string; markup: string },
      ) => Promise<boolean>;
      return render(command, ref, { style: '.cursor { width: 24px; height: 24px; }', markup: '' });
    },
    { script, command, ref },
  );

const labels = (page: Page) => page.locator('[data-asktab-visuals] .label');

test.beforeEach(async ({ page }) => {
  await page.setContent(`<!doctype html><style>
    body { margin: 0; font: 16px system-ui; }
    button { position: absolute; width: 120px; height: 40px; }
    #nav { left: 20px; top: 100px; }
    #old { left: 380px; top: 100px; }
    #other { left: 380px; top: 220px; }
    #details { position: absolute; left: 300px; top: 40px; width: 500px; height: 400px; z-index: 10; background: white; }
    #details button { left: 180px; top: 100px; }
  </style><button id="nav" data-ref="1">Sidebar</button>
    <div id="list"><button id="old" data-ref="2">Old row</button>
    <button id="other" data-ref="3">Old action</button></div>`);
  await page.evaluate(() => {
    const scope = globalThis as typeof globalThis & { __askTabRefs?: Map<number, Element> };
    scope.__askTabRefs = new Map(
      [...document.querySelectorAll('[data-ref]')].map(element => [
        Number(element.getAttribute('data-ref')),
        element,
      ]),
    );
  });
  await render(page, 'show');
  await expect(labels(page)).toHaveText(['1', '2', '3']);
});

test('opening a detail panel removes covered old-page markers while retaining visible sidebar refs', async ({
  page,
}) => {
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<section id="details"><button id="current">Current details</button></section>',
    );
  });
  // The old page DOM deliberately remains mounted behind the new panel.
  await expect(page.locator('#old')).toBeAttached();
  await expect(labels(page)).toHaveText(['1']);
  await page.evaluate(() => {
    const scope = globalThis as typeof globalThis & { __askTabRefs?: Map<number, Element> };
    scope.__askTabRefs!.set(4, document.querySelector('#current')!);
  });
  await render(page, 'show');
  await expect(labels(page)).toHaveText(['1', '4']);
  await page.locator('#details').evaluate(element => element.remove());
  await expect(labels(page)).toHaveText(['1', '2', '3']);
});

test('CSS-hidden, transparent and clipped old content loses its markers after page mutations', async ({
  page,
}) => {
  for (const style of [
    'visibility: hidden',
    'opacity: 0',
    'display: none',
    'position: absolute; width: 200px; height: 40px; overflow: hidden',
  ]) {
    await page
      .locator('#list')
      .evaluate((element, style) => element.setAttribute('style', style), style);
    await expect(labels(page)).toHaveText(['1']);
    await page.locator('#list').evaluate(element => element.removeAttribute('style'));
    await expect(labels(page)).toHaveText(['1', '2', '3']);
  }
});

test('real shadow-root targets remain labeled and disappear when covered by a page panel', async ({
  page,
}) => {
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'shadow-target';
    host.style.cssText = 'position:absolute;left:380px;top:360px;width:120px;height:40px';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = '<button style="width:120px;height:40px">Shadow action</button>';
    document.body.append(host);
    const scope = globalThis as typeof globalThis & { __askTabRefs?: Map<number, Element> };
    scope.__askTabRefs!.set(4, shadow.querySelector('button')!);
  });
  await render(page, 'show');
  await expect(labels(page)).toHaveText(['1', '2', '3', '4']);
  await page.evaluate(() =>
    document.body.insertAdjacentHTML('beforeend', '<section id="details"></section>'),
  );
  await expect(labels(page)).toHaveText(['1']);
});

test('refresh and clear remove orphan overlays even when their page-world state was lost', async ({
  page,
}) => {
  await page.evaluate(() => {
    delete (globalThis as typeof globalThis & { __askTabVisualState?: unknown })
      .__askTabVisualState;
  });
  await render(page, 'prepare');
  await expect(page.locator('[data-asktab-visuals]')).toHaveCount(0);
  await render(page, 'show');
  await expect(page.locator('[data-asktab-visuals]')).toHaveCount(1);
  await page.evaluate(() => {
    delete (globalThis as typeof globalThis & { __askTabVisualState?: unknown })
      .__askTabVisualState;
  });
  await render(page, 'clear');
  await expect(page.locator('[data-asktab-visuals]')).toHaveCount(0);
});
