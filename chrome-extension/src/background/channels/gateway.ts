import { requestAuthorized } from '../ask-service/client';

type ServerChannelId = 'telegram' | 'whatsapp';

type ChannelStatus = 'disabled' | 'connecting' | 'pairing' | 'connected' | 'logged_out' | 'error';

/** Server-side state of a channel account. The server owns credentials and sessions. */
interface ChannelView {
  channel: ServerChannelId;
  enabled: boolean;
  status: ChannelStatus;
  /** `@botname` for Telegram, `+<phone>` for WhatsApp. */
  identity: string | null;
  lastError: string | null;
  /** WhatsApp pairing payload, present while `status` is `pairing`. */
  qr: string | null;
  acceptFromMe: boolean;
  acceptFromOthers: boolean;
}

/** One inbound message leased from the server queue. */
interface QueuedUpdate {
  id: string;
  channel: ServerChannelId;
  update: unknown;
  mediaType: string | null;
}

interface WhatsAppDirection {
  acceptFromMe: boolean;
  acceptFromOthers: boolean;
}

const MAX_ACK_BATCH = 200;
/** Extra time past the server-side wait before a pull counts as stalled (e.g. a half-open connection after sleep). */
const PULL_GRACE_SECONDS = 15;
const ACK_TIMEOUT_MS = 15_000;

const SERVER_CHANNEL_IDS: readonly ServerChannelId[] = ['telegram', 'whatsapp'];

const isServerChannelId = (value: unknown): value is ServerChannelId =>
  SERVER_CHANNEL_IDS.includes(value as ServerChannelId);

const sendJson = (method: string, body: unknown, signal?: AbortSignal): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal,
});

const listChannels = async (): Promise<ChannelView[]> =>
  (await (await requestAuthorized('/api/channels')).json()) as ChannelView[];

/** Returns null when the channel has no server account. */
const getChannelView = async (channelId: ServerChannelId): Promise<ChannelView | null> =>
  (await listChannels()).find(view => view.channel === channelId) ?? null;

/** Server status for chat commands; never throws. */
const describeChannelStatus = async (channelId: ServerChannelId): Promise<string> => {
  try {
    return (await getChannelView(channelId))?.status ?? 'not connected';
  } catch {
    return 'unknown';
  }
};

const connectTelegram = async (botToken: string): Promise<ChannelView> =>
  (await (
    await requestAuthorized('/api/channels/telegram', sendJson('PUT', { botToken }))
  ).json()) as ChannelView;

const connectWhatsApp = async (direction: WhatsAppDirection): Promise<ChannelView> =>
  (await (
    await requestAuthorized('/api/channels/whatsapp', sendJson('PUT', direction))
  ).json()) as ChannelView;

const setChannelEnabled = async (
  channelId: ServerChannelId,
  enabled: boolean,
): Promise<ChannelView> =>
  (await (
    await requestAuthorized(`/api/channels/${channelId}/enabled`, sendJson('PUT', { enabled }))
  ).json()) as ChannelView;

const removeChannel = async (channelId: ServerChannelId): Promise<void> => {
  await requestAuthorized(`/api/channels/${channelId}`, { method: 'DELETE' });
};

/** Leases queued messages; the server holds the request open up to `waitSeconds` when empty. */
const pullUpdates = async (waitSeconds: number, signal?: AbortSignal): Promise<QueuedUpdate[]> => {
  const wait = Math.max(0, Math.floor(waitSeconds));
  const deadline = AbortSignal.timeout((wait + PULL_GRACE_SECONDS) * 1000);
  const response = await requestAuthorized(`/api/channels/updates?wait=${wait}`, {
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  });
  return (await response.json()) as QueuedUpdate[];
};

const ackUpdates = async (ids: string[]): Promise<void> => {
  for (let start = 0; start < ids.length; start += MAX_ACK_BATCH) {
    await requestAuthorized(
      '/api/channels/updates/ack',
      sendJson(
        'POST',
        { ids: ids.slice(start, start + MAX_ACK_BATCH) },
        AbortSignal.timeout(ACK_TIMEOUT_MS),
      ),
    );
  }
};

const downloadQueuedMedia = async (id: string): Promise<ArrayBuffer> =>
  (await requestAuthorized(`/api/channels/media/${encodeURIComponent(id)}`)).arrayBuffer();

const sendWhatsAppText = async (to: string, text: string): Promise<{ messageId: string }> =>
  (await (
    await requestAuthorized('/api/channels/whatsapp/send', sendJson('POST', { to, text }))
  ).json()) as { messageId: string };

const sendWhatsAppAudio = async (
  to: string,
  audio: ArrayBuffer,
  contentType: string,
  ptt: boolean,
): Promise<{ messageId: string }> => {
  const form = new FormData();
  form.append('to', to);
  form.append('ptt', String(ptt));
  form.append('file', new Blob([audio], { type: contentType }), ptt ? 'voice.ogg' : 'audio');
  return (await (
    await requestAuthorized('/api/channels/whatsapp/send-audio', { method: 'POST', body: form })
  ).json()) as { messageId: string };
};

const setWhatsAppTyping = async (to: string, typing: boolean): Promise<void> => {
  await requestAuthorized('/api/channels/whatsapp/typing', sendJson('POST', { to, typing }));
};

export {
  isServerChannelId,
  listChannels,
  getChannelView,
  describeChannelStatus,
  connectTelegram,
  connectWhatsApp,
  setChannelEnabled,
  removeChannel,
  pullUpdates,
  ackUpdates,
  downloadQueuedMedia,
  sendWhatsAppText,
  sendWhatsAppAudio,
  setWhatsAppTyping,
};
export type { ServerChannelId, ChannelView, QueuedUpdate };
