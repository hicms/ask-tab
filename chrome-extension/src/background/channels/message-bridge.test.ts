import { handleChannelMessage } from './agent-handler';
import { getChannelConfig, updateChannelConfig } from './config';
import { handleQueuedUpdate } from './message-bridge';
import { getChannelAdapter } from './registry';
import { handleBotCommand } from './telegram/commands';
import { handleWhatsAppCommand } from './whatsapp/commands';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedUpdate } from './gateway';

vi.mock('./agent-handler', () => ({
  handleChannelMessage: vi.fn(async () => {}),
}));

vi.mock('./config', () => ({
  getChannelConfig: vi.fn(),
  updateChannelConfig: vi.fn(async () => {}),
}));

vi.mock('./telegram/commands', () => ({
  isBotCommand: (body: string) => /^\/[a-z]+/.test(body),
  handleBotCommand: vi.fn(async () => true),
}));

vi.mock('./whatsapp/commands', () => ({
  isWhatsAppCommand: (body: string) => /^\/[a-z]+/.test(body),
  handleWhatsAppCommand: vi.fn(async () => true),
}));

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const adapter = {
  id: 'telegram',
  label: 'Telegram',
  maxMessageLength: 4096,
  sendMessage: vi.fn(async () => ({ ok: true })),
  downloadMedia: vi.fn(),
  formatSenderDisplay: () => 'User',
};

vi.mock('./registry', () => ({
  getChannelAdapter: vi.fn(() => adapter),
}));

let nextId = 1;

const telegramItem = (
  text: string,
  { from = 456, chatType = 'private' }: { from?: number; chatType?: string } = {},
): QueuedUpdate => {
  const id = nextId++;
  return {
    id: `q-${id}`,
    channel: 'telegram',
    mediaType: null,
    update: {
      update_id: id,
      message: {
        message_id: id,
        chat: { id: chatType === 'private' ? from : -100, type: chatType },
        from: { id: from, is_bot: false, first_name: 'Alice' },
        text,
        date: 1_700_000_000,
      },
    },
  };
};

const whatsappItem = (overrides: Record<string, unknown> = {}): QueuedUpdate => {
  const id = nextId++;
  return {
    id: `q-${id}`,
    channel: 'whatsapp',
    mediaType: null,
    update: {
      channelMessageId: `wa-${id}`,
      channelChatId: '15551234567@s.whatsapp.net',
      senderId: '15551234567@s.whatsapp.net',
      body: 'hello',
      timestamp: 1_700_000_000_000,
      chatType: 'direct',
      fromMe: false,
      ...overrides,
    },
  };
};

