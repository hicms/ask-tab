import { createChatQueue } from './chat-queue';
import {
  broadcastToChat,
  handleLLMStream,
  isLLMStreamRunning,
  stopLLMStream,
} from './stream-handler';
import { MAX_QUEUED_MESSAGES } from '@extension/shared';
import { addMessage, getChat, getMessagesByChatId } from '@extension/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatModel, LLMQueueSnapshot, QueuedChatMessage } from '@extension/shared';

vi.mock('./stream-handler', () => ({
  broadcastToChat: vi.fn(),
  handleLLMStream: vi.fn(async () => {}),
  isLLMStreamRunning: vi.fn(() => false),
  stopLLMStream: vi.fn(() => false),
}));

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('@extension/storage', () => ({
  addMessage: vi.fn(async () => {}),
  touchChat: vi.fn(async () => {}),
  getChat: vi.fn(async () => ({ id: 'chat-1' })),
  getMessagesByChatId: vi.fn(async () => []),
}));

const model: ChatModel = { id: 'gpt-4o', name: 'GPT-4o', provider: 'custom' };

const item = (id: string, mode: QueuedChatMessage['mode'] = 'queue'): QueuedChatMessage => ({
  id,
  text: `text ${id}`,
  mode,
  model,
  createdAt: 1,
});

const createStorage = (initial: Record<string, unknown> = {}) => {
  let stored = initial;
  return {
    get: vi.fn(async () => stored),
    set: vi.fn(async (value: Record<string, unknown>) => {
      stored = { ...stored, ...value };
    }),
    read: () => stored,
  };
};

const setup = (initial?: Record<string, unknown>) => {
  const storage = createStorage(initial);
  const keepAlive = { acquire: vi.fn(), release: vi.fn() };
  const queue = createChatQueue({ storage: storage as never, keepAlive });
  return { queue, storage, keepAlive };
};

const lastSnapshot = (): LLMQueueSnapshot =>
  vi.mocked(broadcastToChat).mock.calls.at(-1)![1] as unknown as LLMQueueSnapshot;

const snapshotIds = () => lastSnapshot().items.map(i => `${i.id}:${i.mode}`);

const startedTurns = () => vi.mocked(handleLLMStream).mock.calls.map(([, request]) => request);

const running = (value: boolean) => vi.mocked(isLLMStreamRunning).mockReturnValue(value);

const add = (queue: ReturnType<typeof setup>['queue'], queued: QueuedChatMessage) =>
  queue.handleCommand({ type: 'LLM_QUEUE_ADD', chatId: 'chat-1', item: queued });

