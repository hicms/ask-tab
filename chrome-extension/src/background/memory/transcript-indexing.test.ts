import { invalidateMemoryIndex } from './memory-sync';
import {
  indexSessionTranscript,
  transcriptFileId,
  transcriptFilePath,
} from './transcript-indexing';
import { getChat, getMessagesByChatId } from '@extension/storage';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──
const mockChunks: Array<{ chatId?: string }> = [];

vi.mock('@extension/storage', () => ({
  getChat: vi.fn(async () => null),
  getMessagesByChatId: vi.fn(async () => []),
  deleteMemoryChunksByChatId: vi.fn(async (chatId: string) => {
    // Remove chunks with matching chatId
    const toRemove = mockChunks.filter(c => c.chatId === chatId);
    for (const c of toRemove) mockChunks.splice(mockChunks.indexOf(c), 1);
  }),
  bulkPutMemoryChunks: vi.fn(async (chunks: Array<{ chatId?: string }>) => {
    mockChunks.push(...chunks);
  }),
}));

vi.mock('./memory-sync', () => ({
  invalidateMemoryIndex: vi.fn(),
}));

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({ trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'test-id-' + Math.random().toString(36).slice(2, 8)),
}));

const makeMessage = (role: 'user' | 'assistant', text: string) => ({
  id: 'msg-' + Math.random().toString(36).slice(2, 8),
  chatId: 'chat-1',
  role,
  parts: [{ type: 'text' as const, text }],
  createdAt: Date.now(),
});

describe('indexSessionTranscript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChunks.length = 0;
  });

  it('returns 0 for nonexistent chat', async () => {
    vi.mocked(getChat).mockResolvedValue(undefined);
    const result = await indexSessionTranscript('nonexistent');
    expect(result.chunksCreated).toBe(0);
  });

  it('skips chats with fewer than 4 messages', async () => {
    vi.mocked(getChat).mockResolvedValue({
      id: 'chat-1',
      title: 'Test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    vi.mocked(getMessagesByChatId).mockResolvedValue([
      makeMessage('user', 'hello'),
      makeMessage('assistant', 'hi'),
    ]);

    const result = await indexSessionTranscript('chat-1');
    expect(result.chunksCreated).toBe(0);
  });

  it('creates chunks for chat with enough messages', async () => {
    vi.mocked(getChat).mockResolvedValue({
      id: 'chat-1',
      title: 'Test Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    vi.mocked(getMessagesByChatId).mockResolvedValue([
      makeMessage('user', 'What is TypeScript?'),
      makeMessage('assistant', 'TypeScript is a typed superset of JavaScript.'),
      makeMessage('user', 'How do I use it?'),
      makeMessage('assistant', 'Install it with npm and configure tsconfig.json.'),
    ]);

    const result = await indexSessionTranscript('chat-1');
    expect(result.chunksCreated).toBeGreaterThan(0);
    expect(mockChunks.length).toBeGreaterThan(0);
    expect(mockChunks[0]!.chatId).toBe('chat-1');
  });

  it('is idempotent — deletes existing chunks before re-indexing', async () => {
    vi.mocked(getChat).mockResolvedValue({
      id: 'chat-1',
      title: 'Test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const messages = [
      makeMessage('user', 'hello'),
      makeMessage('assistant', 'world'),
      makeMessage('user', 'test'),
      makeMessage('assistant', 'response'),
    ];
    vi.mocked(getMessagesByChatId).mockResolvedValue(messages);

    // Index twice
    await indexSessionTranscript('chat-1');
    const firstCount = mockChunks.length;
    await indexSessionTranscript('chat-1');

    // Should have same count (old deleted, new created)
    expect(mockChunks.length).toBe(firstCount);
  });

  it('invalidates memory index after indexing', async () => {
    vi.mocked(getChat).mockResolvedValue({
      id: 'chat-1',
      title: 'Test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    vi.mocked(getMessagesByChatId).mockResolvedValue([
      makeMessage('user', 'a'),
      makeMessage('assistant', 'b'),
      makeMessage('user', 'c'),
      makeMessage('assistant', 'd'),
    ]);

    await indexSessionTranscript('chat-1', 'agent-1');
    expect(invalidateMemoryIndex).toHaveBeenCalledWith('agent-1');
  });

  it('sets correct filePath with transcript/ prefix', async () => {
    vi.mocked(getChat).mockResolvedValue({
      id: 'chat-1',
      title: 'Test Chat Title',
      createdAt: new Date('2025-06-15').getTime(),
      updatedAt: Date.now(),
    });
    vi.mocked(getMessagesByChatId).mockResolvedValue([
      makeMessage('user', 'a'),
      makeMessage('assistant', 'b'),
      makeMessage('user', 'c'),
      makeMessage('assistant', 'd'),
    ]);

    await indexSessionTranscript('chat-1');
    const chunk = mockChunks[0] as Record<string, unknown>;
    expect((chunk.filePath as string).startsWith('transcript/2025-06-15/')).toBe(true);
  });
});

describe('transcriptFileId', () => {
  it('returns transcript:{chatId} format', () => {
    expect(transcriptFileId('abc-123')).toBe('transcript:abc-123');
  });
});

describe('transcriptFilePath', () => {
  it('generates path with date and sanitized title', () => {
    const path = transcriptFilePath('chat-1', 'My Chat Title!', '2025-06-15');
    expect(path).toBe('transcript/2025-06-15/chat-1-my-chat-title.md');
  });

  it('handles empty title', () => {
    const path = transcriptFilePath('chat-1', '', '2025-06-15');
    expect(path).toBe('transcript/2025-06-15/chat-1-untitled.md');
  });
});
