import { chatDb } from './chat-db';
import {
  createChat,
  getChat,
  deleteChat,
  addMessage,
  saveArtifact,
  getMessagesByChatId,
  getArtifactsByChatId,
  clearAllChatHistory,
  updateSessionTokens,
  incrementCompactionCount,
  getMostRecentChat,
  touchChat,
  pruneOldSessions,
  updateMemoryFlush,
  reapCronSessions,
  _resetReaperThrottle,
} from './chat-storage';
import { describe, it, expect, beforeEach } from 'vitest';
import type { DbChat, DbChatMessage, DbArtifact } from './chat-db';

beforeEach(async () => {
  await chatDb.chats.clear();
  await chatDb.messages.clear();
  await chatDb.artifacts.clear();
  _resetReaperThrottle();
});

const makeChat = (overrides: Partial<DbChat> = {}): DbChat => ({
  id: 'chat-1',
  title: 'Test Chat',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  model: 'gpt-4o',
  ...overrides,
});

const makeMessage = (overrides: Partial<DbChatMessage> = {}): DbChatMessage => ({
  id: 'msg-1',
  chatId: 'chat-1',
  role: 'user',
  parts: [{ type: 'text', text: 'hello' }],
  createdAt: Date.now(),
  ...overrides,
});

const makeArtifact = (overrides: Partial<DbArtifact> = {}): DbArtifact => ({
  id: 'art-1',
  chatId: 'chat-1',
  title: 'Test',
  kind: 'text',
  content: 'content',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

describe('Session Token Tracking', () => {
  it('updateSessionTokens increments token counts on existing chat', async () => {
    await createChat(makeChat());
    await updateSessionTokens('chat-1', {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    const chat = await getChat('chat-1');
    expect(chat?.inputTokens).toBe(100);
    expect(chat?.outputTokens).toBe(50);
    expect(chat?.totalTokens).toBe(150);
  });

  it('updateSessionTokens is additive across multiple calls', async () => {
    await createChat(makeChat());
    await updateSessionTokens('chat-1', {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    await updateSessionTokens('chat-1', {
      promptTokens: 200,
      completionTokens: 100,
      totalTokens: 300,
    });
    const chat = await getChat('chat-1');
    expect(chat?.inputTokens).toBe(300);
    expect(chat?.outputTokens).toBe(150);
    expect(chat?.totalTokens).toBe(450);
  });

  it('updateSessionTokens is a no-op for non-existent chat', async () => {
    // Should not throw
    await updateSessionTokens('nonexistent', {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
  });

  it('incrementCompactionCount bumps count by 1', async () => {
    await createChat(makeChat({ compactionCount: 0 }));
    await incrementCompactionCount('chat-1');
    const chat = await getChat('chat-1');
    expect(chat?.compactionCount).toBe(1);
  });

  it('incrementCompactionCount starts from 0 on legacy chats without field', async () => {
    // Create a chat without compactionCount (simulates legacy data)
    await createChat(makeChat());
    await incrementCompactionCount('chat-1');
    const chat = await getChat('chat-1');
    expect(chat?.compactionCount).toBe(1);
  });
});

describe('Session Retrieval', () => {
  it('getMostRecentChat returns the chat with highest updatedAt', async () => {
    await createChat(makeChat({ id: 'c1', updatedAt: 1000 }));
    await createChat(makeChat({ id: 'c2', updatedAt: 3000 }));
    await createChat(makeChat({ id: 'c3', updatedAt: 2000 }));
    const recent = await getMostRecentChat();
    expect(recent?.id).toBe('c2');
  });

  it('getMostRecentChat returns undefined when no chats exist', async () => {
    const recent = await getMostRecentChat();
    expect(recent).toBeUndefined();
  });

  it('touchChat updates updatedAt timestamp', async () => {
    const oldTime = 1000;
    await createChat(makeChat({ updatedAt: oldTime }));
    await touchChat('chat-1');
    const chat = await getChat('chat-1');
    expect(chat!.updatedAt).toBeGreaterThan(oldTime);
  });

  it('touchChat makes a chat the most recent', async () => {
    await createChat(makeChat({ id: 'c1', updatedAt: 3000 }));
    await createChat(makeChat({ id: 'c2', updatedAt: 1000 }));
    await touchChat('c2');
    const recent = await getMostRecentChat();
    expect(recent?.id).toBe('c2');
  });
});

describe('Session Pruning', () => {
  const NINETY_ONE_DAYS_MS = 91 * 24 * 60 * 60 * 1000;

  it('pruneOldSessions deletes sessions older than 90 days', async () => {
    const now = Date.now();
    await createChat(makeChat({ id: 'old', updatedAt: now - NINETY_ONE_DAYS_MS }));
    await createChat(makeChat({ id: 'recent', updatedAt: now }));
    const pruned = await pruneOldSessions();
    expect(pruned).toBe(1);
    expect(await getChat('old')).toBeUndefined();
    expect(await getChat('recent')).toBeDefined();
  });

  it('pruneOldSessions keeps sessions newer than 90 days', async () => {
    const now = Date.now();
    await createChat(makeChat({ id: 'c1', updatedAt: now - 1000 }));
    await createChat(makeChat({ id: 'c2', updatedAt: now }));
    const pruned = await pruneOldSessions();
    expect(pruned).toBe(0);
  });

  it('pruneOldSessions cascades to messages and artifacts', async () => {
    const now = Date.now();
    await createChat(makeChat({ id: 'old', updatedAt: now - NINETY_ONE_DAYS_MS }));
    await addMessage(makeMessage({ chatId: 'old' }));
    await saveArtifact(makeArtifact({ chatId: 'old' }));

    await pruneOldSessions();

    expect(await getMessagesByChatId('old')).toEqual([]);
    expect(await getArtifactsByChatId('old')).toEqual([]);
  });

  it('pruneOldSessions returns count of pruned sessions', async () => {
    const now = Date.now();
    await createChat(makeChat({ id: 'c1', updatedAt: now - NINETY_ONE_DAYS_MS }));
    await createChat(makeChat({ id: 'c2', updatedAt: now - NINETY_ONE_DAYS_MS }));
    await createChat(makeChat({ id: 'c3', updatedAt: now }));
    const pruned = await pruneOldSessions();
    expect(pruned).toBe(2);
  });
});

describe('Session Deletion Cascade', () => {
  it('deleteChat removes session metadata, messages, and artifacts in one transaction', async () => {
    await createChat(makeChat());
    await addMessage(makeMessage());
    await saveArtifact(makeArtifact());

    await deleteChat('chat-1');

    expect(await getChat('chat-1')).toBeUndefined();
    expect(await getMessagesByChatId('chat-1')).toEqual([]);
    expect(await getArtifactsByChatId('chat-1')).toEqual([]);
  });

  it('deleteChat does not affect other sessions', async () => {
    await createChat(makeChat({ id: 'c1' }));
    await createChat(makeChat({ id: 'c2' }));
    await addMessage(makeMessage({ id: 'msg-1', chatId: 'c1' }));
    await addMessage(makeMessage({ id: 'msg-2', chatId: 'c2' }));

    await deleteChat('c1');

    expect(await getChat('c2')).toBeDefined();
    expect(await getMessagesByChatId('c2')).toHaveLength(1);
  });

  it('clearAllChatHistory removes all sessions, messages, and artifacts', async () => {
    await createChat(makeChat({ id: 'c1' }));
    await createChat(makeChat({ id: 'c2' }));
    await addMessage(makeMessage({ id: 'msg-1', chatId: 'c1' }));
    await addMessage(makeMessage({ id: 'msg-2', chatId: 'c2' }));
    await saveArtifact(makeArtifact({ id: 'a1', chatId: 'c1' }));

    await clearAllChatHistory();

    expect(await getChat('c1')).toBeUndefined();
    expect(await getChat('c2')).toBeUndefined();
    expect(await getMessagesByChatId('c1')).toEqual([]);
    expect(await getMessagesByChatId('c2')).toEqual([]);
    expect(await getArtifactsByChatId('c1')).toEqual([]);
  });
});

describe('Memory Flush Tracking', () => {
  it('updateMemoryFlush sets memoryFlushAt and memoryFlushCompactionCount', async () => {
    await createChat(makeChat());
    await updateMemoryFlush('chat-1', 3);
    const chat = await getChat('chat-1');
    expect(chat?.memoryFlushAt).toBeGreaterThan(0);
    expect(chat?.memoryFlushCompactionCount).toBe(3);
  });

  it('updateMemoryFlush overwrites previous values', async () => {
    await createChat(makeChat());
    await updateMemoryFlush('chat-1', 1);
    await updateMemoryFlush('chat-1', 2);
    const chat = await getChat('chat-1');
    expect(chat?.memoryFlushCompactionCount).toBe(2);
  });

  it('memoryFlushAt and memoryFlushCompactionCount are undefined for legacy chats', async () => {
    await createChat(makeChat());
    const chat = await getChat('chat-1');
    expect(chat?.memoryFlushAt).toBeUndefined();
    expect(chat?.memoryFlushCompactionCount).toBeUndefined();
  });
});

describe('Cron Session Reaper', () => {
  const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

  it('deletes cron chats older than retention period', async () => {
    const now = Date.now();
    await createChat(makeChat({ id: 'cron-old', source: 'cron', updatedAt: now - EIGHT_DAYS_MS }));
    await createChat(makeChat({ id: 'cron-new', source: 'cron', updatedAt: now }));

    const reaped = await reapCronSessions();

    expect(reaped).toBe(1);
    expect(await getChat('cron-old')).toBeUndefined();
    expect(await getChat('cron-new')).toBeDefined();
  });

  it('preserves non-cron chats regardless of age', async () => {
    const now = Date.now();
    await createChat(makeChat({ id: 'user-old', updatedAt: now - EIGHT_DAYS_MS }));
    await createChat(makeChat({ id: 'cron-old', source: 'cron', updatedAt: now - EIGHT_DAYS_MS }));

    const reaped = await reapCronSessions();

    expect(reaped).toBe(1);
    expect(await getChat('user-old')).toBeDefined();
    expect(await getChat('cron-old')).toBeUndefined();
  });

  it('supports custom retention period', async () => {
    const now = Date.now();
    const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
    await createChat(
      makeChat({ id: 'cron-3d', source: 'cron', updatedAt: now - 3 * 24 * 60 * 60 * 1000 }),
    );
    await createChat(
      makeChat({ id: 'cron-1d', source: 'cron', updatedAt: now - 1 * 24 * 60 * 60 * 1000 }),
    );

    const reaped = await reapCronSessions(TWO_DAYS_MS);

    expect(reaped).toBe(1);
    expect(await getChat('cron-3d')).toBeUndefined();
    expect(await getChat('cron-1d')).toBeDefined();
  });

  it('cascades deletion to messages and artifacts', async () => {
    const now = Date.now();
    await createChat(makeChat({ id: 'cron-old', source: 'cron', updatedAt: now - EIGHT_DAYS_MS }));
    await addMessage(makeMessage({ id: 'msg-cron', chatId: 'cron-old' }));
    await saveArtifact(makeArtifact({ id: 'art-cron', chatId: 'cron-old' }));

    await reapCronSessions();

    expect(await getMessagesByChatId('cron-old')).toEqual([]);
    expect(await getArtifactsByChatId('cron-old')).toEqual([]);
  });

  it('returns -1 when throttled', async () => {
    const now = Date.now();
    await createChat(makeChat({ id: 'cron-old', source: 'cron', updatedAt: now - EIGHT_DAYS_MS }));

    const first = await reapCronSessions();
    expect(first).toBe(1);

    // Second call should be throttled
    const second = await reapCronSessions();
    expect(second).toBe(-1);
  });

  it('returns 0 when no expired cron chats exist', async () => {
    const now = Date.now();
    await createChat(makeChat({ id: 'cron-new', source: 'cron', updatedAt: now }));

    const reaped = await reapCronSessions();
    expect(reaped).toBe(0);
  });
});
