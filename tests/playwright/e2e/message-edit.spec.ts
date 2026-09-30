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
import type { Page } from '@playwright/test';

const send = async (page: Page, text: string) => {
  const previousReasoningCount = await page.getByTestId('message-reasoning').count();
  await page.locator('textarea').fill(text);
  await page.locator('textarea').press('Enter');
  await expect(page.getByTestId('message-reasoning')).toHaveCount(previousReasoningCount + 1);
  await expect(page.getByTestId('message-reasoning').last()).toContainText('初始推理。');
};

const edit = async (page: Page, text: string) => {
  const message = page.getByTestId('message-user').first();
  await message.hover();
  await message.getByTestId('message-edit-button').click();
  await page.getByTestId('message-editor').locator('textarea').fill(text);
  await page.getByTestId('message-editor-send-button').click();
};

const reopen = async (page: Page, title: string, pagePath = 'side-panel') => {
  await page.reload();
  if (pagePath === 'side-panel') {
    await page.getByTitle('Toggle sidebar').click();
    await page.getByRole('button', { name: title, exact: true }).click();
  } else {
    await page.getByRole('button', { name: '会话', exact: true }).click();
    await page
      .getByRole('button')
      .filter({ has: page.getByText(title, { exact: true }) })
      .dblclick();
  }
};

for (const pagePath of ['side-panel', 'full-page-chat'] as const) {
  test(`${pagePath} replaces a stopped message once in UI, storage and the model request`, async ({
    context,
    extensionId,
  }) => {
    test.setTimeout(60000);
    const worker = context.serviceWorkers()[0];
    await installProvider(worker);
    const page = await openChat(context, extensionId, pagePath, { cached: catalog });
    const original = '你帮我探索下这是一个什么模型？？';
    const replacement = '你帮我探索下这是一个什么页面？？';
    await send(page, original);
    await page.locator('form button[type="submit"]').click();
    await expect.poll(() => abortedStreams(worker)).toEqual([true]);
    await edit(page, replacement);

    await expect.poll(() => streamCount(worker)).toBe(2);
    await expect(page.getByTestId('message-user')).toHaveCount(1);
    await expect(page.getByTestId('message-user')).toContainText(replacement);
    const body = await streamBody(worker, 1);
    expect(body).not.toContain(original);
    expect(body.split(replacement)).toHaveLength(2);
    await emit(worker, 1, '编辑后的答复。', true);
    await expect(page.getByText('编辑后的答复。', { exact: true })).toBeVisible();

    await reopen(page, original, pagePath);
    await expect(page.getByTestId('message-user')).toHaveCount(1);
    await expect(page.getByTestId('message-user')).toContainText(replacement);
    await expect(page.getByTestId('message-assistant')).toHaveCount(1);
    await expect(page.getByText('编辑后的答复。', { exact: true })).toBeVisible();
  });
}

test('editing an earlier completed message discards the later branch and its model history', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(60000);
  const worker = context.serviceWorkers()[0];
  await installProvider(worker);
  const page = await openChat(context, extensionId, 'side-panel', { cached: catalog });
  await send(page, '原始问题');
  await emit(worker, 0, '旧的第一段答复。', true);
  await expect(page.getByText('旧的第一段答复。', { exact: true })).toBeVisible();
  await send(page, '后续问题');
  await emit(worker, 1, '旧的后续答复。', true);
  await expect(page.getByText('旧的后续答复。', { exact: true })).toBeVisible();

  await edit(page, '替换后的问题');
  await expect.poll(() => streamCount(worker)).toBe(3);
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  const body = await streamBody(worker, 2);
  for (const text of ['原始问题', '旧的第一段答复。', '后续问题', '旧的后续答复。'])
    expect(body).not.toContain(text);
  expect(body.split('替换后的问题')).toHaveLength(2);
  await emit(worker, 2, '新答复。', true);
  await expect(page.getByText('新答复。', { exact: true })).toBeVisible();
  await reopen(page, '原始问题');
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  await expect(page.getByTestId('message-user')).toContainText('替换后的问题');
  await expect(page.getByTestId('message-assistant')).toHaveCount(1);
});
