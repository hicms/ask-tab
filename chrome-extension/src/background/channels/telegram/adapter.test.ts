import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

describe('createTelegramAdapter', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let createTelegramAdapter: any;

  beforeEach(async () => {
    globalThis.fetch = vi.fn();
    const mod = await import('./adapter');
    createTelegramAdapter = mod.createTelegramAdapter;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('has correct id and label', () => {
    const adapter = createTelegramAdapter('123:abc');
    expect(adapter.id).toBe('telegram');
    expect(adapter.label).toBe('Telegram');
    expect(adapter.maxMessageLength).toBe(4096);
  });

  it('validateAuth returns valid on successful getMe', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          result: { id: 1, username: 'test_bot', is_bot: true, first_name: 'Bot' },
        }),
    });

    const adapter = createTelegramAdapter('123:abc');
    const result = await adapter.validateAuth();
    expect(result.valid).toBe(true);
    expect(result.identity).toBe('@test_bot');
  });

  it('validateAuth returns invalid on failed getMe', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: false, description: 'Unauthorized' }),
    });

    const adapter = createTelegramAdapter('bad:token');
    const result = await adapter.validateAuth();
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Unauthorized');
  });

  it('sendMessage sends text via Telegram API', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: { message_id: 1 } }),
    });

    const adapter = createTelegramAdapter('123:abc');
    const result = await adapter.sendMessage({ to: '456', text: 'Hello' });
    expect(result.ok).toBe(true);
  });

  it('sendMessage returns error on failure', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: false, description: 'Chat not found' }),
    });

    const adapter = createTelegramAdapter('123:abc');
    const result = await adapter.sendMessage({ to: '999', text: 'Hello' });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('formatSenderDisplay uses senderName', () => {
    const adapter = createTelegramAdapter('123:abc');
    const display = adapter.formatSenderDisplay({
      channelChatId: '123',
      senderId: '456',
      senderName: 'Alice',
      senderUsername: 'alice',
      body: 'hi',
      timestamp: Date.now(),
      chatType: 'direct',
    });
    expect(display).toBe('Alice');
  });

  it('formatSenderDisplay falls back to username', () => {
    const adapter = createTelegramAdapter('123:abc');
    const display = adapter.formatSenderDisplay({
      channelChatId: '123',
      senderId: '456',
      senderUsername: 'alice',
      body: 'hi',
      timestamp: Date.now(),
      chatType: 'direct',
    });
    expect(display).toBe('alice');
  });

  it('formatSenderDisplay falls back to senderId', () => {
    const adapter = createTelegramAdapter('123:abc');
    const display = adapter.formatSenderDisplay({
      channelChatId: '123',
      senderId: '456',
      body: 'hi',
      timestamp: Date.now(),
      chatType: 'direct',
    });
    expect(display).toBe('User 456');
  });
});
