import {
  setChatArchived,
  listArchivedChats,
  deleteArchivedChats,
} from '../../packages/storage/lib/impl/chat-archive';
import { chatDb } from '../../packages/storage/lib/impl/chat-db';
import {
  getMostRecentChat,
  searchChats,
  pruneOldSessions,
  reapCronSessions,
  _resetReaperThrottle,
  listChats,
  touchChat,
} from '../../packages/storage/lib/impl/chat-storage';
import { beforeEach, expect, it, vi } from 'vitest';

beforeEach(async () => {
  await Promise.all([
    chatDb.chats.clear(),
    chatDb.messages.clear(),
    chatDb.modelTranscripts.clear(),
    chatDb.artifacts.clear(),
  ]);
  _resetReaperThrottle();
});

it('does not search or automatically resume archived chats', async () => {
  await chatDb.chats.bulkPut([
    { id: 'active', title: 'Chat active', createdAt: 1, updatedAt: 1, agentId: 'main' },
    {
      id: 'archived',
      title: 'Chat archived',
      createdAt: 2,
      updatedAt: 2,
      agentId: 'main',
      archivedAt: 3,
    },
  ]);
  expect((await getMostRecentChat())?.id).toBe('active');
  expect((await getMostRecentChat('main'))?.id).toBe('active');
  expect((await searchChats('Chat')).map(chat => chat.id)).toEqual(['active']);
  expect((await searchChats('Chat', 'main')).map(chat => chat.id)).toEqual(['active']);
});

it('preserves archived chats during age and cron cleanup', async () => {
  await chatDb.chats.put({
    id: 'archived',
    title: 'Keep me',
    createdAt: 1,
    updatedAt: 1,
    source: 'cron',
    archivedAt: 2,
  });
  expect(await reapCronSessions()).toBe(0);
  expect(await pruneOldSessions()).toBe(0);
  expect(await chatDb.chats.get('archived')).toBeDefined();
});

it('archives without changing content and restores history as a recent chat', async () => {
  const chat = {
    id: 'chat',
    title: 'Keep everything',
    createdAt: 1,
    updatedAt: 2,
    totalTokens: 42,
  };
  await chatDb.chats.put(chat);
  await chatDb.messages.put({
    id: 'message',
    chatId: 'chat',
    role: 'user',
    parts: [{ type: 'text', text: 'Hello' }],
    createdAt: 1,
  });
  await chatDb.modelTranscripts.put({
    chatId: 'chat',
    schemaVersion: 1,
    status: 'complete',
    sourceKey: 'test',
    messages: ['history'],
  });
  await chatDb.artifacts.put({
    id: 'artifact',
    chatId: 'chat',
    title: 'File',
    kind: 'text',
    content: 'saved',
    createdAt: 1,
    updatedAt: 1,
  });
  await setChatArchived('chat', true);
  expect(await listChats(100, 0, undefined, 'active')).toEqual([]);
  expect(await listChats()).toHaveLength(1);
  expect(await listArchivedChats()).toEqual([{ ...chat, archivedAt: expect.any(Number) }]);
  await setChatArchived('chat', false);
  expect(await listArchivedChats()).toEqual([]);
  expect(await listChats(100, 0, undefined, 'active')).toEqual([
    { ...chat, updatedAt: expect.any(Number) },
  ]);
  expect(await pruneOldSessions()).toBe(0);
  expect(await chatDb.messages.count()).toBe(1);
  expect((await chatDb.modelTranscripts.get('chat'))?.messages).toEqual(['history']);
  expect((await chatDb.artifacts.get('artifact'))?.content).toBe('saved');
  await expect(setChatArchived('missing', false)).rejects.toThrow('Chat not found');
});

