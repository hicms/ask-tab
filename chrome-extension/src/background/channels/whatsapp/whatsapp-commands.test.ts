import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelAdapter, ChannelInboundMessage } from '../types';

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
vi.mock('../../ask-service/endpoint', () => ({
  getServiceUrl: () => 'http://ask.test',
  serviceUrlReady: async () => {},
}));
vi.mock('@extension/storage', () => ({
  findChatByChannelChatId: vi.fn(() => Promise.resolve(null)),
  deleteChat: vi.fn(() => Promise.resolve()),
  getMessagesByChatId: vi.fn(() => Promise.resolve([])),
  serverModelsStorage: { get: vi.fn(() => Promise.resolve([])) },
  selectedModelStorage: { get: vi.fn(() => Promise.resolve(null)) },
  authTokenStorage: { get: vi.fn(() => Promise.resolve({ accessToken: '' })) },
  logConfigStorage: { get: vi.fn(() => Promise.resolve({ level: 'info' })) },
}));

// Mock config
vi.mock('../config', () => ({
  getChannelConfig: vi.fn(() => Promise.resolve(null)),
}));

// Mock agent handler (commands.ts imports resolveModel from it)
vi.mock('../agent-handler', () => ({
  resolveModel: vi.fn(() => Promise.resolve(null)),
}));

describe('whatsapp commands', () => {
  let isWhatsAppCommand: (body: string) => boolean;
  let handleWhatsAppCommand: (
    msg: ChannelInboundMessage,
    adapter: ChannelAdapter,
  ) => Promise<boolean>;

  const mockAdapter: ChannelAdapter = {
    id: 'whatsapp',
    label: 'WhatsApp',
    maxMessageLength: 4096,
    sendMessage: vi.fn().mockResolvedValue({ ok: true }),
    downloadMedia: vi.fn(),
    formatSenderDisplay: vi.fn().mockReturnValue('Alice'),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    (mockAdapter.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const mod = await import('./commands');
    isWhatsAppCommand = mod.isWhatsAppCommand;
    handleWhatsAppCommand = mod.handleWhatsAppCommand;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const makeMsg = (body: string): ChannelInboundMessage => ({
    channelMessageId: '1',
    channelChatId: '1234567890@s.whatsapp.net',
    senderId: '1234567890@s.whatsapp.net',
    senderName: 'Alice',
    body,
    timestamp: Date.now(),
    chatType: 'direct',
  });

  describe('isWhatsAppCommand', () => {
    it('returns true for /help', () => {
      expect(isWhatsAppCommand('/help')).toBe(true);
    });

    it('returns true for /reset', () => {
      expect(isWhatsAppCommand('/reset')).toBe(true);
    });

    it('returns true for /status', () => {
      expect(isWhatsAppCommand('/status')).toBe(true);
    });

    it('returns false for regular text', () => {
      expect(isWhatsAppCommand('hello')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isWhatsAppCommand('')).toBe(false);
    });

    it('returns false for / alone', () => {
      expect(isWhatsAppCommand('/')).toBe(false);
    });
  });

  describe('handleWhatsAppCommand', () => {
    it('handles /help', async () => {
      const result = await handleWhatsAppCommand(makeMsg('/help'), mockAdapter);
      expect(result).toBe(true);
      expect(mockAdapter.sendMessage).toHaveBeenCalled();
    });

    it('handles /reset', async () => {
      const result = await handleWhatsAppCommand(makeMsg('/reset'), mockAdapter);
      expect(result).toBe(true);
      expect(mockAdapter.sendMessage).toHaveBeenCalled();
    });

    it('handles /status', async () => {
      const result = await handleWhatsAppCommand(makeMsg('/status'), mockAdapter);
      expect(result).toBe(true);
      expect(mockAdapter.sendMessage).toHaveBeenCalled();
    });

    it('handles /start', async () => {
      const result = await handleWhatsAppCommand(makeMsg('/start'), mockAdapter);
      expect(result).toBe(true);
      expect(mockAdapter.sendMessage).toHaveBeenCalled();
    });

    it('returns false for unknown command', async () => {
      const result = await handleWhatsAppCommand(makeMsg('/unknown'), mockAdapter);
      expect(result).toBe(false);
    });

    it('is case insensitive', async () => {
      const result = await handleWhatsAppCommand(makeMsg('/HELP'), mockAdapter);
      expect(result).toBe(true);
    });

    it('strips @suffix from command', async () => {
      const result = await handleWhatsAppCommand(makeMsg('/help@botname'), mockAdapter);
      expect(result).toBe(true);
    });

    it('/start output includes sender name', async () => {
      await handleWhatsAppCommand(makeMsg('/start'), mockAdapter);
      const text = (mockAdapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text;
      expect(text).toContain('Alice');
    });

    it('/start uses "there" when no senderName', async () => {
      const msg = makeMsg('/start');
      msg.senderName = undefined;
      await handleWhatsAppCommand(msg, mockAdapter);
      const text = (mockAdapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text;
      expect(text).toContain('there');
    });

    it('/help output lists all commands', async () => {
      await handleWhatsAppCommand(makeMsg('/help'), mockAdapter);
      const text = (mockAdapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text;
      expect(text).toContain('/start');
      expect(text).toContain('/help');
      expect(text).toContain('/reset');
      expect(text).toContain('/status');
    });

    it('/status shows model name when configured', async () => {
      const { getChannelConfig } = await import('../config');
      (getChannelConfig as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        channelId: 'whatsapp',
        allowedSenderIds: [],
      });
      const { resolveModel } = await import('../agent-handler');
      (resolveModel as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        name: 'GPT-4',
        provider: 'openai',
        routingMode: 'direct',
      });

      await handleWhatsAppCommand(makeMsg('/status'), mockAdapter);
      const text = (mockAdapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text;
      expect(text).toContain('GPT-4');
    });

    it('/status shows "Not configured" when no model', async () => {
      await handleWhatsAppCommand(makeMsg('/status'), mockAdapter);
      const text = (mockAdapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text;
      expect(text).toContain('Not configured');
    });

    it('/status shows message count when chat exists', async () => {
      const { findChatByChannelChatId, getMessagesByChatId } = await import('@extension/storage');
      (findChatByChannelChatId as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'chat-1',
      });
      (getMessagesByChatId as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: '1' },
        { id: '2' },
        { id: '3' },
      ]);

      await handleWhatsAppCommand(makeMsg('/status'), mockAdapter);
      const text = (mockAdapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text;
      expect(text).toContain('3');
    });

    it('/status shows "No active conversation" when no chat', async () => {
      await handleWhatsAppCommand(makeMsg('/status'), mockAdapter);
      const text = (mockAdapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text;
      expect(text).toContain('No active conversation');
    });

    it('handles command with extra args ("/help foo")', async () => {
      const result = await handleWhatsAppCommand(makeMsg('/help foo bar'), mockAdapter);
      expect(result).toBe(true);
      expect(mockAdapter.sendMessage).toHaveBeenCalled();
    });

    it('sendMessage failure in handler propagates error', async () => {
      (mockAdapter.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('send failed'),
      );

      // The handler awaits sendMessage, so the rejection propagates
      await expect(handleWhatsAppCommand(makeMsg('/help'), mockAdapter)).rejects.toThrow(
        'send failed',
      );
    });
  });

  describe('isWhatsAppCommand additional', () => {
    it('returns true for /start', () => {
      expect(isWhatsAppCommand('/start')).toBe(true);
    });
  });
});
