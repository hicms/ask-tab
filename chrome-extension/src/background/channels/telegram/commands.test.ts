import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock chrome.storage.local
beforeAll(() => {
  Object.defineProperty(globalThis, 'chrome', {
    value: {
      storage: {
        local: {
          get: vi.fn(() => Promise.resolve({})),
          set: vi.fn(() => Promise.resolve()),
        },
      },
      runtime: { getURL: vi.fn((p: string) => `chrome-ext://id/${p}`) },
    },
    writable: true,
  });
});

// Mock logger
vi.mock('../../logging/logger-buffer', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock storage
vi.mock('@extension/storage', () => ({
  findChatByChannelChatId: vi.fn(() => Promise.resolve(null)),
  deleteChat: vi.fn(() => Promise.resolve()),
  getMessagesByChatId: vi.fn(() => Promise.resolve([])),
  serverModelsStorage: { get: vi.fn(() => Promise.resolve([])) },
  selectedModelStorage: { get: vi.fn(() => Promise.resolve(null)) },
}));

// Mock config
vi.mock('../config', () => ({
  getChannelConfig: vi.fn(() => Promise.resolve(null)),
}));

// Mock agent handler (commands.ts imports resolveModel from it)
vi.mock('../agent-handler', () => ({
  resolveModel: vi.fn(() => Promise.resolve(null)),
}));

const originalFetch = globalThis.fetch;

describe('telegram commands', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let isBotCommand: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handleBotCommand: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let registerBotCommands: any;

  beforeEach(async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: { message_id: 1 } }),
    });

    vi.clearAllMocks();
    const mod = await import('./commands');
    isBotCommand = mod.isBotCommand;
    handleBotCommand = mod.handleBotCommand;
    registerBotCommands = mod.registerBotCommands;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('isBotCommand', () => {
    it('returns true for /start', () => {
      expect(isBotCommand('/start')).toBe(true);
    });

    it('returns true for /help', () => {
      expect(isBotCommand('/help')).toBe(true);
    });

    it('returns false for regular text', () => {
      expect(isBotCommand('hello')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isBotCommand('')).toBe(false);
    });

    it('returns false for / alone', () => {
      expect(isBotCommand('/')).toBe(false);
    });

    it('returns false for /123 (non-alpha)', () => {
      expect(isBotCommand('/123')).toBe(false);
    });

    it('returns true for /start@botname', () => {
      expect(isBotCommand('/start@mybot')).toBe(true);
    });
  });

  describe('handleBotCommand', () => {
    const makeMsg = (body: string) => ({
      channelMessageId: '1',
      channelChatId: '123',
      senderId: '456',
      senderName: 'Alice',
      body,
      timestamp: Date.now(),
      chatType: 'direct' as const,
    });

    it('handles /start', async () => {
      const result = await handleBotCommand(makeMsg('/start'), 'tok');
      expect(result).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    it('handles /help', async () => {
      const result = await handleBotCommand(makeMsg('/help'), 'tok');
      expect(result).toBe(true);
    });

    it('handles /reset', async () => {
      const result = await handleBotCommand(makeMsg('/reset'), 'tok');
      expect(result).toBe(true);
    });

    it('handles /status', async () => {
      const result = await handleBotCommand(makeMsg('/status'), 'tok');
      expect(result).toBe(true);
    });

    it('returns false for unknown command', async () => {
      const result = await handleBotCommand(makeMsg('/unknown'), 'tok');
      expect(result).toBe(false);
    });

    it('strips @botname suffix from command', async () => {
      const result = await handleBotCommand(makeMsg('/start@mybot'), 'tok');
      expect(result).toBe(true);
    });
  });

  describe('registerBotCommands', () => {
    it('calls setMyCommands API', async () => {
      await registerBotCommands('tok');
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const setCommandsCall = calls.find(
        c => typeof c[0] === 'string' && c[0].includes('setMyCommands'),
      );
      expect(setCommandsCall).toBeDefined();
    });
  });
});
