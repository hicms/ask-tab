import { useEffect, useState } from 'react';

/** Ephemeral task status comes from the worker, so it cannot survive as a stale DB flag. */
export const useRunningChats = (enabled = true): ReadonlySet<string> => {
  const [chatIds, setChatIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let port: chrome.runtime.Port | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (disposed) return;
      port = chrome.runtime.connect({ name: 'llm-stream' });
      port.onMessage.addListener((message: { type: string; chatIds?: string[] }) => {
        if (!disposed && message.type === 'LLM_RUNNING_CHATS') setChatIds(new Set(message.chatIds));
      });
      port.onDisconnect.addListener(() => {
        if (disposed) return;
        setChatIds(new Set());
        // An idle MV3 worker can suspend while the history view stays mounted.
        retry = setTimeout(connect, 1000);
      });
      port.postMessage({ type: 'LLM_STREAM_WATCH' });
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      port?.disconnect();
    };
  }, [enabled]);
  return chatIds;
};
