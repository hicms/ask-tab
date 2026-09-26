import { uploadTranscript } from './memory-service';
import { indexSessionTranscript, transcriptFilePath } from './transcript-indexing';
import { getChat, getMessagesByChatId } from '@extension/storage';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@extension/storage', () => ({
  getChat: vi.fn(async () => undefined),
  getMessagesByChatId: vi.fn(async () => []),
}));

vi.mock('./memory-service', () => ({
  DEFAULT_AGENT_ID: 'main',
  uploadTranscript: vi.fn(async () => {}),
}));

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({ trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const makeMessage = (role: 'user' | 'assistant', text: string) => ({
  id: 'msg-' + Math.random().toString(36).slice(2, 8),
  chatId: 'chat-1',
  role,
  parts: [{ type: 'text' as const, text }],
  createdAt: Date.now(),
});

const fourMessages = () => [
  makeMessage('user', 'What is TypeScript?'),
  makeMessage('assistant', 'TypeScript is a typed superset of JavaScript.'),
  makeMessage('user', 'How do I use it?'),
  makeMessage('assistant', 'Install it with npm and configure tsconfig.json.'),
];

describe('indexSessionTranscript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips a nonexistent chat', async () => {
    const result = await indexSessionTranscript('nonexistent');
    expect(result.indexed).toBe(false);
    expect(uploadTranscript).not.toHaveBeenCalled();
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
    expect(result.indexed).toBe(false);
    expect(uploadTranscript).not.toHaveBeenCalled();
  });

  it('uploads the serialized transcript under the chat agent with its chat id', async () => {
    vi.mocked(getChat).mockResolvedValue({
      id: 'chat-1',
      title: 'Test Chat Title',
      createdAt: new Date('2025-06-15').getTime(),
      updatedAt: Date.now(),
      agentId: 'agent-1',
    });
    vi.mocked(getMessagesByChatId).mockResolvedValue(fourMessages());

    const result = await indexSessionTranscript('chat-1');

    expect(result.indexed).toBe(true);
    expect(uploadTranscript).toHaveBeenCalledTimes(1);
    const [agentKey, transcript] = vi.mocked(uploadTranscript).mock.calls[0]!;
    expect(agentKey).toBe('agent-1');
    expect(transcript.chatId).toBe('chat-1');
    expect(transcript.path).toBe('transcript/2025-06-15/chat-1-test-chat-title.md');
    expect(transcript.content).toContain('TypeScript is a typed superset of JavaScript.');
  });

  it('uploads chats without an agent under the default agent', async () => {
    vi.mocked(getChat).mockResolvedValue({
      id: 'chat-1',
      title: 'Test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    vi.mocked(getMessagesByChatId).mockResolvedValue(fourMessages());

    await indexSessionTranscript('chat-1');

    expect(vi.mocked(uploadTranscript).mock.calls[0]?.[0]).toBe('main');
  });

  it('propagates upload failures', async () => {
    vi.mocked(getChat).mockResolvedValue({
      id: 'chat-1',
      title: 'Test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    vi.mocked(getMessagesByChatId).mockResolvedValue(fourMessages());
    vi.mocked(uploadTranscript).mockRejectedValueOnce(new Error('Session expired'));

    await expect(indexSessionTranscript('chat-1')).rejects.toThrow('Session expired');
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
