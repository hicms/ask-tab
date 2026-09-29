import { queuedToUserMessage } from './run-steering';
import {
  broadcastToChat,
  handleLLMStream,
  isLLMStreamRunning,
  stopLLMStream,
} from './stream-handler';
import { createLogger } from '../logging/logger-buffer';
import { MAX_QUEUED_MESSAGES } from '@extension/shared';
import { addMessage, getChat, getMessagesByChatId, touchChat } from '@extension/storage';
import type { SettledRun } from './stream-handler';
import type {
  ChatMessage,
  ChatQueuePauseReason,
  ChatQueueState,
  LLMQueueCommand,
  LLMQueueSnapshot,
  QueuedChatMessage,
} from '@extension/shared';

const queueLog = createLogger('stream');

const STORAGE_KEY = 'chatQueues';

interface ChatQueueDeps {
  /** Mirror that outlives a service worker restart; `chrome.storage.session` in production. */
  storage: Pick<chrome.storage.StorageArea, 'get' | 'set'>;
  keepAlive: { acquire: () => void; release: () => void };
}

const asQueued = (item: QueuedChatMessage): QueuedChatMessage => ({ ...item, mode: 'queue' });

/**
 * Owns every chat's pending messages. Views only send commands and render
 * snapshots, so a queue keeps running with the side panel closed and every
 * view of a chat shows the same queue.
 */
