import { test, expect, chromium } from '@playwright/test';
import { build } from 'vite';
import { copyFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

type SandboxWorker = typeof globalThis & {
  ensureJavascriptSandbox: () => Promise<chrome.debugger.Debuggee>;
  resetJavascriptSandbox: () => void;
  cdpSend: (target: chrome.debugger.Debuggee, method: string, params?: object) => Promise<unknown>;
};

test('JavaScript sandbox stays hidden and preserves state across worker rediscovery', async () => {
  // Compile the actual runtime in an isolated extension; no account or dev server is needed.
  const extension = await mkdtemp(join(tmpdir(), 'asktab-sandbox-test-'));
  const source = resolve('chrome-extension/src/background/tools').replaceAll('\\', '/');
  const entry = join(extension, 'entry.js');
  await writeFile(
    entry,
    `
    import { ensureJavascriptSandbox, resetJavascriptSandbox } from '${source}/javascript-sandbox.ts';
    import { cdpSend } from '${source}/cdp.ts';
    Object.assign(globalThis, { ensureJavascriptSandbox, resetJavascriptSandbox, cdpSend });
    chrome.runtime.onMessage.addListener(() => {});
  `,
  );
  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: {
      alias: {
        '@extension/shared/lib/diagnostics.js': resolve('packages/shared/lib/diagnostics.ts'),
      },
    },
    build: {
      lib: { entry, formats: ['es'], fileName: () => 'background.js' },
      outDir: extension,
      emptyOutDir: false,
      minify: false,
    },
  });
  await copyFile('chrome-extension/public/sandbox.html', join(extension, 'sandbox.html'));
  await writeFile(
    join(extension, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'AskTab sandbox integration test',
      version: '1.0.0',
      permissions: ['offscreen', 'debugger', 'tabs'],
      background: { service_worker: 'background.js', type: 'module' },
    }),
  );

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const result = await worker.evaluate(async () => {
      const runtime = globalThis as SandboxWorker;
      const before = await chrome.tabs.query({});
      const url = chrome.runtime.getURL('sandbox.html');
      await chrome.tabs.create({ url, active: false });
      await chrome.tabs.create({ url, active: false });
      const [first, concurrent] = await Promise.all([
        runtime.ensureJavascriptSandbox(),
        runtime.ensureJavascriptSandbox(),
      ]);
      const dom = await runtime.cdpSend(first, 'Runtime.evaluate', {
        expression:
          'window.__modules = {answer: 42}; new DOMParser().parseFromString("<p>ready</p>", "text/html").body.textContent',
        returnByValue: true,
      });
      runtime.resetJavascriptSandbox();
      const reused = await runtime.ensureJavascriptSandbox();
      const state = await runtime.cdpSend(reused, 'Runtime.evaluate', {
        expression: 'window.__modules.answer',
        returnByValue: true,
      });
      await chrome.offscreen.closeDocument();
      const recreated = await runtime.ensureJavascriptSandbox();
      return {
        before: before.map(tab => ({ id: tab.id, active: tab.active })),
        after: (await chrome.tabs.query({})).map(tab => ({ id: tab.id, active: tab.active })),
        first,
        concurrent,
        reused,
        recreated,
        dom,
        state,
        contexts: await chrome.runtime.getContexts({
          contextTypes: ['OFFSCREEN_DOCUMENT'] as chrome.runtime.ContextType[],
          documentUrls: [url],
        }),
      };
    });
    expect(result.after).toEqual(result.before);
    expect(result.concurrent).toEqual(result.first);
    expect(result.reused).toEqual(result.first);
    expect(result.recreated.targetId).not.toBe(result.first.targetId);
    expect(result.dom).toMatchObject({ result: { value: 'ready' } });
    expect(result.state).toMatchObject({ result: { value: 42 } });
    expect(result.contexts).toHaveLength(1);
  } finally {
    await context.close();
  }
});
