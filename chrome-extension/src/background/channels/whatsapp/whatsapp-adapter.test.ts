import { createWhatsAppAdapter } from './adapter';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock chrome.storage.local and chrome.runtime.sendMessage
const mockStorage: Record<string, unknown> = {};

const mockChrome = {
  storage: {
    local: {
      get: vi.fn((keys: string | string[]) => {
        const result: Record<string, unknown> = {};
        const keyArr = Array.isArray(keys) ? keys : [keys];
        for (const key of keyArr) {
          if (mockStorage[key] !== undefined) {
            result[key] = mockStorage[key];
          }
        }
        return Promise.resolve(result);
      }),
    },
  },
  runtime: {
    sendMessage: vi.fn(),
  },
};

describe('createWhatsAppAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', mockChrome);
    mockChrome.runtime.sendMessage.mockReset();
    // Clear storage
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key];
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates an adapter with correct properties', () => {
    const adapter = createWhatsAppAdapter();
    expect(adapter.id).toBe('whatsapp');
    expect(adapter.label).toBe('WhatsApp');
    expect(adapter.maxMessageLength).toBe(4096);
  });

  it('validateAuth returns valid when creds exist', async () => {
    mockStorage['wa-auth-creds'] = '{"some":"creds"}';
    const adapter = createWhatsAppAdapter();
    const result = await adapter.validateAuth();
    expect(result.valid).toBe(true);
    expect(result.identity).toBe('WhatsApp linked');
  });

  it('validateAuth returns invalid when no creds', async () => {
    const adapter = createWhatsAppAdapter();
    const result = await adapter.validateAuth();
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Not linked');
  });

  it('sendMessage delegates to chrome.runtime.sendMessage', async () => {
    mockChrome.runtime.sendMessage.mockResolvedValueOnce({ ok: true, messageId: 'msg-123' });

    const adapter = createWhatsAppAdapter();
    const result = await adapter.sendMessage({
      to: '1234567890@s.whatsapp.net',
      text: 'hello',
    });

    expect(result.ok).toBe(true);
    expect(result.messageId).toBe('msg-123');
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'WA_SEND_MESSAGE',
      jid: '1234567890@s.whatsapp.net',
      text: 'hello',
    });
  });

  it('sendMessage handles errors gracefully', async () => {
    mockChrome.runtime.sendMessage.mockRejectedValueOnce(new Error('SW unavailable'));

    const adapter = createWhatsAppAdapter();
    const result = await adapter.sendMessage({
      to: '1234567890@s.whatsapp.net',
      text: 'hello',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('SW unavailable');
  });

  it('formatSenderDisplay shows name when available', () => {
    const adapter = createWhatsAppAdapter();
    const display = adapter.formatSenderDisplay({
      channelChatId: '1234567890@s.whatsapp.net',
      senderId: '1234567890@s.whatsapp.net',
      senderName: 'Alice',
      body: 'hi',
      timestamp: Date.now(),
      chatType: 'direct',
    });
    expect(display).toBe('Alice');
  });

  it('formatSenderDisplay shows phone number from JID when no name', () => {
    const adapter = createWhatsAppAdapter();
    const display = adapter.formatSenderDisplay({
      channelChatId: '1234567890@s.whatsapp.net',
      senderId: '1234567890@s.whatsapp.net',
      body: 'hi',
      timestamp: Date.now(),
      chatType: 'direct',
    });
    expect(display).toBe('+1234567890');
  });

  // ── Message splitting ──

  it('sendMessage splits long text into multiple chunks', async () => {
    // Create a message that exceeds 4096 chars
    const longText = 'A'.repeat(5000);
    mockChrome.runtime.sendMessage
      .mockResolvedValueOnce({ ok: true, messageId: 'chunk-1' })
      .mockResolvedValueOnce({ ok: true, messageId: 'chunk-2' });

    const adapter = createWhatsAppAdapter();
    const result = await adapter.sendMessage({
      to: '1234567890@s.whatsapp.net',
      text: longText,
    });

    expect(result.ok).toBe(true);
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('sendMessage returns last chunk messageId', async () => {
    const longText = 'A'.repeat(5000);
    mockChrome.runtime.sendMessage
      .mockResolvedValueOnce({ ok: true, messageId: 'chunk-1' })
      .mockResolvedValueOnce({ ok: true, messageId: 'chunk-2' });

    const adapter = createWhatsAppAdapter();
    const result = await adapter.sendMessage({
      to: '1234567890@s.whatsapp.net',
      text: longText,
    });

    expect(result.messageId).toBe('chunk-2');
  });

  it('sendMessage stops on first chunk error', async () => {
    const longText = 'A'.repeat(5000);
    mockChrome.runtime.sendMessage.mockResolvedValueOnce({ ok: false, error: 'First chunk fail' });

    const adapter = createWhatsAppAdapter();
    const result = await adapter.sendMessage({
      to: '1234567890@s.whatsapp.net',
      text: longText,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('First chunk fail');
    // Should not have sent the second chunk
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('sendMessage returns ok:true for empty formatted text', async () => {
    const adapter = createWhatsAppAdapter();
    const result = await adapter.sendMessage({
      to: '1234567890@s.whatsapp.net',
      text: '',
    });

    expect(result.ok).toBe(true);
    expect(mockChrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('sendMessage applies WhatsApp formatting', async () => {
    mockChrome.runtime.sendMessage.mockResolvedValueOnce({ ok: true, messageId: 'msg-fmt' });

    const adapter = createWhatsAppAdapter();
    await adapter.sendMessage({
      to: '1234567890@s.whatsapp.net',
      text: '**bold** text',
    });

    // The formatted text should convert **bold** to *bold*
    const call = mockChrome.runtime.sendMessage.mock.calls[0][0];
    expect(call.text).toContain('*bold*');
    expect(call.text).not.toContain('**bold**');
  });

  it('sendMessage handles undefined offscreen response', async () => {
    mockChrome.runtime.sendMessage.mockResolvedValueOnce(undefined);

    const adapter = createWhatsAppAdapter();
    const result = await adapter.sendMessage({
      to: '1234567890@s.whatsapp.net',
      text: 'hello',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('not running');
  });

  it('sendMessage catches exceptions and returns error', async () => {
    mockChrome.runtime.sendMessage.mockImplementationOnce(() => {
      throw new Error('Unexpected crash');
    });

    const adapter = createWhatsAppAdapter();
    const result = await adapter.sendMessage({
      to: '1234567890@s.whatsapp.net',
      text: 'hello',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Unexpected crash');
  });

  // ── formatSenderDisplay fallback ──

  it('formatSenderDisplay falls back to senderUsername', () => {
    const adapter = createWhatsAppAdapter();
    const display = adapter.formatSenderDisplay({
      channelChatId: '1234567890@s.whatsapp.net',
      senderId: '1234567890@s.whatsapp.net',
      senderUsername: 'alice_wa',
      body: 'hi',
      timestamp: Date.now(),
      chatType: 'direct',
    });
    expect(display).toBe('alice_wa');
  });
});
