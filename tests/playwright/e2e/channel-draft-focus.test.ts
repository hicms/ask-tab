import { test, expect } from '../fixtures/extension';
import { openChat } from '../helpers/chat-catalog';
import type { Worker } from '@playwright/test';

const deliverChannelMessage = async (
  worker: Worker,
  chatId: string,
  role: 'user' | 'assistant',
  text: string,
) => {
  await worker.evaluate(
    async ({ chatId, role, text }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('asktab');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const now = Date.now();
      const transaction = db.transaction(['chats', 'messages'], 'readwrite');
      transaction.objectStore('chats').put({
        id: chatId,
        title: 'Channel conversation',
        agentId: 'main',
        createdAt: now,
        updatedAt: now,
      });
      transaction.objectStore('messages').put({
        id: `channel-${chatId}-${role}`,
        chatId,
        role,
        parts: [{ type: 'text', text }],
        createdAt: now,
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      db.close();
      await chrome.runtime.sendMessage({
        type: role === 'user' ? 'CHANNEL_STREAM_START' : 'CHANNEL_STREAM_END',
        chatId,
        title: 'Channel conversation',
      });
    },
    { chatId, role, text },
  );
};

test('current channel messages refresh without replacing the side-panel draft or its focus', async ({
  context,
  extensionId,
}) => {
  const page = await openChat(context, extensionId, 'side-panel', {
    cached: [{ id: 'custom:test', modelId: 'test', name: 'Test', provider: 'custom' }],
    locale: 'en',
  });
  const input = page.locator('textarea');
  await expect(input).toBeVisible();
  const worker = context.serviceWorkers()[0]!;
  const chatId = await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get('last-active-session-id');
    return stored['last-active-session-id'] as string;
  });
  expect(chatId).toBeTruthy();
  await input.fill('Keep this unfinished draft');
  await input.evaluate(element => element.setSelectionRange(5, 9));
  const originalInput = await input.elementHandle();

  await deliverChannelMessage(worker, chatId, 'user', 'Incoming channel question');
  await expect(page.getByTestId('message-user')).toContainText('Incoming channel question');
  await expect(input).toHaveValue('Keep this unfinished draft');
  await expect(input).toBeFocused();
  expect(await originalInput!.evaluate(element => element.isConnected)).toBe(true);
  expect(await input.evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual([
    5, 9,
  ]);

  await deliverChannelMessage(worker, chatId, 'assistant', 'Incoming channel answer');
  await expect(page.getByTestId('message-assistant')).toContainText('Incoming channel answer');
  await expect(input).toHaveValue('Keep this unfinished draft');
  await expect(input).toBeFocused();
  expect(await originalInput!.evaluate(element => element.isConnected)).toBe(true);

  await page.getByRole('banner').getByRole('button', { name: 'New Session', exact: true }).click();
  await expect(input).toHaveValue('');
  expect(await originalInput!.evaluate(element => element.isConnected)).toBe(false);
  await input.fill('Draft in the new chat');
  await deliverChannelMessage(worker, chatId, 'user', 'Message for the previous chat');
  await expect(page.getByText('New Telegram message', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('Draft in the new chat');
  await expect(input).toBeFocused();
  await expect(page.getByTestId('message-user')).toHaveCount(0);
});
