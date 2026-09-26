import { telegramAdapter } from './adapter';
import { downloadFile, getFile, sendTelegramMessage } from './bot-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelInboundMessage } from '../types';

vi.mock('./bot-api', () => ({
  MAX_TG_MESSAGE_LENGTH: 4096,
  sendTelegramMessage: vi.fn(async () => {}),
  getFile: vi.fn(async () => ({ filePath: 'voice/file_1.oga' })),
  downloadFile: vi.fn(async () => new ArrayBuffer(3)),
}));

const inbound = (overrides: Partial<ChannelInboundMessage> = {}): ChannelInboundMessage => ({
  channelChatId: '123',
  senderId: '456',
  body: 'hi',
  timestamp: 0,
  chatType: 'direct',
  ...overrides,
});

describe('telegramAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has the Telegram id, label and limit', () => {
    expect(telegramAdapter.id).toBe('telegram');
    expect(telegramAdapter.label).toBe('Telegram');
    expect(telegramAdapter.maxMessageLength).toBe(4096);
  });

  it('sends text through the bot API', async () => {
    expect(await telegramAdapter.sendMessage({ to: '456', text: 'Hello' })).toEqual({ ok: true });
    expect(sendTelegramMessage).toHaveBeenCalledWith('456', 'Hello');
  });

  it('reports send failures instead of throwing', async () => {
    vi.mocked(sendTelegramMessage).mockRejectedValueOnce(new Error('Chat not found'));

    expect(await telegramAdapter.sendMessage({ to: '999', text: 'Hello' })).toEqual({
      ok: false,
      error: 'Chat not found',
    });
  });

  it('downloads media by resolving the file path first', async () => {
    const audio = await telegramAdapter.downloadMedia(inbound({ mediaFileId: 'file-1' }));

    expect(getFile).toHaveBeenCalledWith('file-1');
    expect(downloadFile).toHaveBeenCalledWith('voice/file_1.oga');
    expect(audio.byteLength).toBe(3);
  });

  it('refuses to download without a media handle', async () => {
    await expect(telegramAdapter.downloadMedia(inbound())).rejects.toThrow('no media');
    expect(getFile).not.toHaveBeenCalled();
  });

  it('formats the sender from name, username, then id', () => {
    expect(
      telegramAdapter.formatSenderDisplay(inbound({ senderName: 'Alice', senderUsername: 'a' })),
    ).toBe('Alice');
    expect(telegramAdapter.formatSenderDisplay(inbound({ senderUsername: 'alice' }))).toBe('alice');
    expect(telegramAdapter.formatSenderDisplay(inbound())).toBe('User 456');
  });
});
