import { useCallback, useEffect, useState } from 'react';

type ChannelId = 'telegram' | 'whatsapp';

type ChannelStatus = 'disabled' | 'connecting' | 'pairing' | 'connected' | 'logged_out' | 'error';

/** Server-side channel account, as returned by the background `CHANNEL_*` messages. */
interface ChannelView {
  channel: ChannelId;
  enabled: boolean;
  status: ChannelStatus;
  identity: string | null;
  lastError: string | null;
  qr: string | null;
  acceptFromMe: boolean;
  acceptFromOthers: boolean;
}

/** Routing settings kept in the extension. */
interface LocalChannelConfig {
  channelId: string;
  allowedSenderIds: string[];
  modelId?: string;
  lastActivityAt?: number;
}

const REFRESH_WHILE_LINKING_MS = 2000;

const sendChannelMessage = async <T>(
  type: string,
  data: Record<string, unknown> = {},
): Promise<T> => {
  const result = (await chrome.runtime.sendMessage({ type, ...data })) as
    | (T & { error?: string })
    | undefined;
  if (!result) throw new Error(`${type}: no response`);
  if (result.error) throw new Error(result.error);
  return result;
};

const isLinking = (view: ChannelView | null): boolean =>
  view?.status === 'connecting' || view?.status === 'pairing';

/** Loads a channel's local config and server state, refreshing while it is linking. */
const useChannelState = (channelId: ChannelId) => {
  const [config, setConfig] = useState<LocalChannelConfig | null>(null);
  const [view, setView] = useState<ChannelView | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const state = await sendChannelMessage<{
        config: LocalChannelConfig;
        view: ChannelView | null;
        signedIn: boolean;
      }>('CHANNEL_GET', { channelId });
      setConfig(state.config);
      setView(state.view);
      setSignedIn(state.signedIn);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [channelId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const linking = isLinking(view);
  useEffect(() => {
    if (!linking) return;
    const timer = setInterval(() => void refresh(), REFRESH_WHILE_LINKING_MS);
    return () => clearInterval(timer);
  }, [linking, refresh]);

  const saveConfig = useCallback(
    async (next: LocalChannelConfig) => {
      setConfig(next);
      await sendChannelMessage('CHANNEL_SAVE_CONFIG', {
        channelId,
        config: { allowedSenderIds: next.allowedSenderIds, modelId: next.modelId },
      });
    },
    [channelId],
  );

  return { config, view, setView, signedIn, loadError, refresh, saveConfig };
};

const STATUS_DOT_COLOR: Record<ChannelStatus, string> = {
  disabled: 'bg-gray-400',
  connecting: 'bg-yellow-400',
  pairing: 'bg-yellow-400',
  connected: 'bg-green-400',
  logged_out: 'bg-red-400',
  error: 'bg-red-400',
};

export { useChannelState, sendChannelMessage, STATUS_DOT_COLOR };
export type { ChannelId, ChannelStatus, ChannelView, LocalChannelConfig };