describe('handleQueuedUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getChannelAdapter).mockReturnValue(adapter);
    vi.mocked(getChannelConfig).mockImplementation(async channelId => ({
      channelId,
      allowedSenderIds: channelId === 'telegram' ? ['456'] : ['15551234567@s.whatsapp.net'],
    }));
  });

  it('dispatches an allowed Telegram DM to the agent handler', async () => {
    expect(await handleQueuedUpdate(telegramItem('hello'))).toBe(true);

    expect(handleChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({ senderId: '456', body: 'hello', chatType: 'direct' }),
      adapter,
      expect.objectContaining({ channelId: 'telegram' }),
    );
    expect(updateChannelConfig).toHaveBeenCalledWith('telegram', {
      lastActivityAt: expect.any(Number),
    });
  });

  it('skips senders that are not on the allowlist', async () => {
    expect(await handleQueuedUpdate(telegramItem('hi', { from: 999 }))).toBe(false);
    expect(handleChannelMessage).not.toHaveBeenCalled();
    expect(updateChannelConfig).not.toHaveBeenCalled();
  });

  it('skips everything when the channel has no local config', async () => {
    vi.mocked(getChannelConfig).mockResolvedValue(undefined);
    expect(await handleQueuedUpdate(telegramItem('hi'))).toBe(false);
    expect(handleChannelMessage).not.toHaveBeenCalled();
  });

  it('skips group messages', async () => {
    expect(await handleQueuedUpdate(telegramItem('hi', { chatType: 'supergroup' }))).toBe(false);
    expect(handleChannelMessage).not.toHaveBeenCalled();
  });

  it('skips a redelivered message it already handled', async () => {
    const item = telegramItem('once');
    expect(await handleQueuedUpdate(item)).toBe(true);
    expect(await handleQueuedUpdate({ ...item, id: 'q-redelivered' })).toBe(false);
    expect(handleChannelMessage).toHaveBeenCalledOnce();
  });

  it('keeps messages from two chats that share a Telegram message id', async () => {
    vi.mocked(getChannelConfig).mockResolvedValue({
      channelId: 'telegram',
      allowedSenderIds: ['456', '789'],
    });
    const first = telegramItem('from alice', { from: 456 });
    const second = telegramItem('from bob', { from: 789 });
    const shared = (first.update as { message: { message_id: number } }).message.message_id;
    (second.update as { message: { message_id: number } }).message.message_id = shared;

    expect(await handleQueuedUpdate(first)).toBe(true);
    expect(await handleQueuedUpdate(second)).toBe(true);
    expect(handleChannelMessage).toHaveBeenCalledTimes(2);
  });

  it('skips updates that do not normalize to a message', async () => {
    const item: QueuedUpdate = {
      id: 'q-edit',
      channel: 'telegram',
      mediaType: null,
      update: { update_id: 9999 },
    };
    expect(await handleQueuedUpdate(item)).toBe(false);
  });

  it('skips a channel without an adapter', async () => {
    vi.mocked(getChannelAdapter).mockReturnValue(undefined);
    expect(await handleQueuedUpdate(telegramItem('hi'))).toBe(false);
  });

  it('answers Telegram commands without the agent', async () => {
    expect(await handleQueuedUpdate(telegramItem('/status'))).toBe(true);
    expect(handleBotCommand).toHaveBeenCalledOnce();
    expect(handleChannelMessage).not.toHaveBeenCalled();
  });

  it('treats a failing command as handled', async () => {
    vi.mocked(handleBotCommand).mockRejectedValueOnce(new Error('crashed'));
    expect(await handleQueuedUpdate(telegramItem('/start'))).toBe(true);
    expect(handleChannelMessage).not.toHaveBeenCalled();
  });

  it('passes unknown commands on to the agent', async () => {
    vi.mocked(handleBotCommand).mockResolvedValueOnce(false);
    expect(await handleQueuedUpdate(telegramItem('/unknown'))).toBe(true);
    expect(handleChannelMessage).toHaveBeenCalledOnce();
  });

  it('survives an agent handler failure', async () => {
    vi.mocked(handleChannelMessage).mockRejectedValueOnce(new Error('LLM down'));
    await expect(handleQueuedUpdate(telegramItem('hello'))).resolves.toBe(true);
  });

  it('dispatches an allowed WhatsApp message and routes commands', async () => {
    expect(await handleQueuedUpdate(whatsappItem())).toBe(true);
    expect(handleChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({ senderId: '15551234567@s.whatsapp.net', body: 'hello' }),
      adapter,
      expect.objectContaining({ channelId: 'whatsapp' }),
    );

    expect(await handleQueuedUpdate(whatsappItem({ body: '/help' }))).toBe(true);
    expect(handleWhatsAppCommand).toHaveBeenCalledOnce();
  });

  it('allowlists own WhatsApp messages by the chat they were sent to', async () => {
    const own = whatsappItem({
      fromMe: true,
      senderId: '19998887777@s.whatsapp.net',
      channelChatId: '15551234567@s.whatsapp.net',
    });
    expect(await handleQueuedUpdate(own)).toBe(true);

    const toStranger = whatsappItem({
      fromMe: true,
      senderId: '15551234567@s.whatsapp.net',
      channelChatId: '10000000000@s.whatsapp.net',
    });
    expect(await handleQueuedUpdate(toStranger)).toBe(false);
  });

  it('passes WhatsApp voice notes through with their queue id as the media handle', async () => {
    const voice = whatsappItem({ body: '', isAudio: true });
    voice.mediaType = 'audio/ogg; codecs=opus';

    expect(await handleQueuedUpdate(voice)).toBe(true);
    expect(handleChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({ mediaFileId: voice.id, mediaMimeType: 'audio/ogg; codecs=opus' }),
      adapter,
      expect.anything(),
    );
  });
});
