import {
  ackUpdates,
  connectTelegram,
  connectWhatsApp,
  downloadQueuedMedia,
  getChannelView,
  isServerChannelId,
  listChannels,
  pullUpdates,
  removeChannel,
  sendWhatsAppAudio,
  sendWhatsAppText,
  setChannelEnabled,
  setWhatsAppTyping,
} from './gateway';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelView } from './gateway';

vi.mock('../ask-service/client', () => ({ requestAuthorized: vi.fn() }));

const { requestAuthorized } = await import('../ask-service/client');
const request = vi.mocked(requestAuthorized);

const view = (overrides: Partial<ChannelView> = {}): ChannelView => ({
  channel: 'telegram',
  enabled: true,
  status: 'connected',
  identity: '@bot',
  lastError: null,
  qr: null,
  acceptFromMe: true,
  acceptFromOthers: false,
  ...overrides,
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const lastInit = (): RequestInit => request.mock.calls.at(-1)?.[1] ?? {};

beforeEach(() => {
  request.mockReset();
});

describe('channel gateway', () => {
  it('lists channels and finds one view', async () => {
    const views = [view(), view({ channel: 'whatsapp', identity: '+1555' })];
    request.mockImplementation(async () => json(views));
    expect(await listChannels()).toEqual(views);
    expect(request).toHaveBeenCalledWith('/api/channels');
    expect(await getChannelView('whatsapp')).toEqual(views[1]);
  });

  it('returns null for a channel without an account', async () => {
    request.mockResolvedValueOnce(json([view()]));
    expect(await getChannelView('whatsapp')).toBeNull();
  });

  it('connects Telegram with the bot token', async () => {
    request.mockResolvedValueOnce(json(view()));
    expect(await connectTelegram('123:abc')).toEqual(view());
    expect(request).toHaveBeenCalledWith('/api/channels/telegram', expect.any(Object));
    expect(lastInit().method).toBe('PUT');
    expect(JSON.parse(lastInit().body as string)).toEqual({ botToken: '123:abc' });
  });

  it('connects WhatsApp with direction settings', async () => {
    request.mockResolvedValueOnce(json(view({ channel: 'whatsapp', status: 'pairing' })));
    await connectWhatsApp({ acceptFromMe: false, acceptFromOthers: true });
    expect(request.mock.calls[0]?.[0]).toBe('/api/channels/whatsapp');
    expect(JSON.parse(lastInit().body as string)).toEqual({
      acceptFromMe: false,
      acceptFromOthers: true,
    });
  });

  it('enables, disables and removes a channel', async () => {
    request.mockResolvedValueOnce(json(view({ enabled: false, status: 'disabled' })));
    const updated = await setChannelEnabled('telegram', false);
    expect(updated.status).toBe('disabled');
    expect(request.mock.calls[0]?.[0]).toBe('/api/channels/telegram/enabled');
    expect(JSON.parse(lastInit().body as string)).toEqual({ enabled: false });

    request.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await removeChannel('whatsapp');
    expect(request).toHaveBeenLastCalledWith('/api/channels/whatsapp', { method: 'DELETE' });
  });

  it('pulls updates with a bounded wait and forwards the abort signal', async () => {
    const items = [{ id: 'q1', channel: 'telegram', update: { update_id: 1 }, mediaType: null }];
    request.mockResolvedValueOnce(json(items));
    const controller = new AbortController();
    expect(await pullUpdates(20, controller.signal)).toEqual(items);
    expect(request.mock.calls.at(-1)?.[0]).toBe('/api/channels/updates?wait=20');
    const signal = lastInit().signal;
    expect(signal?.aborted).toBe(false);
    controller.abort();
    expect(signal?.aborted).toBe(true);

    request.mockResolvedValueOnce(json([]));
    await pullUpdates(-3);
    expect(request.mock.calls.at(-1)?.[0]).toBe('/api/channels/updates?wait=0');
  });

  it('gives up on a pull that outlives its wait', async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal);
    try {
      request.mockImplementationOnce(
        (_path, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
      );
      const pending = pullUpdates(1, new AbortController().signal);
      expect(timeout).toHaveBeenCalledWith(16_000);
      deadline.abort();
      await expect(pending).rejects.toThrow('aborted');
    } finally {
      timeout.mockRestore();
    }
  });

  it('acks in batches of at most 200 ids', async () => {
    request.mockImplementation(async () => new Response(null, { status: 204 }));
    const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
    await ackUpdates(ids);
    expect(request).toHaveBeenCalledTimes(3);
    const sizes = request.mock.calls.map(
      call => (JSON.parse(call[1]?.body as string) as { ids: string[] }).ids.length,
    );
    expect(sizes).toEqual([200, 200, 50]);
    expect(request.mock.calls[0]?.[0]).toBe('/api/channels/updates/ack');
    expect(request.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('skips the request when there is nothing to ack', async () => {
    await ackUpdates([]);
    expect(request).not.toHaveBeenCalled();
  });

  it('downloads queued media bytes', async () => {
    request.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const bytes = await downloadQueuedMedia('q 1');
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(request).toHaveBeenCalledWith('/api/channels/media/q%201');
  });

  it('sends WhatsApp text, audio and typing', async () => {
    request.mockResolvedValueOnce(json({ messageId: 'm1' }));
    expect(await sendWhatsAppText('1555@s.whatsapp.net', 'hi')).toEqual({ messageId: 'm1' });
    expect(JSON.parse(lastInit().body as string)).toEqual({
      to: '1555@s.whatsapp.net',
      text: 'hi',
    });

    request.mockResolvedValueOnce(json({ messageId: 'm2' }));
    await sendWhatsAppAudio('1555@s.whatsapp.net', new ArrayBuffer(4), 'audio/ogg', true);
    expect(request.mock.calls.at(-1)?.[0]).toBe('/api/channels/whatsapp/send-audio');
    const form = lastInit().body as FormData;
    expect(form.get('to')).toBe('1555@s.whatsapp.net');
    expect(form.get('ptt')).toBe('true');
    const file = form.get('file') as Blob;
    expect(file.type).toBe('audio/ogg');
    expect(file.size).toBe(4);

    request.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await setWhatsAppTyping('1555@s.whatsapp.net', false);
    expect(request.mock.calls.at(-1)?.[0]).toBe('/api/channels/whatsapp/typing');
    expect(JSON.parse(lastInit().body as string)).toEqual({
      to: '1555@s.whatsapp.net',
      typing: false,
    });
  });

  it('propagates server errors', async () => {
    request.mockRejectedValueOnce(new Error('WhatsApp is not connected'));
    await expect(sendWhatsAppText('x', 'y')).rejects.toThrow('WhatsApp is not connected');
  });

  it('recognizes server channel ids', () => {
    expect(isServerChannelId('telegram')).toBe(true);
    expect(isServerChannelId('whatsapp')).toBe(true);
    expect(isServerChannelId('slack')).toBe(false);
    expect(isServerChannelId(undefined)).toBe(false);
  });
});
