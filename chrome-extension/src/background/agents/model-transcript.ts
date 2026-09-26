/** Model-facing conversation state. UI messages are only a projection of this record. */
import { chatModelToPiModel } from './model-adapter';
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

/**
 * Model changes or compacted history need portable context. Describe display
 * messages as user-provided context without inventing tool wire messages.
 */
const displayHistoryAsContext = (
  history: ChatMessage[],
  options: { includeSystem?: boolean } = {},
): AgentMessage[] => {
  const lines: string[] = [];
  for (const message of history) {
    if (message.role === 'system' && !options.includeSystem) continue;
    const details = message.parts.flatMap(part => {
      if (part.type === 'text') return [part.text];
      if (part.type === 'tool-call')
        return [`Tool call: ${part.toolName} ${JSON.stringify(part.args)}`];
      if (part.type === 'tool-result')
        return [`Tool result (${part.toolName}): ${JSON.stringify(part.result)}`];
      if (part.type === 'file') return [`File: ${part.filename ?? part.mediaType ?? 'attachment'}`];
      return []; // Reasoning is not portable conversation content.
    });
    if (details.length) lines.push(`${message.role}: ${details.join('\n')}`);
  }
  if (!lines.length) return [];
  return [
    {
      role: 'user',
      content: `Previous conversation context:\n${lines.join('\n\n')}`,
      timestamp: history.at(-1)?.createdAt ?? Date.now(),
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
    throw new Error(
      'Previous model turn was interrupted. Review its tool effects before continuing this chat.',
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
  return displayHistoryAsContext(previousUiMessages);
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

export { modelSourceKey, displayHistoryAsContext, loadModelHistory, createModelCheckpoint };
