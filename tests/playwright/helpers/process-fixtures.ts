import type { Page, Worker } from '@playwright/test';

const selectProcessChat = async (
  page: Page,
  pagePath: 'side-panel' | 'full-page-chat',
  title: string,
) => {
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

const seedLegacyProcess = async (worker: Worker) => {
  await worker.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('asktab');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction(['chats', 'messages'], 'readwrite');
    transaction.objectStore('chats').put({
      id: 'legacy-process',
      title: '历史过程兼容',
      agentId: 'main',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    transaction.objectStore('messages').put({
      id: 'legacy-assistant',
      chatId: 'legacy-process',
      role: 'assistant',
      createdAt: Date.now(),
      parts: [
        { type: 'reasoning', text: '历史思考' },
        {
          type: 'tool-call',
          toolCallId: 'returned',
          toolName: 'read',
          args: { path: 'old.md' },
          result: null,
        },
        {
          type: 'tool-call',
          toolCallId: 'unknown',
          toolName: 'read',
          args: { path: 'missing.md' },
        },
        {
          type: 'tool-call',
          toolCallId: 'skipped',
          toolName: 'edit',
          args: {},
          state: 'output-error',
          result: 'Skipped due to queued user message.',
        },
        {
          type: 'tool-result',
          toolCallId: 'orphan',
          toolName: 'old_tool',
          state: 'output-error',
          result: '独立错误结果',
        },
        { type: 'text', text: '历史正文保持可见。' },
        {
          type: 'tool-result',
          toolCallId: 'skipped',
          toolName: 'edit',
          state: 'output-error',
          result: 'Skipped due to queued user message.',
        },
        {
          type: 'tool-result',
          toolCallId: 'orphan-skipped',
          toolName: 'read',
          state: 'output-error',
          result: 'Skipped due to queued user message.',
        },
      ],
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
};

const publishSubagentResult = async (worker: Worker, title: string) => {
  await worker.evaluate(async title => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('asktab');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const chats = await new Promise<Array<{ id: string; title: string }>>((resolve, reject) => {
      const request = db.transaction('chats').objectStore('chats').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    const chat = chats.find(chat => chat.title === title);
    if (!chat) throw new Error(`Missing chat ${title}`);
    await chrome.runtime.sendMessage({
      type: 'SUBAGENT_COMPLETE',
      chatId: chat.id,
      runId: 'test-child',
      task: '检查结果',
      findings: '子代理结果卡片。',
    });
  }, title);
};

export { selectProcessChat, seedLegacyProcess, publishSubagentResult };