/** Settlement dispatches asynchronously after the restored state is ready. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('chat queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    running(true);
    vi.mocked(stopLLMStream).mockReturnValue(false);
    vi.mocked(getChat).mockResolvedValue({ id: 'chat-1' } as never);
    vi.mocked(getMessagesByChatId).mockResolvedValue([]);
  });

  it('queues messages in order while a turn runs and mirrors them to storage', async () => {
    const { queue, storage } = setup();
    await add(queue, item('a'));
    await add(queue, item('b'));

    expect(snapshotIds()).toEqual(['a:queue', 'b:queue']);
    expect(lastSnapshot()).not.toHaveProperty('pauseReason');
    await flush();
    expect(storage.read().chatQueues).toEqual({ 'chat-1': { items: [item('a'), item('b')] } });
    expect(handleLLMStream).not.toHaveBeenCalled();
  });

  it('rejects blank, duplicate and over-limit messages and resends the current queue', async () => {
    const { queue } = setup();
    for (let i = 0; i < MAX_QUEUED_MESSAGES; i++) await add(queue, item(`m${i}`));
    await add(queue, item('overflow'));
    await add(queue, item('m0'));
    await add(queue, { ...item('blank'), text: '   ' });

    expect(lastSnapshot().items).toHaveLength(MAX_QUEUED_MESSAGES);
    expect(lastSnapshot().items.map(i => i.id)).not.toContain('overflow');
  });

  it('starts the next turn in order after each completed turn', async () => {
    const { queue, keepAlive } = setup();
    vi.mocked(getMessagesByChatId).mockResolvedValue([
      { id: 'old', chatId: 'chat-1', role: 'assistant', parts: [], createdAt: 5_000 },
    ]);
    await add(queue, item('a'));
    await add(queue, item('b'));
    running(false);

    queue.onSettled({ chatId: 'chat-1', outcome: 'completed', unsentSteering: [] });
    await vi.waitFor(() => expect(handleLLMStream).toHaveBeenCalledTimes(1));

    const [request] = startedTurns();
    expect(vi.mocked(handleLLMStream).mock.calls[0]![0]).toBeUndefined();
    expect(request).toMatchObject({ type: 'LLM_REQUEST', chatId: 'chat-1', model });
    expect(request!.messages.map(m => m.id)).toEqual(['old', 'a']);
    expect(request!.messages[1]).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: 'text a' }],
    });
    expect(request!.messages[1]!.createdAt).toBeGreaterThan(5_000);
    expect(keepAlive.acquire).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(addMessage).toHaveBeenCalledWith(request!.messages[1]));
    expect(snapshotIds()).toEqual(['b:queue']);

    queue.onSettled({ chatId: 'chat-1', outcome: 'completed', unsentSteering: [] });
    await vi.waitFor(() => expect(handleLLMStream).toHaveBeenCalledTimes(2));
    expect(startedTurns()[1]!.messages.at(-1)!.id).toBe('b');
    expect(lastSnapshot().items).toEqual([]);
  });

  it.each([
    ['stopped', 'stopped'],
    ['error', 'error'],
  ] as const)('pauses after a %s turn until resumed', async (outcome, reason) => {
    const { queue } = setup();
    await add(queue, item('a'));
    running(false);

    queue.onSettled({ chatId: 'chat-1', outcome, unsentSteering: [] });
    await flush();
    expect(lastSnapshot().pauseReason).toBe(reason);
    expect(handleLLMStream).not.toHaveBeenCalled();

    await queue.handleCommand({ type: 'LLM_QUEUE_RESUME', chatId: 'chat-1' });
    expect(startedTurns()[0]!.messages.at(-1)!.id).toBe('a');
  });

  it('keeps a paused queue paused when a completed turn was sent directly', async () => {
    const { queue } = setup();
    await add(queue, item('a'));
    running(false);
    queue.onSettled({ chatId: 'chat-1', outcome: 'stopped', unsentSteering: [] });
    await flush();

    queue.onSettled({ chatId: 'chat-1', outcome: 'completed', unsentSteering: [] });
    await flush();
    expect(lastSnapshot().pauseReason).toBe('stopped');
    expect(handleLLMStream).not.toHaveBeenCalled();
  });

  it('sends a message immediately when the chat is idle and the queue is not paused', async () => {
    const { queue } = setup();
    running(false);
    await add(queue, item('late', 'steer'));

    expect(startedTurns()[0]!.messages.at(-1)!.id).toBe('late');
    expect(lastSnapshot().items).toEqual([]);
  });

  it('only queues a message added while idle and paused', async () => {
    const { queue } = setup();
    await add(queue, item('a'));
    running(false);
    queue.onSettled({ chatId: 'chat-1', outcome: 'error', unsentSteering: [] });
    await flush();

    await add(queue, item('b'));
    expect(snapshotIds()).toEqual(['a:queue', 'b:queue']);
    expect(handleLLMStream).not.toHaveBeenCalled();
  });

  it('hands out one steering message per checkpoint and leaves queued messages alone', async () => {
    const { queue } = setup();
    await add(queue, item('q1'));
    await add(queue, item('s1', 'steer'));
    await add(queue, item('s2', 'steer'));

    expect(queue.takeSteering('chat-1').map(i => i.id)).toEqual(['s1']);
    expect(snapshotIds()).toEqual(['q1:queue', 's2:steer']);
    expect(queue.takeSteering('chat-1').map(i => i.id)).toEqual(['s2']);
    expect(queue.takeSteering('chat-1')).toEqual([]);
    expect(queue.takeSteering('other-chat')).toEqual([]);
  });

  it('sends steering that missed its turn next, ahead of queued messages', async () => {
    const { queue } = setup();
    await add(queue, item('q1'));
    await add(queue, item('s2', 'steer'));
    running(false);

    queue.onSettled({
      chatId: 'chat-1',
      outcome: 'completed',
      unsentSteering: [item('s1', 'steer')],
    });
    await vi.waitFor(() => expect(handleLLMStream).toHaveBeenCalledOnce());

    expect(startedTurns()[0]!.messages.at(-1)!.id).toBe('s1');
    expect(snapshotIds()).toEqual(['s2:queue', 'q1:queue']);
  });

  it('returns unsent steering to the head of a stopped queue', async () => {
    const { queue } = setup();
    await add(queue, item('q1'));
    running(false);

    queue.onSettled({
      chatId: 'chat-1',
      outcome: 'stopped',
      unsentSteering: [item('s1', 'steer')],
    });
    await flush();

    expect(snapshotIds()).toEqual(['s1:queue', 'q1:queue']);
    expect(lastSnapshot().pauseReason).toBe('stopped');
    expect(handleLLMStream).not.toHaveBeenCalled();
  });

  it('leaves steering for a newer turn alone when an older stopped turn settles', async () => {
    const { queue } = setup();
    await add(queue, item('new-steer', 'steer'));

    queue.onSettled({
      chatId: 'chat-1',
      outcome: 'stopped',
      unsentSteering: [item('old', 'steer')],
    });
    await flush();

    expect(snapshotIds()).toEqual(['old:queue', 'new-steer:steer']);
  });

  it('removes, clears and restores messages', async () => {
    const { queue } = setup();
    await add(queue, item('a'));
    await add(queue, item('b'));
    await queue.handleCommand({ type: 'LLM_QUEUE_REMOVE', chatId: 'chat-1', itemId: 'a' });
    expect(snapshotIds()).toEqual(['b:queue']);

    await queue.handleCommand({ type: 'LLM_QUEUE_CLEAR', chatId: 'chat-1' });
    expect(lastSnapshot().items).toEqual([]);
    await add(queue, item('c'));

    await queue.handleCommand({
      type: 'LLM_QUEUE_RESTORE',
      chatId: 'chat-1',
      items: [item('b'), item('c')],
    });
    expect(snapshotIds()).toEqual(['b:queue', 'c:queue']);
  });

  it('keeps the pause when a cleared paused queue is restored', async () => {
    const { queue } = setup();
    running(false);
    await queue.handleCommand({
      type: 'LLM_QUEUE_RESTORE',
      chatId: 'chat-1',
      items: [item('a', 'steer')],
      pauseReason: 'stopped',
    });

    expect(snapshotIds()).toEqual(['a:queue']);
    expect(lastSnapshot().pauseReason).toBe('stopped');
    expect(handleLLMStream).not.toHaveBeenCalled();
  });

  it('turns a queued message into steering while a turn runs', async () => {
    const { queue } = setup();
    await add(queue, item('a'));
    await add(queue, item('b'));
    await queue.handleCommand({ type: 'LLM_QUEUE_STEER', chatId: 'chat-1', itemId: 'b' });

    expect(snapshotIds()).toEqual(['a:queue', 'b:steer']);
    expect(queue.takeSteering('chat-1').map(i => i.id)).toEqual(['b']);
  });

  it('sends a message steered while idle next, resuming a paused queue', async () => {
    const { queue } = setup();
    await add(queue, item('a'));
    await add(queue, item('b'));
    running(false);
    queue.onSettled({ chatId: 'chat-1', outcome: 'stopped', unsentSteering: [] });
    await flush();

    await queue.handleCommand({ type: 'LLM_QUEUE_STEER', chatId: 'chat-1', itemId: 'b' });

    expect(startedTurns()[0]!.messages.at(-1)!.id).toBe('b');
    expect(snapshotIds()).toEqual(['a:queue']);
    expect(lastSnapshot()).not.toHaveProperty('pauseReason');
  });

  it('restores a queue after a worker restart as paused queued messages', async () => {
    const { queue } = setup({
      chatQueues: {
        'chat-1': { items: [item('a', 'steer'), item('b')] },
        'chat-2': { items: [item('c')], pauseReason: 'error' },
      },
    });
    const port = { postMessage: vi.fn() };
    await queue.sendSnapshot(port, 'chat-1');
    await queue.sendSnapshot(port, 'chat-2');

    expect(port.postMessage.mock.calls[0]![0]).toEqual({
      type: 'LLM_QUEUE_SNAPSHOT',
      chatId: 'chat-1',
      items: [item('a'), item('b')],
      pauseReason: 'restarted',
    });
    expect(port.postMessage.mock.calls[1]![0]).toMatchObject({ pauseReason: 'error' });
    expect(handleLLMStream).not.toHaveBeenCalled();
  });

  it('drops the queue of a deleted chat instead of sending it', async () => {
    const { queue } = setup();
    await add(queue, item('a'));
    running(false);
    vi.mocked(getChat).mockResolvedValue(undefined);

    queue.onSettled({ chatId: 'chat-1', outcome: 'completed', unsentSteering: [] });
    await vi.waitFor(() => expect(lastSnapshot().items).toEqual([]));
    expect(handleLLMStream).not.toHaveBeenCalled();
  });

  it('keeps the message queued when another turn starts while history loads', async () => {
    const { queue } = setup();
    await add(queue, item('a'));
    running(false);
    vi.mocked(getMessagesByChatId).mockImplementationOnce(async () => {
      running(true);
      return [];
    });

    await queue.handleCommand({ type: 'LLM_QUEUE_RESUME', chatId: 'chat-1' });

    expect(handleLLMStream).not.toHaveBeenCalled();
    expect(snapshotIds()).toEqual(['a:queue']);
  });

  it('pauses a queue that is between turns when Stop arrives', async () => {
    const { queue } = setup();
    await add(queue, item('a'));
    running(false);

    await queue.stop('chat-1', 'segment');
    expect(stopLLMStream).toHaveBeenCalledWith('chat-1', 'segment');
    expect(lastSnapshot().pauseReason).toBe('stopped');
  });

  it('leaves the queue alone when Stop reaches a running turn', async () => {
    const { queue } = setup();
    await add(queue, item('a'));
    vi.mocked(stopLLMStream).mockReturnValue(true);
    vi.mocked(broadcastToChat).mockClear();

    await queue.stop('chat-1');
    expect(broadcastToChat).not.toHaveBeenCalled();
  });

  it('ignores a settled turn for a chat without a queue', async () => {
    const { queue } = setup();
    queue.onSettled({ chatId: 'chat-1', outcome: 'completed', unsentSteering: [] });
    await flush();
    expect(broadcastToChat).not.toHaveBeenCalled();
  });
});
