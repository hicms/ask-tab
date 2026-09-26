/**
 * Session transcript indexing — indexes past conversation transcripts
 * into memory chunks so memory_search can recall past conversations.
 */

import { chunkText } from './memory-chunker';
import { invalidateMemoryIndex } from './memory-sync';
import { serializeTranscript } from './serialize-transcript';
import { createLogger } from '../logging/logger-buffer';
import {
  getChat,
  getMessagesByChatId,
  deleteMemoryChunksByChatId,
  bulkPutMemoryChunks,
} from '@extension/storage';
import { nanoid } from 'nanoid';
import type { DbMemoryChunk } from '@extension/storage';

const transcriptLog = createLogger('journal');

const MIN_MESSAGES_FOR_INDEX = 4;

/**
 * Generate a synthetic fileId for transcript chunks linked to a chat.
 */
const transcriptFileId = (chatId: string): string => `transcript:${chatId}`;

/**
 * Generate a synthetic filePath for transcript chunks.
 * Uses format: transcript/YYYY-MM-DD/chatId-title.md
 * This allows temporal-decay's extractDateFromPath to work.
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
 * Index a session transcript into memory chunks.
 *
 * 1. Load chat + messages (skip if < MIN_MESSAGES_FOR_INDEX messages)
 * 2. Serialize transcript
 * 3. Delete existing transcript chunks for this chatId (idempotent re-index)
 * 4. Chunk with chunkText()
 * 5. Store as DbMemoryChunk with chatId + synthetic filePath
 * 6. Invalidate memory index
 */
const indexSessionTranscript = async (
  chatId: string,
  agentId?: string,
): Promise<{ chunksCreated: number }> => {
  const chat = await getChat(chatId);
  if (!chat) {
    transcriptLog.trace('transcript index: skipped', { chatId, reason: 'chat not found' });
    return { chunksCreated: 0 };
  }

  const messages = await getMessagesByChatId(chatId);
  if (messages.length < MIN_MESSAGES_FOR_INDEX) {
    transcriptLog.trace('transcript index: skipped', {
      chatId,
      reason: `too few messages (${messages.length})`,
    });
    return { chunksCreated: 0 };
  }

  const transcript = serializeTranscript(messages, 16_000); // larger window for indexing
  if (!transcript) {
    transcriptLog.trace('transcript index: skipped', { chatId, reason: 'empty transcript' });
    return { chunksCreated: 0 };
  }

  // Delete existing transcript chunks for idempotent re-indexing
  await deleteMemoryChunksByChatId(chatId);

  const dateStr = new Date(chat.createdAt).toISOString().split('T')[0]!;
  const fileId = transcriptFileId(chatId);
  const filePath = transcriptFilePath(chatId, chat.title, dateStr);
  const now = Date.now();

  const textChunks = await chunkText(transcript);

  const dbChunks: DbMemoryChunk[] = textChunks.map(chunk => ({
    id: nanoid(),
    fileId,
    filePath,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    text: chunk.text,
    fileUpdatedAt: now,
    contentHash: chunk.contentHash,
    chatId,
    ...(agentId ? { agentId } : {}),
  }));

  if (dbChunks.length > 0) {
    await bulkPutMemoryChunks(dbChunks);
    invalidateMemoryIndex(agentId);
  }

  transcriptLog.trace('transcript index: completed', {
    chatId,
    filePath,
    chunksCreated: dbChunks.length,
    transcriptLength: transcript.length,
  });

  return { chunksCreated: dbChunks.length };
};

export { indexSessionTranscript, transcriptFileId, transcriptFilePath, MIN_MESSAGES_FOR_INDEX };
