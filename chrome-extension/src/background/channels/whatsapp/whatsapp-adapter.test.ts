import { whatsappAdapter } from './adapter';
import { downloadQueuedMedia, sendWhatsAppText } from '../gateway';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelInboundMessage } from '../types';

vi.mock('../gateway', () => ({
  sendWhatsAppText: vi.fn(() => Promise.resolve({ messageId: 'm1' })),
  downloadQueuedMedia: vi.fn(() => Promise.resolve(new ArrayBuffer(4))),
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

const sendText = vi.mocked(sendWhatsAppText);
const download = vi.mocked(downloadQueuedMedia);

const makeInbound = (overrides: Partial<ChannelInboundMessage> = {}): ChannelInboundMessage => ({
  channelMessageId: '1',
  channelChatId: '123@s.whatsapp.net',
  senderId: '15551234567@s.whatsapp.net',
  body: 'hello',
  timestamp: Date.now(),
  chatType: 'direct',
  ...overrides,
});

describe('whatsappAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has the expected static properties', () => {
    expect(whatsappAdapter.id).toBe('whatsapp');
    expect(whatsappAdapter.label).toBe('WhatsApp');
    expect(whatsappAdapter.maxMessageLength).toBe(4096);
  });

  describe('sendMessage', () => {
    it('sends formatted text through the server gateway', async () => {
      const result = await whatsappAdapter.sendMessage({ to: '123@s.whatsapp.net', text: 'hi' });

      expect(result).toEqual({ ok: true, messageId: 'm1' });
      expect(sendText).toHaveBeenCalledWith('123@s.whatsapp.net', 'hi');
    });

    it('applies WhatsApp formatting', async () => {
      await whatsappAdapter.sendMessage({ to: '123@s.whatsapp.net', text: '**bold**' });

      expect(sendText).toHaveBeenCalledWith('123@s.whatsapp.net', '*bold*');
    });

    it('splits long text into multiple chunks', async () => {
      sendText.mockResolvedValue({ messageId: 'chunk' });

      const result = await whatsappAdapter.sendMessage({
        to: '123@s.whatsapp.net',
        text: `${'a'.repeat(4000)}\n${'b'.repeat(4000)}`,
      });

      expect(sendText.mock.calls.length).toBeGreaterThan(1);
      expect(result.ok).toBe(true);
    });

    it('returns the last chunk message id', async () => {
      sendText
        .mockResolvedValueOnce({ messageId: 'first' })
        .mockResolvedValueOnce({ messageId: 'last' });

      const result = await whatsappAdapter.sendMessage({
        to: '123@s.whatsapp.net',
        text: `${'a'.repeat(4000)}\n${'b'.repeat(4000)}`,
      });

      expect(result.messageId).toBe('last');
    });

    it('returns ok without calling the server for empty formatted text', async () => {
      const result = await whatsappAdapter.sendMessage({ to: '123@s.whatsapp.net', text: '' });

      expect(result).toEqual({ ok: true });
      expect(sendText).not.toHaveBeenCalled();
    });

    it('returns an error result when the server send fails', async () => {
      sendText.mockRejectedValue(new Error('Not connected'));

      const result = await whatsappAdapter.sendMessage({ to: '123@s.whatsapp.net', text: 'hi' });

      expect(result).toEqual({ ok: false, error: 'Not connected' });
    });

    it('stops on the first chunk error', async () => {
      sendText.mockRejectedValue(new Error('boom'));

      const result = await whatsappAdapter.sendMessage({
        to: '123@s.whatsapp.net',
        text: `${'a'.repeat(4000)}\n${'b'.repeat(4000)}`,
      });

      expect(sendText).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(false);
    });

    it('normalizes non-Error throws', async () => {
      sendText.mockRejectedValue('nope');

      const result = await whatsappAdapter.sendMessage({ to: '123@s.whatsapp.net', text: 'hi' });

      expect(result).toEqual({ ok: false, error: 'Send failed' });
    });
  });

  describe('downloadMedia', () => {
    it('downloads the queued media by id', async () => {
      const data = await whatsappAdapter.downloadMedia(makeInbound({ mediaFileId: 'q-1' }));

      expect(download).toHaveBeenCalledWith('q-1');
      expect(data.byteLength).toBe(4);
    });

    it('throws when the message has no media', async () => {
      await expect(whatsappAdapter.downloadMedia(makeInbound())).rejects.toThrow('no media');
    });
  });

  describe('formatSenderDisplay', () => {
    it('shows the sender name when available', () => {
      expect(whatsappAdapter.formatSenderDisplay(makeInbound({ senderName: 'Alice' }))).toBe(
        'Alice',
      );
    });

    it('falls back to the username', () => {
      expect(whatsappAdapter.formatSenderDisplay(makeInbound({ senderUsername: 'alice_1' }))).toBe(
        'alice_1',
      );
    });

    it('derives a phone number from the JID as a last resort', () => {
      expect(whatsappAdapter.formatSenderDisplay(makeInbound())).toBe('+15551234567');
    });
  });
});
