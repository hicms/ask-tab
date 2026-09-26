import type { ChatMessagePart } from './chat-types.js';

/** A stopped tool has no confirmed result; do not display it as still running. */
export const markInterruptedToolCalls = (parts: ChatMessagePart[]): ChatMessagePart[] =>
  parts.map(part =>
    part.type === 'tool-call' && part.state !== 'output-available' && part.state !== 'output-error'
      ? {
          ...part,
          state: 'output-error',
          result: 'Stopped before a result was received. The action may already have taken effect.',
        }
      : part,
  );
