import { test, expect } from '../fixtures/extension';
import path from 'path';
import type { Locator, Page, Worker } from '@playwright/test';

const seedChats = async (worker: Worker, extraArchived = 0) => {
  await worker.evaluate(async extraArchived => {
    await chrome.storage.local.set({
      settings: { theme: 'light', locale: 'zh_CN' },
      'server-models': [{ id: 'custom:test', modelId: 'test', name: 'Test', provider: 'custom' }],
      'selected-model-id': 'custom:test',
      'last-active-session-id': 'active',
    });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('asktab');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const now = Date.now();
    const transaction = db.transaction(['chats', 'messages', 'agents'], 'readwrite');
    transaction.objectStore('agents').put({
      id: 'design',
      name: '设计助手',
      isDefault: false,
      identity: {},
      createdAt: now,
      updatedAt: now,
    });
    const chats = [
      { id: 'active', title: '待归档的会话', agentId: 'main' },
      { id: 'keep', title: '继续保留的会话', agentId: 'main' },
      {
        id: 'old-a',
        title: '美化问候语和下方卡片',
        agentId: 'main',
        archivedAt: now,
        source: 'web',
      },
      {
        id: 'old-b',
        title: '设计页面布局',
        agentId: 'design',
        archivedAt: now - 1,
        source: 'telegram',
      },
      { id: 'old-c', title: '整理会议纪要', archivedAt: now - 2, source: 'cron' },
    ];
    for (let index = 0; index < extraArchived; index++) {
      chats.push({
        id: 'extra-' + index,
        title: '归档长标题会话' + index + '：适配浏览器宽度时标题应截断并保留操作按钮',
        agentId: 'main',
        archivedAt: now - index - 10,
        source: 'web',
      });
    }
    for (const chat of chats) {
      transaction.objectStore('chats').put({ ...chat, createdAt: now, updatedAt: now });
      transaction.objectStore('messages').put({
        id: `message-${chat.id}`,
        chatId: chat.id,
        role: 'user',
        parts: [{ type: 'text', text: `保留的消息 ${chat.id}` }],
        createdAt: now,
      });
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, extraArchived);
};

const screenshot = async (page: Page, name: string) => {
  if (!process.env.ARCHIVE_QA_DIR) return;
  await page.screenshot({
    path: path.join(process.env.ARCHIVE_QA_DIR, name),
    animations: 'disabled',
  });
};

const expectTopCenterToast = async (page: Page) => {
  const notice = page.getByRole('status');
  await expect(notice).toBeVisible();
  await expect
    .poll(async () => {
      const box = await notice.boundingBox();
      if (!box) return false;
      return (
        box.y >= 0 &&
        box.y < 80 &&
        Math.abs(box.x + box.width / 2 - page.viewportSize()!.width / 2) < 2
      );
    })
    .toBe(true);
};

const expectWithinViewport = async (page: Page, dialog: Locator) => {
  await expect
    .poll(async () => {
      const box = await dialog.boundingBox();
      const viewport = page.viewportSize()!;
      return (
        !!box &&
        box.x >= 10 &&
        box.y >= 10 &&
        box.x + box.width <= viewport.width - 10 &&
        box.y + box.height <= viewport.height - 10
      );
    })
    .toBe(true);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
};

const openArchiveDialog = async (page: Page, label: string) => {
  const pageCount = page.context().pages().length;
  await page.getByRole('button', { name: label, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '已归档的聊天' });
  await expect(dialog).toBeVisible();
  await expectWithinViewport(page, dialog);
  expect(page.context().pages()).toHaveLength(pageCount);
  return dialog;
};

test('top-center archive toast opens the archive dialog with the complete lifecycle', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
  });
  await page.setViewportSize({ width: 1120, height: 900 });
  await page.goto('chrome-extension://' + extensionId + '/options/index.html');
  await seedChats(context.serviceWorkers()[0]);
  await page.reload();
  await page.getByRole('button', { name: '会话', exact: true }).click();
  const archive = () =>
    page.getByRole('button', { name: '归档：待归档的会话', exact: true }).click();
  await archive();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expectTopCenterToast(page);
  await screenshot(page, 'archive-toast-top-center.png');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByRole('button', { name: '归档：待归档的会话', exact: true })).toBeVisible();
  await archive();
  const dialog = await openArchiveDialog(page, '查看');
  const rows = dialog.getByTestId('archived-chat-row');
  await expect(rows).toHaveCount(4);
  await screenshot(page, 'archive-dialog-desktop.png');
  await dialog.getByRole('searchbox').fill('页面');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('设计页面布局');
  await dialog.getByRole('searchbox').fill('');
  await dialog.getByRole('combobox', { name: '按聊天来源筛选' }).click();
  await page.getByRole('option', { name: 'telegram', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await dialog.getByRole('combobox', { name: '按聊天来源筛选' }).click();
  await page.getByRole('option', { name: '全部聊天', exact: true }).click();
  await dialog.getByRole('combobox', { name: '按智能体筛选' }).click();
  await page.getByRole('option', { name: '设计助手', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await dialog.getByRole('combobox', { name: '按智能体筛选' }).click();
  await page.getByRole('option', { name: '所有智能体', exact: true }).click();
  await rows
    .filter({ hasText: '待归档的会话' })
    .getByRole('button', { name: '取消归档', exact: true })
    .click();
  await expect(rows).toHaveCount(3);
  await dialog.getByRole('button', { name: '永久删除：美化问候语和下方卡片', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: '归档：待归档的会话', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '会话', exact: true }).click();
  await openArchiveDialog(page, '已归档的聊天');
  await expect(rows).toHaveCount(2);
  await dialog.getByRole('button', { name: '全部删除', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await dialog.getByRole('button', { name: '全部删除', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click();
  await expect(dialog.getByText('暂无已归档的聊天')).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('archive dialog adapts to narrow and short windows and scrolls long lists internally', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(60000);
  const page = await context.newPage();
  await page.goto('chrome-extension://' + extensionId + '/options/index.html');
  await seedChats(context.serviceWorkers()[0], 30);
  await page.reload();
  await page.getByRole('button', { name: '会话', exact: true }).click();
  const dialog = await openArchiveDialog(page, '已归档的聊天');
  const scroller = dialog.getByTestId('archived-chat-scroll');
  for (const viewport of [
    { width: 1120, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 740, height: 320 },
  ]) {
    await page.setViewportSize(viewport);
    await expectWithinViewport(page, dialog);
    expect(await scroller.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
    await expect(dialog.getByRole('searchbox')).toBeInViewport();
    await expect(dialog.getByRole('button', { name: '全部删除', exact: true })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
    await dialog.getByTestId('archived-chat-row').last().scrollIntoViewIfNeeded();
    await expect(
      dialog
        .getByTestId('archived-chat-row')
        .last()
        .getByRole('button', { name: '取消归档', exact: true }),
    ).toBeInViewport();
    await screenshot(page, 'archive-dialog-' + viewport.width + 'x' + viewport.height + '.png');
    await dialog.getByRole('button', { name: '全部删除', exact: true }).click();
    await expectWithinViewport(page, page.getByRole('alertdialog'));
    await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  }
  await dialog
    .getByTestId('archived-chat-row')
    .last()
    .getByRole('button', { name: '取消归档', exact: true })
    .click();
  await expect(dialog.getByTestId('archived-chat-row')).toHaveCount(32);
});

test('side panel keeps the toast top-center and restores archived chats in its dialog', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto('chrome-extension://' + extensionId + '/options/index.html');
  await seedChats(context.serviceWorkers()[0]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('chrome-extension://' + extensionId + '/side-panel/index.html');
  await expect(page.getByText('保留的消息 active', { exact: true })).toBeVisible();
  await page.getByTitle('Toggle sidebar', { exact: true }).click();
  await page.getByRole('button', { name: '会话操作：待归档的会话', exact: true }).click();
  await page.getByRole('menuitem', { name: '归档', exact: true }).click();
  await expectTopCenterToast(page);
  await screenshot(page, 'archive-toast-side-panel.png');
  const dialog = await openArchiveDialog(page, '查看');
  await dialog
    .getByTestId('archived-chat-row')
    .filter({ hasText: '待归档的会话' })
    .getByRole('button', { name: '取消归档', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: '待归档的会话', exact: true }).click();
  await expect(page.getByText('保留的消息 active', { exact: true })).toBeVisible();
});

test('full-page chat restores a conversation from the archive dialog', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto('chrome-extension://' + extensionId + '/options/index.html');
  await seedChats(context.serviceWorkers()[0]);
  await page.goto('chrome-extension://' + extensionId + '/full-page-chat/index.html');
  await page.getByRole('button', { name: '会话', exact: true }).click();
  await page.getByRole('button', { name: '归档：待归档的会话', exact: true }).click();
  await expectTopCenterToast(page);
  const dialog = await openArchiveDialog(page, '查看');
  await dialog
    .getByTestId('archived-chat-row')
    .filter({ hasText: '待归档的会话' })
    .getByRole('button', { name: '取消归档', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /^待归档的会话 main/ }).dblclick();
  await expect(page.getByText('保留的消息 active', { exact: true })).toBeVisible();
});
