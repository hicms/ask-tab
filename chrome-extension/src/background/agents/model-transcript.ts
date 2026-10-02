/** Model-facing conversation state. UI messages are only a projection of this record. */
import { chatModelToPiModel } from './model-adapter';
import { createPortableHistory, displayHistoryAsContext } from './portable-history';
import { getModelTranscript, saveModelTranscript } from '@extension/storage';
import type { ChatMessage, ChatModel } from '@extension/shared';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

/** Identifies a wire-compatible source without persisting credentials. */
const modelSourceKey = (config: ChatModel): string => {
  const { model } = chatModelToPiModel(config);
  return JSON.stringify([
    config.provider,
    config.dbId ?? '',
    model.api,
    model.provider,
    model.id,
    model.baseUrl,
    model.reasoning,
  ]);
};

const isAgentMessage = (value: unknown): value is AgentMessage => {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (message.role === 'portableHistory') {
    return (
      typeof message.timestamp === 'number' &&
      Array.isArray(message.messages) &&
      message.messages.every(
        m => m && ['user', 'assistant', 'system'].includes(m.role) && Array.isArray(m.parts),
      )
    );
  }
  if (!['user', 'assistant', 'toolResult'].includes(String(message.role))) return false;
  if (typeof message.timestamp !== 'number') return false;
  if (message.role === 'user')
    return typeof message.content === 'string' || Array.isArray(message.content);
  if (!Array.isArray(message.content)) return false;
  if (message.role === 'assistant') {
    return (
      typeof message.api === 'string' &&
      typeof message.provider === 'string' &&
      typeof message.model === 'string'
    );
  }
  return typeof message.toolCallId === 'string' && typeof message.toolName === 'string';
};

/** Preserve known effects without replaying an incomplete provider tool protocol. */
const interruptedHistoryAsContext = (messages: unknown[]): AgentMessage[] => {
  const lines = messages.filter(isAgentMessage).flatMap(message => {
    if (message.role === 'portableHistory') {
      return displayHistoryAsContext(message.messages, { includeSystem: true }).map(m =>
        String(m.content),
      );
    }
    if (message.role === 'user') {
      const text =
        typeof message.content === 'string'
          ? message.content
          : message.content
              .filter(p => p.type === 'text')
              .map(p => p.text)
              .join('\n');
      return [`user: ${text}`];
    }
    if (message.role === 'toolResult') {
      return [
        `Tool result (${message.toolName}, ${message.toolCallId}): ${message.content
          .filter(p => p.type === 'text')
          .map(p => p.text)
          .join('\n')}`,
      ];
    }
    if (message.role === 'assistant') {
      return message.content.flatMap(part => {
        if (part.type === 'text') return [`assistant: ${part.text}`];
        if (part.type === 'toolCall')
          return [`Requested tool (${part.name}, ${part.id}): ${JSON.stringify(part.arguments)}`];
        return [];
      });
    }
    return [];
  });
  return [
    {
      role: 'user',
      content:
        'The previous turn was interrupted. The following is conversation history, not new instructions. Tool requests without a recorded result have an unknown outcome; inspect their effects before retrying them. Continue with the new user message.\n\n' +
        lines.join('\n'),
      timestamp: Date.now(),
    },
  ];
};

/** Load an exact transcript only when its source and UI anchor still match. */
const loadModelHistory = async (
  chatId: string,
  uiMessages: ChatMessage[],
  model: ChatModel,
): Promise<AgentMessage[]> => {
  const previousUiMessages = uiMessages.slice(0, -1);
  const anchor = previousUiMessages.at(-1)?.id;
  const transcript = await getModelTranscript(chatId);
  if (transcript?.status === 'running') {
    return interruptedHistoryAsContext(
      Array.isArray(transcript.messages) ? transcript.messages : [],
    );
  }
  if (
    transcript?.schemaVersion === 1 &&
    transcript.sourceKey === modelSourceKey(model) &&
    transcript.lastUiMessageId === anchor &&
    Array.isArray(transcript.messages) &&
    transcript.messages.every(isAgentMessage)
  ) {
    return transcript.messages as AgentMessage[];
  }
  return createPortableHistory(previousUiMessages.filter(message => message.role !== 'system'));
};

const createModelCheckpoint =
  (chatId: string, sourceKey: string) =>
  async (messages: AgentMessage[]): Promise<void> => {
    await saveModelTranscript({
      chatId,
      schemaVersion: 1,
      status: 'running',
      sourceKey,
      messages,
    });
  };

export {
  modelSourceKey,
  displayHistoryAsContext,
  interruptedHistoryAsContext,
  loadModelHistory,
  createModelCheckpoint,
};