it('filters active chats before pagination and keeps agent boundaries', async () => {
  await chatDb.chats.bulkPut([
    { id: 'a', title: 'A', createdAt: 1, updatedAt: 4, agentId: 'a', archivedAt: 5 },
    { id: 'b', title: 'B', createdAt: 1, updatedAt: 3, agentId: 'a' },
    { id: 'c', title: 'C', createdAt: 1, updatedAt: 2, agentId: 'a' },
    { id: 'd', title: 'D', createdAt: 1, updatedAt: 1, agentId: 'b' },
  ]);
  expect((await listChats(1, 1, 'a', 'active')).map(c => c.id)).toEqual(['c']);
  expect((await listChats(1, 1, undefined, 'active')).map(c => c.id)).toEqual(['c']);
  expect((await listChats(10, 0, 'b', 'active')).map(c => c.id)).toEqual(['d']);
  await touchChat('a');
  expect(await listArchivedChats()).toHaveLength(1);
});

it('permanently deletes only still-archived requested chats and their related data', async () => {
  for (const id of ['archived', 'restored', 'other']) {
    await chatDb.chats.put({ id, title: id, createdAt: 1, updatedAt: 1, archivedAt: 2 });
    await chatDb.messages.put({ id, chatId: id, role: 'user', parts: [], createdAt: 1 });
    await chatDb.modelTranscripts.put({
      chatId: id,
      schemaVersion: 1,
      status: 'complete',
      sourceKey: 'test',
      messages: [],
    });
    await chatDb.artifacts.put({
      id,
      chatId: id,
      title: id,
      kind: 'text',
      content: id,
      createdAt: 1,
      updatedAt: 1,
    });
  }
  await setChatArchived('restored', false);
  await deleteArchivedChats(['archived', 'restored', 'missing']);
  expect((await listChats()).map(c => c.id).sort()).toEqual(['other', 'restored']);
  expect(await chatDb.messages.get('archived')).toBeUndefined();
  expect(await chatDb.modelTranscripts.get('archived')).toBeUndefined();
  expect(await chatDb.artifacts.get('archived')).toBeUndefined();
  expect(await chatDb.messages.count()).toBe(2);
});

it('does not count archived chats toward the 500 active-chat limit', async () => {
  const now = Date.now();
  await chatDb.chats.bulkPut(
    Array.from({ length: 502 }, (_, i) => ({
      id: String(i),
      title: String(i),
      createdAt: now,
      updatedAt: now + i,
      ...(i < 2 ? { archivedAt: now } : {}),
    })),
  );
  expect(await pruneOldSessions()).toBe(0);
  expect(await chatDb.chats.count()).toBe(502);
});

it.each([
  [pruneOldSessions, false],
  [reapCronSessions, false],
  [pruneOldSessions, true],
  [reapCronSessions, true],
] as const)(
  'rechecks archive and restore state after cleanup candidates were read (%#)',
  async (cleanup, restore) => {
    await chatDb.chats.put({
      id: 'racing',
      title: 'Keep me',
      createdAt: 1,
      updatedAt: 1,
      source: 'cron',
    });
    await chatDb.messages.put({
      id: 'message',
      chatId: 'racing',
      role: 'user',
      parts: [],
      createdAt: 1,
    });
    await chatDb.modelTranscripts.put({
      chatId: 'racing',
      schemaVersion: 1,
      status: 'complete',
      sourceKey: 'test',
      messages: [],
    });
    await chatDb.artifacts.put({
      id: 'artifact',
      chatId: 'racing',
      title: 'File',
      kind: 'text',
      content: 'keep',
      createdAt: 1,
      updatedAt: 1,
    });
    const collectionPrototype = Object.getPrototypeOf(chatDb.chats.toCollection());
    const original = collectionPrototype.toArray;
    const spy = vi.spyOn(collectionPrototype, 'toArray').mockImplementationOnce(async function (
      this: ReturnType<typeof chatDb.chats.toCollection>,
    ) {
      const candidates = await original.call(this);
      await setChatArchived('racing', true);
      if (restore) await setChatArchived('racing', false);
      return candidates;
    });
    try {
      expect(await cleanup()).toBe(0);
      const kept = await chatDb.chats.get('racing');
      expect(kept).toBeDefined();
      if (restore) expect(kept?.updatedAt).toBeGreaterThan(1);
      else expect(kept?.archivedAt).toEqual(expect.any(Number));
      expect(await chatDb.messages.get('message')).toBeDefined();
      expect(await chatDb.modelTranscripts.get('racing')).toBeDefined();
      expect(await chatDb.artifacts.get('artifact')).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  },
);
