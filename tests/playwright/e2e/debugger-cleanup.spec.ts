import { expect, test } from '../fixtures/extension';
import { openChat } from '../helpers/chat-catalog';
import { catalog, emit, emitToolCalls, installProvider, streamCount } from '../helpers/mock-llm';
import type { Worker } from '@playwright/test';

const PAGE_URL = 'https://asktab-debugger.test/';

// Probe this extension's own connections; getTargets().attached can also reflect
// Playwright's connection to a page.
const connections = (worker: Worker, targets: chrome.debugger.Debuggee[]) =>
  worker.evaluate(
    targets =>
      Promise.all(
        targets.map(target =>
          chrome.debugger.sendCommand(target, 'Runtime.evaluate', { expression: '1' }).then(
            () => true,
            () => false,
          ),
        ),
      ),
    targets,
  );

for (const outcome of ['complete', 'cancel'] as const) {
  test(`releases tab and sandbox debugger connections when a task is ${outcome}`, async ({
    context,
    extensionId,
  }) => {
    const worker = context.serviceWorkers()[0];
    await installProvider(worker, { supportsTools: true });
    await context.route(`${PAGE_URL}**`, route =>
      route.fulfill({ contentType: 'text/html', body: '<title>Debugger cleanup</title>' }),
    );
    const page = await openChat(context, extensionId, 'side-panel', {
      cached: catalog.map(model => ({ ...model, supportsTools: true })),
    });
    await page.locator('textarea').fill('检查任务完成后的浏览器连接');
    await page.locator('textarea').press('Enter');
    await expect.poll(() => streamCount(worker)).toBe(1);
    await emitToolCalls(worker, 0, [
      { id: 'open-page', name: 'browser', args: { action: 'open', url: PAGE_URL } },
      {
        id: 'sandbox-script',
        name: 'execute_javascript',
        args: { action: 'execute', code: 'return 42' },
      },
    ]);
    await expect.poll(() => streamCount(worker)).toBe(2);
    const targets = await worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({ url: `${url}*` }))[0];
      const sandbox = (await chrome.debugger.getTargets()).find(
        target => target.url === chrome.runtime.getURL('sandbox.html') && target.tabId == null,
      );
      if (tab?.id == null || !sandbox) throw new Error('Expected both tools to create targets');
      return [{ tabId: tab.id }, { targetId: sandbox.id }];
    }, PAGE_URL);
    expect(await connections(worker, targets)).toEqual([true, true]);

    if (outcome === 'complete') {
      await emit(worker, 1, '任务已完成。', true);
      await expect(page.getByText('任务已完成。', { exact: true })).toBeVisible();
    } else {
      await page.getByRole('button', { name: '停止生成', exact: true }).click();
    }
    await expect.poll(() => connections(worker, targets)).toEqual([false, false]);
    expect(
      await worker.evaluate(async tabId => (await chrome.tabs.get(tabId)).url, targets[0].tabId!),
    ).toBe(PAGE_URL);
  });
}