const createChatQueue = ({ storage, keepAlive }: ChatQueueDeps) => {
  const queues = new Map<string, ChatQueueState>();
  const dispatching = new Set<string>();
  let writes = Promise.resolve();

  // No run survives a worker restart, so a restored queue waits for the user.
  const ready = storage
    .get(STORAGE_KEY)
    .then(stored => {
      const saved = (stored[STORAGE_KEY] ?? {}) as Record<string, ChatQueueState>;
      for (const [chatId, state] of Object.entries(saved)) {
        if (!state.items?.length) continue;
        queues.set(chatId, {
          items: state.items.map(asQueued),
          pauseReason: state.pauseReason ?? 'restarted',
        });
      }
    })
    .catch(err => queueLog.warn('Queue restore failed', { error: String(err) }));

  const snapshot = (chatId: string): LLMQueueSnapshot => {
    const state = queues.get(chatId);
    return {
      type: 'LLM_QUEUE_SNAPSHOT',
      chatId,
      items: state?.items ?? [],
      ...(state?.pauseReason ? { pauseReason: state.pauseReason } : {}),
    };
  };

  const commit = (
    chatId: string,
    items: QueuedChatMessage[],
    pauseReason?: ChatQueuePauseReason,
  ) => {
    if (items.length === 0) queues.delete(chatId);
    else queues.set(chatId, pauseReason ? { items, pauseReason } : { items });
    const all = Object.fromEntries(queues);
    writes = writes
      .then(() => storage.set({ [STORAGE_KEY]: all }))
      .catch(err => queueLog.warn('Queue mirror write failed', { error: String(err) }));
    broadcastToChat(chatId, { ...snapshot(chatId) });
  };

  const startRun = (...args: Parameters<typeof handleLLMStream>) => {
    keepAlive.acquire();
    handleLLMStream(...args)
      .catch(err => queueLog.error('Queued turn failed', { error: String(err) }))
      .finally(() => keepAlive.release());
  };

  const dispatchNext = async (chatId: string): Promise<void> => {
    if (dispatching.has(chatId) || isLLMStreamRunning(chatId)) return;
    const pending = queues.get(chatId);
    if (!pending?.items.length || pending.pauseReason) return;
    dispatching.add(chatId);
    let userMessage: ChatMessage | undefined;
    try {
      const [chat, history] = await Promise.all([getChat(chatId), getMessagesByChatId(chatId)]);
      if (!chat) {
        commit(chatId, []);
        return;
      }
      // The queue or the chat may have changed while the history was loading.
      const state = queues.get(chatId);
      const item = state?.items[0];
      if (!state || !item || state.pauseReason || isLLMStreamRunning(chatId)) return;
      commit(chatId, state.items.slice(1));
      userMessage = queuedToUserMessage(
        item,
        chatId,
        Math.max(Date.now(), (history.at(-1)?.createdAt ?? 0) + 1),
      );
      // handleLLMStream registers the run synchronously, before any other request can.
      startRun(undefined, {
        type: 'LLM_REQUEST',
        chatId,
        messages: [...(history as unknown as ChatMessage[]), userMessage],
        model: item.model,
        assistantMessageId: crypto.randomUUID(),
      });
    } catch (err) {
      queueLog.error('Queue dispatch failed', { chatId, error: String(err) });
    } finally {
      dispatching.delete(chatId);
    }
    if (!userMessage) return;
    try {
      await addMessage(userMessage);
      await touchChat(chatId);
    } catch (err) {
      queueLog.warn('Queued message persist failed', { chatId, error: String(err) });
    }
  };

  /** Hands the next steering message to the running turn, one per checkpoint. */
  const takeSteering = (chatId: string): QueuedChatMessage[] => {
    const state = queues.get(chatId);
    const item = state?.items.find(i => i.mode === 'steer');
    if (!state || !item) return [];
    commit(
      chatId,
      state.items.filter(i => i !== item),
      state.pauseReason,
    );
    return [item];
  };

  const settle = ({ chatId, outcome, unsentSteering }: SettledRun) => {
    const state = queues.get(chatId);
    if (!state && unsentSteering.length === 0) return;
    const items = state?.items ?? [];
    // After Stop then Send, steering added since belongs to the newer run.
    const leftover = isLLMStreamRunning(chatId) ? [] : items.filter(i => i.mode === 'steer');
    const heads = [...unsentSteering, ...leftover].map(asQueued);
    const rest = items.filter(i => !leftover.includes(i));
    let pauseReason = state?.pauseReason;
    if (outcome === 'stopped') pauseReason = 'stopped';
    else if (outcome === 'error') pauseReason = 'error';
    // A steering message that missed its turn is sent next, even from a paused queue.
    else if (heads.length > 0) pauseReason = undefined;
    commit(chatId, [...heads, ...rest], pauseReason);
    void dispatchNext(chatId);
  };

  const onSettled = (run: SettledRun) => {
    void ready.then(() => settle(run));
  };

  const handleCommand = async (command: LLMQueueCommand): Promise<void> => {
    await ready;
    const { chatId } = command;
    const items = queues.get(chatId)?.items ?? [];
    const pauseReason = queues.get(chatId)?.pauseReason;
    const running = isLLMStreamRunning(chatId);
    switch (command.type) {
      case 'LLM_QUEUE_ADD': {
        const { item } = command;
        const rejected =
          !item.text.trim() ||
          items.length >= MAX_QUEUED_MESSAGES ||
          items.some(i => i.id === item.id);
        // Resend the current state so a view that raced past the limit resyncs.
        if (rejected) broadcastToChat(chatId, { ...snapshot(chatId) });
        else commit(chatId, [...items, running ? item : asQueued(item)], pauseReason);
        break;
      }
      case 'LLM_QUEUE_REMOVE':
        commit(
          chatId,
          items.filter(i => i.id !== command.itemId),
          pauseReason,
        );
        break;
      case 'LLM_QUEUE_CLEAR':
        commit(chatId, []);
        break;
      case 'LLM_QUEUE_RESTORE': {
        const present = new Set(items.map(i => i.id));
        const restored = command.items
          .filter(i => !present.has(i.id))
          .map(i => (running ? i : asQueued(i)));
        commit(
          chatId,
          [...restored, ...items].slice(0, MAX_QUEUED_MESSAGES),
          pauseReason ?? command.pauseReason,
        );
        break;
      }
      case 'LLM_QUEUE_STEER': {
        const item = items.find(i => i.id === command.itemId);
        if (!item) break;
        if (running)
          commit(
            chatId,
            items.map(i => (i === item ? { ...i, mode: 'steer' } : i)),
            pauseReason,
          );
        // Without a running turn there is nothing to steer: send it next instead.
        else commit(chatId, [asQueued(item), ...items.filter(i => i !== item)]);
        break;
      }
      case 'LLM_QUEUE_RESUME':
        commit(chatId, items);
        break;
    }
    await dispatchNext(chatId);
  };

  /** Stops the running turn, or pauses a queue caught between two turns. */
  const stop = async (chatId: string, assistantMessageId?: string): Promise<void> => {
    if (stopLLMStream(chatId, assistantMessageId)) return;
    await ready;
    if (isLLMStreamRunning(chatId)) return;
    const state = queues.get(chatId);
    if (state && !state.pauseReason) commit(chatId, state.items, 'stopped');
  };

  const sendSnapshot = async (port: Pick<chrome.runtime.Port, 'postMessage'>, chatId: string) => {
    await ready;
    try {
      port.postMessage(snapshot(chatId));
    } catch {
      // The view closed before its queue arrived.
    }
  };

  return { handleCommand, takeSteering, onSettled, stop, sendSnapshot, ready };
};

type ChatQueue = ReturnType<typeof createChatQueue>;

export { createChatQueue };
export type { ChatQueue, ChatQueueDeps };
