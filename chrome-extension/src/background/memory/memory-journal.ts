/**
 * Session-end journal agent — extracts durable memories when a chat session ends.
 *
 * Pre-compaction flush is now handled by memory-flush.ts. This module handles only the session-end case (user switches chats).
 *
 * Searches existing memories first for dedup context, then calls completeText
 * to extract new durable memories from the conversation transcript.
 */

import { serializeTranscript } from './serialize-transcript';
import { indexSessionTranscript } from './transcript-indexing';
import { completeText } from '../agents/stream-bridge';
import { createLogger } from '../logging/logger-buffer';
import { executeMemorySearch } from '../tools/memory-tools';
import { executeWrite } from '../tools/workspace';
import {
  serverModelsStorage,
  getChat,
  getMessagesByChatId,
  listWorkspaceFiles,
  selectedModelStorage,
} from '@extension/storage';
import type { ChatModel } from '@extension/shared';

const journalLog = createLogger('journal');

// ── Dedup guard ──────────────────────────────────
// Prevents double-journaling on rapid new-chat/switch sequences.

const COOLDOWN_MS = 60_000;
const recentlyJournaled = new Map<string, number>();

const isRecentlyJournaled = (chatId: string): boolean => {
  const ts = recentlyJournaled.get(chatId);
  if (!ts) return false;
  if (Date.now() - ts > COOLDOWN_MS) {
    recentlyJournaled.delete(chatId);
    return false;
  }
  return true;
};

const markJournaled = (chatId: string): void => {
  recentlyJournaled.set(chatId, Date.now());
  // Prune old entries to prevent unbounded growth
  if (recentlyJournaled.size > 100) {
    const now = Date.now();
    for (const [id, ts] of recentlyJournaled) {
      if (now - ts > COOLDOWN_MS) recentlyJournaled.delete(id);
    }
  }
};

// ── MEMORY.md curation ──────────────────────────

const MEMORY_CURATION_TIMEOUT_MS = 20_000;
const MEMORY_MD_PATH = 'MEMORY.md';

/**
 * Read current MEMORY.md content for the given agent.
 */
const readCurrentMemoryMd = async (agentId?: string): Promise<string> => {
  const files = await listWorkspaceFiles(agentId);
  const memoryFile = files.find(f => f.name === MEMORY_MD_PATH);
  return memoryFile?.content || '';
};

/**
 * Best-effort curation of MEMORY.md after a journal entry is written.
 *
 * Sends the current MEMORY.md + new journal entry to the LLM and asks it to
 * produce an updated (not appended) MEMORY.md that integrates new learnings
 * while keeping the file concise.
 */
const curateMemoryMd = async (
  modelConfig: ChatModel,
  journalEntry: string,
  agentId?: string,
): Promise<void> => {
  const currentContent = await readCurrentMemoryMd(agentId);

  const curated = await Promise.race([
    completeText(
      modelConfig,
      [
        'You are a memory curator. You maintain a concise long-term memory file (MEMORY.md) for an AI assistant.',
        'Your job: integrate new learnings from a session journal into the existing MEMORY.md.',
        '',
        'Rules:',
        '- Output the COMPLETE updated MEMORY.md content (not a diff or patch)',
        '- Keep it under 4000 characters — this file is injected into every prompt',
        '- Prioritize: user preferences, important decisions, recurring patterns, key facts',
        '- Remove stale or superseded information',
        '- Use concise bullet points grouped by topic',
        '- If nothing from the new journal entry is worth adding to long-term memory, return the existing content unchanged',
        '- If existing content is empty, create a fresh MEMORY.md from the journal entry',
        '- Do NOT include session timestamps or daily log entries — those belong in memory/*.md',
      ].join('\n'),
      `Current MEMORY.md:\n${currentContent || '(empty)'}\n\nNew journal entry:\n${journalEntry}`,
      { maxTokens: 1500 },
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('MEMORY.md curation timeout')), MEMORY_CURATION_TIMEOUT_MS),
    ),
  ]);

  const trimmed = curated.trim();
  if (trimmed && trimmed !== currentContent.trim()) {
    await executeWrite({ path: MEMORY_MD_PATH, content: trimmed, mode: 'overwrite' }, agentId);
    journalLog.info('MEMORY.md curated', { agentId });
  }
};

// ── Model resolution ─────────────────────────────

const resolveCurrentModel = async (): Promise<ChatModel | undefined> => {
  const [storedModels, selectedId] = await Promise.all([
    serverModelsStorage.get(),
    selectedModelStorage.get(),
  ]);

  const models = storedModels.map(m => ({
    id: m.modelId || m.id,
    name: m.name,
    provider: m.provider,
    supportsTools: m.supportsTools,
  })) as ChatModel[];

  if (models.length === 0) return undefined;

  return models.find(m => m.id === selectedId) ?? models[0];
};

// ── Journal options ──────────────────────────────

interface SessionJournalOptions {
  chatId: string;
  /** If provided, uses this model config instead of resolving from storage. */
  modelConfig?: ChatModel;
  /** Pre-serialized transcript (skips loading messages from DB). */
  transcript?: string;
  /** Agent ID for scoping workspace writes. */
  agentId?: string;
}

// ── Result type ──────────────────────────────────
// 'written'  — LLM ran and produced a journal entry
// 'no-op'    — LLM ran but returned NO_REPLY (nothing worth saving)
// 'skipped'  — journal was not attempted (dedup cooldown, no model, too few messages, etc.)

