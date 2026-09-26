/**
 * Session transcript indexing — uploads past conversation transcripts to the
 * memory service so memory_search can recall past conversations.
 */

import { DEFAULT_AGENT_ID, uploadTranscript } from './memory-service';
import { serializeTranscript } from './serialize-transcript';
import { createLogger } from '../logging/logger-buffer';
import { getChat, getMessagesByChatId } from '@extension/storage';

const transcriptLog = createLogger('journal');

const MIN_MESSAGES_FOR_INDEX = 4;

/**
 * Uses format: transcript/YYYY-MM-DD/chatId-title.md. The server derives the
 * recency decay date from the path.
 */
const transcriptFilePath = (chatId: string, title: string, dateStr: string): string => {
  // Sanitize title for use in path (remove special chars, truncate)
  const safeTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `transcript/${dateStr}/${chatId}-${safeTitle || 'untitled'}.md`;
};

/**
 * Upload a session transcript to the chat's agent memory. Re-uploading the same
 * chat replaces its previous transcript on the server.
 */
const indexSessionTranscript = async (chatId: string): Promise<{ indexed: boolean }> => {
  const chat = await getChat(chatId);
  if (!chat) {
    transcriptLog.trace('transcript index: skipped', { chatId, reason: 'chat not found' });
    return { indexed: false };
  }

  const messages = await getMessagesByChatId(chatId);
  if (messages.length < MIN_MESSAGES_FOR_INDEX) {
    transcriptLog.trace('transcript index: skipped', {
      chatId,
      reason: `too few messages (${messages.length})`,
    });
    return { indexed: false };
  }

  const transcript = serializeTranscript(messages, 16_000); // larger window for indexing
  if (!transcript) {
    transcriptLog.trace('transcript index: skipped', { chatId, reason: 'empty transcript' });
    return { indexed: false };
  }

  const dateStr = new Date(chat.createdAt).toISOString().split('T')[0]!;
  const path = transcriptFilePath(chatId, chat.title, dateStr);

  // Memory sync prunes transcripts by the chat's own agent, so upload under the same key.
  await uploadTranscript(chat.agentId || DEFAULT_AGENT_ID, {
    chatId,
    path,
    content: transcript,
  });

  transcriptLog.trace('transcript index: completed', {
    chatId,
    path,
    transcriptLength: transcript.length,
  });

  return { indexed: true };
};

export { indexSessionTranscript, transcriptFilePath, MIN_MESSAGES_FOR_INDEX };
