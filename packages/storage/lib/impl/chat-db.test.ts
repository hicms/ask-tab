import 'fake-indexeddb/auto';
import { chatDb } from './chat-db';
import { describe, expect, it } from 'vitest';

describe('fresh chat database', () => {
  it('creates the current schema and seeds the main agent', async () => {
    await chatDb.open();
    expect(chatDb.verno).toBe(1);
    expect(chatDb.tables.map(table => table.name)).toEqual(
      expect.arrayContaining([
        'agents',
        'chats',
        'messages',
        'modelTranscripts',
        'memoryChunks',
        'embeddingCache',
        'heartbeatState',
        'heartbeatLocks',
      ]),
    );
    expect(await chatDb.agents.get('main')).toMatchObject({
      id: 'main',
      isDefault: true,
      name: 'Main Agent',
    });
    chatDb.close();
  });
});
