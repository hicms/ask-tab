import { test, expect } from '../fixtures/extension';
import { openChat } from '../helpers/chat-catalog';
import {
  abortedStreams,
  catalog,
  emit,
  installProvider,
  streamBody,
  streamCount,
} from '../helpers/mock-llm';
import type { Page, Worker } from '@playwright/test';

const start = async (page: Page, question: string) => {
  await expect(page.locator('textarea')).toBeVisible();
  await page.locator('textarea').fill(question);
  await page.locator('textarea').press('Enter');
  await expect(page.getByTestId('message-reasoning').last()).toContainText('初始推理。');
};

const enqueue = async (page: Page, text: string, key = 'Enter') => {
  const input = page.locator('textarea');
  await input.fill(text);
  await input.press(key);
  await expect(input).toHaveValue('');
};

const actionButton = (page: Page) => page.locator('form button[type="submit"]');
const tray = (page: Page) => page.getByTestId('queued-messages');
const queued = (page: Page) => page.getByTestId('queued-message');
const queuedTexts = (page: Page) => queued(page).getByTestId('queued-message-text');
const userTexts = (page: Page) =>
  page.locator('[data-testid="message-user"] [data-testid="message-content"]');

const waitForStreams = (worker: Worker, count: number) =>
  expect.poll(() => streamCount(worker)).toBe(count);

/** Opens a chat from the side panel history in a fresh view. */
const reopen = async (page: Page, title: string) => {
  await page.reload();
  await page.getByTitle('Toggle sidebar').click();
  await page.getByRole('button', { name: title, exact: true }).click();
};

for (const pagePath of ['side-panel', 'full-page-chat'] as const) {
  test(`${pagePath} queues messages during a reply and sends them one turn each`, async ({
    context,
    extensionId,
  }) => {
    test.setTimeout(60000);
    const worker = context.serviceWorkers()[0];
    await installProvider(worker);
    const page = await openChat(context, extensionId, pagePath, { cached: catalog });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const input = page.locator('textarea');

    await start(page, '原始问题');
    await expect(actionButton(page)).toHaveAttribute('aria-label', '停止生成');
    await input.fill('排队 1');
    await expect(actionButton(page)).toHaveAttribute('aria-label', '加入队列');
    await input.fill('');
    await expect(actionButton(page)).toHaveAttribute('aria-label', '停止生成');

    await enqueue(page, '排队 1');
    await enqueue(page, '排队 2');
    await enqueue(page, '排队 3');
    await expect(tray(page)).toContainText('待发送 3 条');
    await expect(queuedTexts(page)).toHaveText(['排队 1', '排队 2', '排队 3']);

    await queued(page).nth(1).hover();
    await queued(page).nth(1).getByRole('button', { name: '移除' }).click();
    await expect(queuedTexts(page)).toHaveText(['排队 1', '排队 3']);
    await expect(tray(page)).toContainText('待发送 2 条');
    expect(await streamCount(worker)).toBe(1);

    await emit(worker, 0, '第一条答复。', true);
    await waitForStreams(worker, 2);
    expect(await streamBody(worker, 1)).toContain('排队 1');
    await expect(queuedTexts(page)).toHaveText(['排队 3']);
    await expect(page.getByText('第一条答复。', { exact: true })).toBeVisible();

    await emit(worker, 1, '第二条答复。', true);
    await waitForStreams(worker, 3);
    expect(await streamBody(worker, 2)).toContain('排队 3');
    await expect(tray(page)).toHaveCount(0);

    await emit(worker, 2, '第三条答复。', true);
    await expect(page.getByText('第三条答复。', { exact: true })).toBeVisible();
    await expect(actionButton(page)).toHaveAttribute('aria-label', '发送');
    await expect(userTexts(page)).toHaveText(['原始问题', '排队 1', '排队 3']);
    expect(await streamCount(worker)).toBe(3);
    expect(errors).toEqual([]);
  });
}

test('steering joins the running reply instead of waiting for its own turn', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(60000);
  const worker = context.serviceWorkers()[0];
  await installProvider(worker);
  const page = await openChat(context, extensionId, 'side-panel', { cached: catalog });

  await start(page, '原始问题');
  await enqueue(page, '改用中文回答', 'Control+Enter');
  await expect(queued(page)).toContainText('等待当前步骤完成后插入');

  await emit(worker, 0, '第一段答复。', true);
  await waitForStreams(worker, 2);
  expect(await streamBody(worker, 1)).toContain('改用中文回答');
  await expect(tray(page)).toHaveCount(0);
  await emit(worker, 1, '第二段答复。', true);
  await expect(page.getByText('第二段答复。', { exact: true })).toBeVisible();

  const order = async () =>
    page
      .locator('[data-testid="message-user"], [data-testid="message-assistant"]')
      .evaluateAll(nodes => nodes.map(n => `${n.getAttribute('data-role')}:${n.textContent}`));
  const expected = [
    expect.stringMatching(/^user:原始问题/),
    expect.stringMatching(/^assistant:.*第一段答复。/),
    expect.stringMatching(/^user:改用中文回答/),
    expect.stringMatching(/^assistant:.*第二段答复。/),
  ];
  expect(await order()).toEqual(expected);

  await reopen(page, '原始问题');
  await expect(page.getByText('第二段答复。', { exact: true })).toBeVisible();
  expect(await order()).toEqual(expected);
});

