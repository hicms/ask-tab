import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock chrome.storage.local
const mockStorage: Record<string, unknown> = {};

beforeAll(() => {
  const makeStorageArea = () => ({
    get: vi.fn((keys: string | string[]) => {
      const result: Record<string, unknown> = {};
      const keyList = typeof keys === 'string' ? [keys] : keys;
      for (const k of keyList) {
        if (k in mockStorage) result[k] = mockStorage[k];
      }
      return Promise.resolve(result);
    }),
    set: vi.fn((items: Record<string, unknown>) => {
      Object.assign(mockStorage, items);
      return Promise.resolve();
    }),
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  });

  Object.defineProperty(globalThis, 'chrome', {
    value: {
      storage: {
        local: makeStorageArea(),
        session: makeStorageArea(),
      },
      runtime: { getURL: vi.fn((p: string) => `chrome-ext://id/${p}`) },
      notifications: { create: vi.fn() },
    },
    writable: true,
  });
});

// Mock the agent handler so we don't need full LLM stack
vi.mock('./agent-handler', () => ({
  handleChannelMessage: vi.fn(() => Promise.resolve()),
}));

// Mock the command handler
vi.mock('./telegram/commands', () => ({
  isBotCommand: vi.fn((body: string) => body.startsWith('/') && /^\/[a-z]+/.test(body)),
  handleBotCommand: vi.fn(() => Promise.resolve(true)),
}));

// Mock the logger
vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the registry
const mockAdapter = {
  id: 'telegram',
  label: 'Telegram',
  maxMessageLength: 4096,
  validateAuth: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue({ ok: true }),
  formatSenderDisplay: (msg: { senderName?: string }) => msg.senderName ?? 'User',
};

vi.mock('./registry', () => ({
  getChannelAdapter: vi.fn(() => Promise.resolve(mockAdapter)),
}));

describe('handleChannelUpdates', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handleChannelUpdates: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handleChannelMessage: any;

  beforeEach(async () => {
    // Set up a valid config
    for (const key of Object.keys(mockStorage)) delete mockStorage[key];
    mockStorage.channelConfigs = [
      {
        channelId: 'telegram',
        enabled: true,
        allowedSenderIds: ['456'],
        status: 'passive',
        credentials: { botToken: '123:abc' },
      },
    ];

    vi.clearAllMocks();

    const bridgeMod = await import('./message-bridge');
    handleChannelUpdates = bridgeMod.handleChannelUpdates;

    const agentMod = await import('./agent-handler');
    handleChannelMessage = agentMod.handleChannelMessage;
  });

  it('dispatches allowed DM to agent handler', async () => {
    const updates = [
      {
        update_id: 1,
        message: {
          message_id: 42,
          chat: { id: 123, type: 'private' },
          from: { id: 456, is_bot: false, first_name: 'Alice' },
          text: 'hello',
          date: 1700000000,
        },
      },
    ];

    await handleChannelUpdates('telegram', updates);

    // Wait for the async dispatch
    await new Promise(r => setTimeout(r, 50));

    expect(handleChannelMessage).toHaveBeenCalled();
  });

  it('rejects messages from non-allowed senders', async () => {
    const updates = [
      {
        update_id: 2,
        message: {
          message_id: 43,
          chat: { id: 999, type: 'private' },
          from: { id: 999, is_bot: false, first_name: 'Hacker' },
          text: 'should be blocked',
          date: 1700000000,
        },
      },
    ];

    await handleChannelUpdates('telegram', updates);
    await new Promise(r => setTimeout(r, 50));

    expect(handleChannelMessage).not.toHaveBeenCalled();
  });

  it('rejects group messages (Phase 1: DM only)', async () => {
    const updates = [
      {
        update_id: 3,
        message: {
          message_id: 44,
          chat: { id: -100123, type: 'supergroup', title: 'Group' },
          from: { id: 456, is_bot: false, first_name: 'Alice' },
          text: 'group msg',
          date: 1700000000,
        },
      },
    ];

    await handleChannelUpdates('telegram', updates);
    await new Promise(r => setTimeout(r, 50));

    expect(handleChannelMessage).not.toHaveBeenCalled();
  });

  it('returns max update_id for offset tracking', async () => {
    const updates = [
      {
        update_id: 10,
        message: {
          message_id: 50,
          chat: { id: 123, type: 'private' },
          from: { id: 456, is_bot: false, first_name: 'Alice' },
          text: 'msg1',
          date: 1700000000,
        },
      },
      {
        update_id: 15,
        message: {
          message_id: 51,
          chat: { id: 123, type: 'private' },
          from: { id: 456, is_bot: false, first_name: 'Alice' },
          text: 'msg2',
          date: 1700000001,
        },
      },
    ];

    const maxId = await handleChannelUpdates('telegram', updates);
    expect(maxId).toBe(15);
  });

  it('handles bot command failure gracefully (logs error, continues)', async () => {
    const { handleBotCommand } = await import('./telegram/commands');
    vi.mocked(handleBotCommand).mockRejectedValueOnce(new Error('Command handler crashed'));

    const updates = [
      {
        update_id: 20,
        message: {
          message_id: 60,
          chat: { id: 123, type: 'private' },
          from: { id: 456, is_bot: false, first_name: 'Alice' },
          text: '/start',
          date: 1700000000,
        },
      },
    ];

    // Should not throw
    await handleChannelUpdates('telegram', updates);

    // The agent handler should NOT have been called (command error → continue)
    expect(handleChannelMessage).not.toHaveBeenCalled();
  });

  it('handles agent handler failure gracefully (logs error, continues)', async () => {
    vi.mocked(handleChannelMessage).mockRejectedValueOnce(new Error('Agent handler crashed'));

    const updates = [
      {
        update_id: 21,
        message: {
          message_id: 61,
          chat: { id: 123, type: 'private' },
          from: { id: 456, is_bot: false, first_name: 'Alice' },
          text: 'normal message',
          date: 1700000000,
        },
      },
    ];

    // Should not throw despite handler failure
    await handleChannelUpdates('telegram', updates);
  });

  it('returns undefined for unknown channel (no adapter)', async () => {
    const { getChannelAdapter } = await import('./registry');
    vi.mocked(getChannelAdapter).mockResolvedValueOnce(null as never);

    const result = await handleChannelUpdates('unknown-channel', [
      { update_id: 1, message: { message_id: 1 } },
    ]);

    expect(result).toBeUndefined();
  });

  it('returns undefined when channel is disabled', async () => {
    // Override config to be disabled
    mockStorage.channelConfigs = [
      {
        channelId: 'telegram',
        enabled: false,
        allowedSenderIds: ['456'],
        status: 'passive',
        credentials: { botToken: '123:abc' },
      },
    ];

    const result = await handleChannelUpdates('telegram', [
      {
        update_id: 1,
        message: {
          message_id: 1,
          chat: { id: 123, type: 'private' },
          from: { id: 456, is_bot: false, first_name: 'Alice' },
          text: 'hello',
          date: 1700000000,
        },
      },
    ]);

    expect(result).toBeUndefined();
    expect(handleChannelMessage).not.toHaveBeenCalled();
  });
});
