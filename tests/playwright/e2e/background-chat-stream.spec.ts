import { test, expect } from '../fixtures/extension';
import { openChat } from '../helpers/chat-catalog';
import path from 'path';
import type { Page, Worker } from '@playwright/test';

type TestStream = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  aborted: boolean;
  closed: boolean;
};
type StreamWorker = typeof globalThis & { testStreams: TestStream[] };

const catalog = [
  {
    id: 'custom:background-test',
    modelId: 'background-test',
    name: 'Background Test',
    provider: 'custom',
    supportsTools: false,
    supportsReasoning: true,
  },
];

/** Only the provider transport is mocked; ports, worker, React and IndexedDB are real. */
const installProvider = async (worker: Worker) => {
  await worker.evaluate(async () => {
    const target = globalThis as StreamWorker;
    target.testStreams = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/api/models'))
        return Response.json([
          {
            id: 'background-test',
            name: 'Background Test',
            protocol: 'openai-completions',
            kind: 'chat',
            isDefault: true,
            supportsTools: false,
            supportsReasoning: true,
            supportsImages: false,
            contextWindow: null,
            embeddingSpaceId: null,
            vendor: null,
            tier: null,
            priceMultiplier: null,
          },
        ]);
      if (!url.includes('/api/llm/background-test')) return Response.json([]);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const stream: TestStream = { controller, aborted: false, closed: false };
          target.testStreams.push(stream);
          init?.signal?.addEventListener(
            'abort',
            () => {
              stream.aborted = true;
              if (!stream.closed) controller.error(new DOMException('Aborted', 'AbortError'));
            },
            { once: true },
          );
          const event = {
            id: 'response',
            object: 'chat.completion.chunk',
            model: 'background-test',
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', reasoning_content: '初始推理。' },
                finish_reason: null,
              },
            ],
          };
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    };
    await chrome.storage.local.set({
      'server-models': [],
      'ask-session': {
        token: 'local-test-only',
        userId: 'test',
        email: 'test@example.invalid',
        expiresAt: Date.now() + 3600000,
      },
    });
  });
};

const emit = async (worker: Worker, index: number, text: string, finish = false) => {
  await worker.evaluate(
    ({ index, text, finish }) => {
      const stream = (globalThis as StreamWorker).testStreams[index];
      const chunk = {
        id: 'response',
        object: 'chat.completion.chunk',
        model: 'background-test',
        choices: [
          {
            index: 0,
            delta: finish ? { content: text } : { reasoning_content: text },
            finish_reason: finish ? 'stop' : null,
          },
        ],
        ...(finish ? { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } : {}),
      };
      stream.controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
      if (finish) {
        stream.controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        stream.closed = true;
        stream.controller.close();
      }
    },
    { index, text, finish },
  );
};

const send = async (page: Page, question: string) => {
  await expect(page.locator('textarea'))
    .toBeVisible()
    .catch(async error => {
      throw new Error(`${error}\nPage: ${await page.locator('body').innerText()}`);
    });
  await page.locator('textarea').fill(question);
  await page.locator('textarea').press('Enter');
  await expect(page.getByTestId('message-reasoning').last()).toContainText('初始推理。');
};

