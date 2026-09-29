import { chatMessagesToPiMessages } from './message-adapter';
import type { ChatMessage, QueuedChatMessage } from '@extension/shared';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

const queuedToUserMessage = (
  item: QueuedChatMessage,
  chatId: string,
  createdAt: number,
): ChatMessage => ({
  id: item.id,
  chatId,
  role: 'user',
  parts: [{ type: 'text', text: item.text }],
  createdAt,
});

type EntryState = 'offered' | 'injected' | 'replay';

interface SteeringEntry {
  item: QueuedChatMessage;
  message: AgentMessage;
  state: EntryState;
}

/**
 * Tracks the steering messages of one run. An item taken from the chat queue is
 * "offered" to the agent loop until it appears in the context; anything never
 * injected is handed back when the run settles, so a message is never lost.
 */
const createRunSteering = (chatId: string, take: () => QueuedChatMessage[]) => {
  const entries: SteeringEntry[] = [];

  const poll = (): AgentMessage[] => {
    const replayed = entries.filter(entry => entry.state === 'replay');
    for (const entry of replayed) entry.state = 'offered';
    const fresh = take().map(item => {
      const [message] = chatMessagesToPiMessages([queuedToUserMessage(item, chatId, Date.now())]);
      const entry: SteeringEntry = { item, message: message!, state: 'offered' };
      entries.push(entry);
      return entry;
    });
    return [...replayed, ...fresh].map(entry => entry.message);
  };

  /** Returns the queue item when `message` is one of this run's offered steering messages. */
  const markInjected = (message: AgentMessage): QueuedChatMessage | undefined => {
    const entry = entries.find(e => e.message === message && e.state === 'offered');
    if (!entry) return undefined;
    entry.state = 'injected';
    return entry.item;
  };

  /** A context-overflow retry restarts from the original prompt, so every message is offered again. */
  const rewind = () => {
    for (const entry of entries) entry.state = 'replay';
  };

  const unsent = (): QueuedChatMessage[] =>
    entries.filter(entry => entry.state !== 'injected').map(entry => entry.item);

  return { poll, markInjected, rewind, unsent };
};

type RunSteering = ReturnType<typeof createRunSteering>;

export { createRunSteering, queuedToUserMessage };
export type { RunSteering };