test('stopping pauses the queue until the user resumes it', async ({ context, extensionId }) => {
  test.setTimeout(60000);
  const worker = context.serviceWorkers()[0];
  await installProvider(worker);
  const page = await openChat(context, extensionId, 'side-panel', { cached: catalog });

  await start(page, '原始问题');
  await enqueue(page, '排队 A');
  await queued(page).first().hover();
  await queued(page).first().getByRole('button', { name: '立即引导' }).click();
  await expect(queued(page)).toContainText('等待当前步骤完成后插入');

  await page.locator('textarea').press('Escape');
  await expect.poll(() => abortedStreams(worker)).toEqual([true]);
  await expect(page.getByTestId('queued-messages-paused')).toContainText('已停止生成，队列已暂停');
  // The unsent steering message goes back to the queue as a normal item.
  await expect(queuedTexts(page)).toHaveText(['排队 A']);
  await page.waitForTimeout(500);
  expect(await streamCount(worker)).toBe(1);
  await expect(actionButton(page)).toHaveAttribute('aria-label', '发送');

  await page.getByRole('button', { name: '继续发送' }).click();
  await waitForStreams(worker, 2);
  expect(await streamBody(worker, 1)).toContain('排队 A');
  await expect(tray(page)).toHaveCount(0);
  await emit(worker, 1, '恢复后的答复。', true);
  await expect(page.getByText('恢复后的答复。', { exact: true })).toBeVisible();
});

test('the composer guards clearing, commands and the queue limit', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(90000);
  const worker = context.serviceWorkers()[0];
  await installProvider(worker);
  const page = await openChat(context, extensionId, 'side-panel', { cached: catalog });
  const input = page.locator('textarea');

  await start(page, '原始问题');
  await input.fill('/clear');
  await input.press('Enter');
  await expect(page.getByText('推理中无法执行命令')).toBeVisible();
  await expect(input).toHaveValue('/clear');
  await expect(tray(page)).toHaveCount(0);

  await input.fill('菜单加入');
  await page.getByRole('button', { name: '更多发送选项' }).click();
  await page.getByRole('menuitem', { name: /加入队列/ }).click();
  await expect(input).toHaveValue('');
  await enqueue(page, '第二条');
  await expect(queuedTexts(page)).toHaveText(['菜单加入', '第二条']);

  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(tray(page)).toHaveCount(0);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(queuedTexts(page)).toHaveText(['菜单加入', '第二条']);

  for (let i = 3; i <= 20; i++) await enqueue(page, `第 ${i} 条`);
  await expect(tray(page)).toContainText('待发送 20 条');
  await input.fill('第 21 条');
  await input.press('Enter');
  await expect(page.getByText('队列已满（最多 20 条）')).toBeVisible();
  await expect(input).toHaveValue('第 21 条');
  await expect(queued(page)).toHaveCount(20);

  await input.fill('');
  await actionButton(page).click();
  await expect.poll(() => abortedStreams(worker)).toEqual([true]);
  await expect(page.getByTestId('queued-messages-paused')).toBeVisible();
});

test('the background keeps sending queued messages after the view closes', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(60000);
  const worker = context.serviceWorkers()[0];
  await installProvider(worker);
  const page = await openChat(context, extensionId, 'side-panel', { cached: catalog });

  await start(page, '原始问题');
  await enqueue(page, '后台排队');
  await page.close();

  await emit(worker, 0, '第一条答复。', true);
  await waitForStreams(worker, 2);
  expect(await streamBody(worker, 1)).toContain('后台排队');
  await emit(worker, 1, '后台答复。', true);

  const view = await openChat(context, extensionId, 'side-panel', { cached: catalog });
  await view.getByTitle('Toggle sidebar').click();
  await view.getByRole('button', { name: '原始问题', exact: true }).click();
  await expect(view.getByText('后台答复。', { exact: true })).toBeVisible();
  await expect(userTexts(view)).toHaveText(['原始问题', '后台排队']);
  await expect(tray(view)).toHaveCount(0);
});