for (const pagePath of ['side-panel', 'full-page-chat'] as const) {
  test(`${pagePath} sends a shortcut card after the composer has been focused`, async ({
    context,
    extensionId,
  }) => {
    const worker = context.serviceWorkers()[0];
    await installProvider(worker);
    const page = await openChat(context, extensionId, pagePath, { cached: catalog });
    const input = page.locator('textarea');
    await input.click();
    const card = page.getByTestId('suggested-actions').getByRole('button').first();
    await card.click();
    await expect(page.getByTestId('message-user')).toContainText('帮我总结浏览器当前标签页的内容');
    await expect(page.getByTestId('message-reasoning')).toContainText('初始推理。');
    expect(await worker.evaluate(() => (globalThis as StreamWorker).testStreams.length)).toBe(1);
    await emit(worker, 0, '快捷操作已执行。', true);
    await expect(page.getByText('快捷操作已执行。', { exact: true })).toBeVisible();
  });

  test(`${pagePath} does not drop a shortcut clicked while the initial subscription is pending`, async ({
    context,
    extensionId,
  }) => {
    const worker = context.serviceWorkers()[0];
    await installProvider(worker);
    await context.addInitScript(() => {
      const connect = chrome.runtime.connect.bind(chrome.runtime);
      chrome.runtime.connect = (...args: Parameters<typeof chrome.runtime.connect>) => {
        const port = connect(...args);
        if (port.name !== 'llm-stream') return port;
        const post = port.postMessage.bind(port);
        port.postMessage = message => {
          if (message.type === 'LLM_STREAM_SUBSCRIBE') {
            Object.assign(window, { releaseSubscription: () => post(message) });
          } else post(message);
        };
        return port;
      };
    });
    const page = await openChat(context, extensionId, pagePath, { cached: catalog });
    await page.locator('textarea').click();
    await page.getByTestId('suggested-actions').getByRole('button').first().click();
    await expect(page.locator('textarea')).toHaveValue('帮我总结浏览器当前标签页的内容');
    expect(await worker.evaluate(() => (globalThis as StreamWorker).testStreams.length)).toBe(0);
    await page.evaluate(() =>
      (window as unknown as { releaseSubscription: () => void }).releaseSubscription(),
    );
    await expect(page.getByTestId('message-user')).toContainText('帮我总结浏览器当前标签页的内容');
    await expect(page.getByTestId('message-reasoning')).toContainText('初始推理。');
    expect(await worker.evaluate(() => (globalThis as StreamWorker).testStreams.length)).toBe(1);
    await emit(worker, 0, '快捷操作已执行。', true);
  });

  test(`${pagePath} keeps concurrent turns running and restores them from history`, async ({
    context,
    extensionId,
  }) => {
    test.setTimeout(60000);
    const worker = context.serviceWorkers()[0];
    await installProvider(worker);
    const page = await openChat(context, extensionId, pagePath, { cached: catalog });
    await page.setViewportSize({ width: pagePath === 'side-panel' ? 440 : 1200, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const history = async () => {
      if (pagePath === 'side-panel') await page.getByTitle('Toggle sidebar').click();
      else await page.getByRole('button', { name: '会话', exact: true }).click();
    };
    const row = (title: string) =>
      pagePath === 'side-panel'
        ? page.getByRole('button', { name: title, exact: true }).locator('..')
        : page.getByRole('button').filter({ has: page.getByText(title, { exact: true }) });
    const select = async (title: string) => {
      if (pagePath === 'side-panel')
        await page.getByRole('button', { name: title, exact: true }).click();
      else await row(title).dblclick();
    };

    await send(page, '并行会话 A');
    await page.getByRole('banner').getByRole('button', { name: '新会话', exact: true }).click();
    await send(page, '并行会话 B');
    await history();
    await expect(row('并行会话 A')).toBeInViewport({ ratio: 1 });
    await expect(row('并行会话 A').getByRole('status')).toHaveText('推理中');
    await expect(row('并行会话 B').getByRole('status')).toHaveText('推理中');
    if (process.env.STREAM_QA_DIR)
      await page.screenshot({
        animations: 'disabled',
        path: path.join(process.env.STREAM_QA_DIR, `${pagePath}-running.png`),
      });
    expect(
      await worker.evaluate(() => (globalThis as StreamWorker).testStreams.map(s => s.aborted)),
    ).toEqual([false, false]);

    await emit(worker, 0, '离开后仍在继续推理。');
    await select('并行会话 A');
    await expect(page.getByTestId('message-reasoning')).toContainText(
      '初始推理。离开后仍在继续推理。',
    );
    await emit(worker, 0, '切回后实时追加。');
    await expect(page.getByTestId('message-reasoning')).toContainText('切回后实时追加。');
    if (process.env.STREAM_QA_DIR)
      await page.screenshot({
        animations: 'disabled',
        path: path.join(process.env.STREAM_QA_DIR, `${pagePath}-resumed.png`),
      });
    await page.locator('button[type="submit"]').click();
    await expect
      .poll(() =>
        worker.evaluate(() => (globalThis as StreamWorker).testStreams.map(s => s.aborted)),
      )
      .toEqual([true, false]);
    await history();
    await expect(row('并行会话 A').getByRole('status')).toHaveCount(0);
    await expect(row('并行会话 B').getByRole('status')).toHaveText('推理中');

    await emit(worker, 1, 'B 在后台完成的答复。', true);
    await expect(row('并行会话 B').getByRole('status')).toHaveCount(0);
    await select('并行会话 B');
    await expect(page.getByText('B 在后台完成的答复。', { exact: true })).toBeVisible();
    await send(page, '继续 B');
    await emit(worker, 2, '继续对话成功。', true);
    await expect(page.getByText('继续对话成功。', { exact: true })).toBeVisible();
    expect(await worker.evaluate(() => (globalThis as StreamWorker).testStreams.length)).toBe(3);
    expect(errors).toEqual([]);
  });
}