type JournalResult = 'written' | 'no-op' | 'skipped';

// ── Error helpers ────────────────────────────────

const isTransientError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  if (msg.includes('Invalid JSON response')) return true;
  if (msg.includes('aborted')) return false; // timeout — don't retry
  // Check for statusCode property from AI SDK errors
  const statusCode = (err as unknown as Record<string, unknown>).statusCode;
  if (typeof statusCode === 'number') {
    return statusCode >= 500 || statusCode === 408;
  }
  // Network errors
  if (msg.includes('fetch failed') || msg.includes('ECONNRESET')) return true;
  return false;
};

const summarizeError = (err: unknown): Record<string, unknown> => {
  if (!(err instanceof Error)) return { message: String(err) };
  const details: Record<string, unknown> = { message: err.message };
  const cast = err as unknown as Record<string, unknown>;
  if (cast.statusCode) details.statusCode = cast.statusCode;
  if (typeof cast.responseBody === 'string') {
    details.responseBody = cast.responseBody.slice(0, 200);
  }
  return details;
};

// ── Main journal function ────────────────────────

const runSessionJournal = async (options: SessionJournalOptions): Promise<JournalResult> => {
  const { chatId } = options;

  // Dedup guard
  if (isRecentlyJournaled(chatId)) {
    journalLog.debug('Skipped — recently journaled', { chatId });
    return 'skipped';
  }

  try {
    // Resolve model
    const modelConfig = options.modelConfig ?? (await resolveCurrentModel());
    if (!modelConfig) {
      journalLog.debug('Skipped — no model configured', { chatId });
      return 'skipped';
    }

    // Build transcript if not provided
    let transcript = options.transcript;
    if (!transcript) {
      const messages = await getMessagesByChatId(chatId);
      if (messages.length < 4) {
        journalLog.debug('Skipped — too few messages', { chatId, count: messages.length });
        return 'skipped';
      }
      transcript = serializeTranscript(messages);
      if (!transcript) {
        journalLog.debug('Skipped — empty transcript', { chatId });
        return 'skipped';
      }
    }

    // Get chat title for context
    const chatRecord = await getChat(chatId);
    const title = chatRecord?.title ?? 'Untitled';

    // Pre-search existing memories for dedup context using the chat title
    const searchQuery = title !== 'Untitled' ? title : transcript.slice(0, 200);
    let existingMemories = '';
    try {
      existingMemories = await executeMemorySearch({ query: searchQuery, maxResults: 5 });
    } catch {
      // Memory search failed — proceed without dedup context
    }

    // Build dedup context section
    const dedupSection =
      existingMemories && existingMemories !== 'No matching memory found.'
        ? `\n\nExisting memories (DO NOT duplicate these):\n${existingMemories}`
        : '';

    const callWithTimeout = async () => {
      const result = await Promise.race([
        completeText(
          modelConfig,
          'You are a memory journal agent. Review the conversation transcript and extract durable memories worth preserving (facts, decisions, user preferences, context). Be concise — bullet points preferred. Do NOT duplicate any existing memories shown. If nothing new is worth saving, reply with exactly NO_REPLY.',
          `Session "${title}" (trigger: session-end):\n\n${transcript}${dedupSection}\n\nExtract durable memories from this conversation. Only include NEW information not already in existing memories.`,
          { maxTokens: 500 },
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Journal LLM timeout')), 30_000),
        ),
      ]);
      return result.trim();
    };

    let flushText: string;
    try {
      flushText = await callWithTimeout();
    } catch (firstErr) {
      if (isTransientError(firstErr)) {
        journalLog.debug('Retrying after transient error', {
          chatId,
          error: summarizeError(firstErr),
        });
        await new Promise(r => setTimeout(r, 1_000));
        flushText = await callWithTimeout();
      } else {
        throw firstErr;
      }
    }

    const isNoReply = flushText.startsWith('NO_REPLY') || flushText.endsWith('NO_REPLY');

    if (!flushText || isNoReply) {
      journalLog.debug('Journal returned NO_REPLY', { chatId });
      markJournaled(chatId);
      return 'no-op';
    }

    // Write to memory/YYYY-MM-DD.md
    const date = new Date().toISOString().split('T')[0];
    await executeWrite(
      {
        path: `memory/${date}.md`,
        content: `\n\n---\n## Session journal — ${title} (${new Date().toISOString()})\n${flushText}`,
        mode: 'append',
      },
      options.agentId,
    );

    // Best-effort MEMORY.md curation — don't fail the journal if this errors
    try {
      await curateMemoryMd(modelConfig, flushText, options.agentId);
    } catch (err) {
      journalLog.debug('MEMORY.md curation skipped', {
        chatId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Best-effort transcript indexing — index conversation into memory search
    try {
      const indexResult = await indexSessionTranscript(chatId, options.agentId);
      if (indexResult.chunksCreated > 0) {
        journalLog.debug('Transcript indexed', { chatId, chunks: indexResult.chunksCreated });
      }
    } catch (err) {
      journalLog.debug('Transcript indexing skipped', {
        chatId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    markJournaled(chatId);
    journalLog.info('Journal entry written', { chatId, date });
    return 'written';
  } catch (err) {
    const details = summarizeError(err);
    journalLog.warn('Session journal failed', { chatId, ...details });
    return 'skipped';
  }
};

export { runSessionJournal };
export type { JournalResult };
