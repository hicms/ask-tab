import { test, expect } from '../fixtures/extension';
import { openChat } from '../helpers/chat-catalog';
import { catalog } from '../helpers/mock-llm';
import type { Page, Worker } from '@playwright/test';

const savedContent =
  '# 订阅方案\n\n**重点：**保留 Markdown 排版。\n\n| 项目 | 状态 |\n| --- | --- |\n| 套餐 | 已开通 |\n\n文档末尾。';
const fallbackContent = '# 第二份文档\n\n这份内容来自工具参数。';

const seedDocuments = async (worker: Worker) => {
  await worker.evaluate(
    async ({ savedContent, fallbackContent }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('asktab');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const now = Date.now();
      const transaction = db.transaction(['chats', 'messages', 'artifacts'], 'readwrite');
      transaction.objectStore('chats').put({
        id: 'document-preview-chat',
        title: '文档预览回归',
        agentId: 'main',
        createdAt: now,
        updatedAt: now,
      });
      transaction.objectStore('artifacts').put({
        id: 'saved-document',
        chatId: 'document-preview-chat',
        title: 'Agent Plan 页面说明',
        kind: 'text',
        content: savedContent,
        createdAt: now,
        updatedAt: now,
      });
      const documents = [
        { id: 'saved-document', title: 'Agent Plan 页面说明' },
        { id: 'fallback-document', title: '另一份说明', content: fallbackContent },
        { id: 'missing-document', title: '已丢失的文档' },
      ];
      transaction.objectStore('messages').put({
        id: 'document-message',
        chatId: 'document-preview-chat',
        role: 'assistant',
        createdAt: now,
        parts: documents.map(({ id, title, content }) => ({
          type: 'tool-call',
          toolCallId: `tool-${id}`,
          toolName: 'create_document',
          state: 'output-available',
          args: { title, kind: 'text', ...(content ? { content } : {}) },
          result: { id, title, kind: 'text' },
        })),
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      db.close();
    },
    { savedContent, fallbackContent },
  );
};

const selectChat = async (page: Page, pagePath: 'side-panel' | 'full-page-chat') => {
  await expect(page.locator('textarea')).toBeVisible();
  if (pagePath === 'side-panel') {
    await page.getByTitle('Toggle sidebar').click();
    await page.getByRole('button', { name: '文档预览回归', exact: true }).click();
  } else {
    await page.getByRole('button', { name: '会话', exact: true }).click();
    await page
      .getByRole('button')
      .filter({ has: page.getByText('文档预览回归', { exact: true }) })
      .dblclick();
  }
};

for (const pagePath of ['side-panel', 'full-page-chat'] as const) {
  test(`${pagePath} renders saved document previews and opens each document's own content`, async ({
    context,
    extensionId,
  }, testInfo) => {
    const page = await openChat(context, extensionId, pagePath, { cached: catalog });
    await page.setViewportSize({ width: pagePath === 'side-panel' ? 420 : 1280, height: 900 });
    await seedDocuments(context.serviceWorkers()[0]);
    await selectChat(page, pagePath);
    const cards = page.getByTestId('message-assistant').locator('[role="button"]');
    await expect(cards).toHaveCount(3);
    const saved = cards.filter({ hasText: 'Agent Plan 页面说明' });
    await expect(saved.locator('h1')).toHaveText('订阅方案');
    await saved.scrollIntoViewIfNeeded();
    await expect(saved.locator('h1')).toBeInViewport();
    await expect(saved.locator('[data-streamdown="strong"]')).toHaveText('重点：');
    const fallback = cards.filter({ hasText: '另一份说明' });
    await expect(fallback.locator('h1')).toHaveText('第二份文档');
    const missing = cards.filter({ hasText: '已丢失的文档' });
    await expect(missing).toContainText('No document content available.');
    await page.screenshot({ path: testInfo.outputPath('document-previews.png') });

    await saved.click();
    const panel = page.getByTestId('artifact-panel');
    await expect(panel.locator('h1')).toHaveText('订阅方案');
    await expect(panel.locator('h1')).toBeInViewport();
    await expect(panel.locator('[data-streamdown="strong"]')).toHaveText('重点：');
    await expect(panel.locator('table td')).toHaveText(['套餐', '已开通']);
    await expect(panel).toContainText('文档末尾。');
    await expect(panel).toHaveCSS('opacity', '1');
    await page.screenshot({ path: testInfo.outputPath('document-expanded.png') });
    await panel.getByRole('button', { name: 'Raw', exact: true }).click();
    await expect(panel.locator('.cm-content')).toContainText('# 订阅方案');
    await panel.getByRole('button', { name: 'Close document' }).click();

    await fallback.focus();
    await page.keyboard.press('Enter');
    await expect(panel.locator('h1')).toHaveText('第二份文档');
    await expect(panel).not.toContainText('订阅方案');
    await panel.getByRole('button', { name: 'Close document' }).click();
    await expect(missing).toHaveAttribute('aria-disabled', 'true');
    await missing.focus();
    await page.keyboard.press('Enter');
    await expect(panel).toHaveCount(0);
    await expect(missing).not.toContainText('第二份文档');

    await page.reload();
    await selectChat(page, pagePath);
    await expect(saved.locator('h1')).toHaveText('订阅方案');
    await expect(fallback.locator('h1')).toHaveText('第二份文档');
  });
}
