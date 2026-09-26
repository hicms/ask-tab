import { sendTelegramMessage, setMyCommands } from './bot-api';
import { handleBotCommand, isBotCommand, registerBotCommands } from './commands';
import { resolveModel } from '../agent-handler';
import { getChannelConfig } from '../config';
import {
  deleteChat,
  findChatByChannelChatId,
  getMessagesByChatId,
  ttsConfigStorage,
} from '@extension/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelInboundMessage } from '../types';

vi.mock('./bot-api', () => ({
  sendTelegramMessage: vi.fn(() => Promise.resolve()),
  setMyCommands: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../logging/logger-buffer', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@extension/storage', () => ({
  findChatByChannelChatId: vi.fn(() => Promise.resolve(null)),
  deleteChat: vi.fn(() => Promise.resolve()),
  getMessagesByChatId: vi.fn(() => Promise.resolve([])),
  ttsConfigStorage: {
    get: vi.fn(() =>
      Promise.resolve({
        engine: 'openai',
        autoMode: 'off',
        openai: { voice: 'alloy' },
        summarize: false,
        maxChars: 500,
      }),
    ),
    set: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../config', () => ({
  getChannelConfig: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../agent-handler', () => ({
  resolveModel: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../gateway', () => ({
  describeChannelStatus: vi.fn(() => Promise.resolve('connected')),
}));

const send = vi.mocked(sendTelegramMessage);
const findChat = vi.mocked(findChatByChannelChatId);
const ttsSet = vi.mocked(ttsConfigStorage.set);

const makeMsg = (body: string): ChannelInboundMessage => ({
  channelMessageId: '1',
  channelChatId: '123',
  senderId: '456',
  senderName: 'Alice',
  body,
  timestamp: Date.now(),
  chatType: 'direct',
});

const lastReply = (): string => send.mock.calls.at(-1)?.[1] as string;

describe('telegram commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    it('handles /start with a welcome message', async () => {
      expect(await handleBotCommand(makeMsg('/start'))).toBe(true);
      expect(send).toHaveBeenCalledWith('123', expect.stringContaining('Hello Alice'));
    });

    it('handles /help by listing all commands', async () => {
      expect(await handleBotCommand(makeMsg('/help'))).toBe(true);
      expect(lastReply()).toContain('/reset');
      expect(lastReply()).toContain('/tts');
    });

    it('handles /reset by deleting the existing chat', async () => {
      findChat.mockResolvedValue({ id: 'chat-1' } as never);

      expect(await handleBotCommand(makeMsg('/reset'))).toBe(true);
      expect(deleteChat).toHaveBeenCalledWith('chat-1');
      expect(lastReply()).toContain('reset');
    });

    it('handles /status with model and channel info', async () => {
      vi.mocked(getChannelConfig).mockResolvedValue({
        channelId: 'telegram',
        allowedSenderIds: [],
      });
      vi.mocked(resolveModel).mockResolvedValue({ name: 'gpt-x', provider: 'custom' } as never);
      findChat.mockResolvedValue({ id: 'chat-1' } as never);
      vi.mocked(getMessagesByChatId).mockResolvedValue([{}, {}] as never);

      expect(await handleBotCommand(makeMsg('/status'))).toBe(true);
      expect(lastReply()).toContain('Model: gpt-x');
      expect(lastReply()).toContain('Messages in conversation: 2');
      expect(lastReply()).toContain('Channel status: connected');
    });

    it('returns false for an unknown command', async () => {
      expect(await handleBotCommand(makeMsg('/unknown'))).toBe(false);
      expect(send).not.toHaveBeenCalled();
    });

    it('strips the @botname suffix from the command', async () => {
      expect(await handleBotCommand(makeMsg('/start@mybot'))).toBe(true);
      expect(send).toHaveBeenCalled();
    });
  });

  describe('/tts', () => {
    it('shows current settings by default', async () => {
      expect(await handleBotCommand(makeMsg('/tts'))).toBe(true);
      expect(lastReply()).toContain('Engine: openai');
      expect(lastReply()).toContain('Mode: off');
    });

    it('turns TTS on with /tts on', async () => {
      await handleBotCommand(makeMsg('/tts on'));
      expect(ttsSet).toHaveBeenCalledWith(expect.objectContaining({ autoMode: 'always' }));
    });

    it('turns TTS off with /tts off', async () => {
      await handleBotCommand(makeMsg('/tts off'));
      expect(ttsSet).toHaveBeenCalledWith(expect.objectContaining({ autoMode: 'off' }));
    });

    it('sets an explicit mode with /tts inbound', async () => {
      await handleBotCommand(makeMsg('/tts inbound'));
      expect(ttsSet).toHaveBeenCalledWith(expect.objectContaining({ autoMode: 'inbound' }));
    });

    it('shows usage for an unknown subcommand', async () => {
      await handleBotCommand(makeMsg('/tts bogus'));
      expect(ttsSet).not.toHaveBeenCalled();
      expect(lastReply()).toContain('TTS Commands:');
    });
  });

  describe('registerBotCommands', () => {
    it('registers the command list with Telegram', async () => {
      await registerBotCommands();
      expect(setMyCommands).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ command: 'start' })]),
      );
    });

    it('swallows registration failures', async () => {
      vi.mocked(setMyCommands).mockRejectedValueOnce(new Error('Unauthorized'));
      await expect(registerBotCommands()).resolves.toBeUndefined();
    });
  });
});
