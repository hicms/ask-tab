import type { ChatMessagePart, ChatModel } from './chat-types.js';

// ──────────────────────────────────────────────
// Pending messages submitted while a chat turn is running
// ──────────────────────────────────────────────

/** `queue` starts its own turn after the current one; `steer` joins the running turn. */
type QueuedMessageMode = 'queue' | 'steer';

interface QueuedChatMessage {
  /** Becomes the user message ID once the text is sent or injected. */
  id: string;
  text: string;
  mode: QueuedMessageMode;
  /** Model selected when the message was queued. */
  model: ChatModel;
  createdAt: number;
}

type ChatQueuePauseReason = 'stopped' | 'error' | 'restarted';

/** A queue is paused exactly when `pauseReason` is set; an empty queue is never paused. */
interface ChatQueueState {
  items: QueuedChatMessage[];
  pauseReason?: ChatQueuePauseReason;
}

const MAX_QUEUED_MESSAGES = 20;

/** Tool result recorded for tool calls abandoned because a steering message arrived. */
const SKIPPED_TOOL_RESULT = 'Skipped due to queued user message.';

const isSkippedToolCall = (part: ChatMessagePart): boolean =>
  (part.type === 'tool-call' || part.type === 'tool-result') &&
  part.state === 'output-error' &&
  part.result === SKIPPED_TOOL_RESULT;

// ── Port protocol ─────────────────────────────

/** Background -> UI whenever a chat's queue changes, and on subscription. */
interface LLMQueueSnapshot extends ChatQueueState {
  type: 'LLM_QUEUE_SNAPSHOT';
  chatId: string;
}

/** UI -> background queue commands. */
type LLMQueueCommand =
  | { type: 'LLM_QUEUE_ADD'; chatId: string; item: QueuedChatMessage }
  | { type: 'LLM_QUEUE_REMOVE'; chatId: string; itemId: string }
  | { type: 'LLM_QUEUE_CLEAR'; chatId: string }
  | {
      type: 'LLM_QUEUE_RESTORE';
      chatId: string;
      items: QueuedChatMessage[];
      pauseReason?: ChatQueuePauseReason;
    }
  | { type: 'LLM_QUEUE_STEER'; chatId: string; itemId: string }
  | { type: 'LLM_QUEUE_RESUME'; chatId: string }
  /** Takes a message out of the queue to edit it in the composer of the view that asked. */
  | { type: 'LLM_QUEUE_EDIT'; chatId: string; itemId: string };

/** Background -> only the view that sent `LLM_QUEUE_EDIT`, once the message has left the queue. */
interface LLMQueueEditText {
  type: 'LLM_QUEUE_EDIT_TEXT';
  chatId: string;
  text: string;
}

export type {
  QueuedMessageMode,
  QueuedChatMessage,
  ChatQueuePauseReason,
  ChatQueueState,
  LLMQueueSnapshot,
  LLMQueueCommand,
  LLMQueueEditText,
};
export { MAX_QUEUED_MESSAGES, SKIPPED_TOOL_RESULT, isSkippedToolCall };
