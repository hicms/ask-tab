import { getEffectiveContextLimit } from './limits';
import { summarizeMessages, summarizeInStages, shouldUseAdaptiveCompaction } from './summarizer';
import {
  stripToolResultDetails,
  repairToolUseResultPairing,
  repairTranscript,
} from './tool-result-sanitization';
import { truncateToolResultText } from './tool-result-truncation';
import { createLogger } from '../logging/logger-buffer';
import type { SummarizerOptions } from './summarizer';
import type { ChatMessage, ChatMessagePart, ChatModel, CompactionConfig } from '@extension/shared';

const compactionLog = createLogger('stream');

/**
 * Maximum share of the effective context window that a single tool-result
 * part is allowed to occupy. Results exceeding this are truncated before
 * any budget calculation runs, preventing a single oversized browser
 * snapshot from starving the recent-message budget.
 */
const MAX_TOOL_RESULT_CONTEXT_SHARE = 0.3;

/**
 * Minimum number of recent messages to preserve during compaction.
 * Even if these messages exceed the remaining budget, they are force-kept
 * to prevent the catastrophic `recentMessages: 0` scenario.
 */
const MIN_RECENT_MESSAGES = 4;

/**
 * Safety margin applied to token estimates before budget comparison.
 * Triggers compaction earlier, preventing context overflow rejections
 * from providers when our heuristic underestimates actual token count.
 * With the conservative 3 chars/token estimation, 1.25x is sufficient.
 */
const TOKEN_SAFETY_MARGIN = 1.25;

/** Absolute cap on a single tool result regardless of model context.
 * 100K chars ≈ 25-33K tokens — keeps a single result from exceeding
 * a quarter of most models' context windows.
 */
const HARD_MAX_TOOL_RESULT_CHARS = 50_000;

/**
 * Maximum share of the context budget that historical messages (non-recent)
 * can occupy. Prevents a single huge assistant response from consuming the
 * entire context and starving the summarizable history.
 */
const MAX_HISTORY_SHARE = 0.5;

/** Minimum chars to preserve when truncating — avoids over-aggressive cuts. */
const MIN_KEEP_CHARS = 2000;

/**
 * Conservative chars-per-token for budget calculations.
 * Standard English averages ~4 chars/token, but JSON keys, code syntax,
 * and structured data average ~2.5-3 chars/token. Using 3 prevents
 * underestimating token counts for tool-heavy conversations.
 */
const CHARS_PER_TOKEN_BUDGET = 3;

/**
 * Conservative chars-per-token for token estimation.
 * Standard English prose averages ~4 chars/token, but tool results contain
 * JSON keys, URLs, HTTP headers, code syntax, and structured data that
 * tokenize at ~2.5-3 chars/token. Using 3 prevents systematic underestimation
 * that leads to context overflow when the provider counts the real tokens.
 */
const CHARS_PER_TOKEN_ESTIMATE = 3;

/**
 * Truncate tool-result parts within a single message to fit a total char budget.
 * Distributes the budget proportionally across tool-result parts, truncating
 * the largest results first.
 */
const truncateMessageToolResults = (message: ChatMessage, totalCharBudget: number): ChatMessage => {
  // Calculate current non-tool-result chars and tool-result sizes
  let nonToolChars = 0;
  const toolResultIndices: number[] = [];
  const toolResultSizes: number[] = [];

  for (let i = 0; i < message.parts.length; i++) {
    const part = message.parts[i]!;
    if (part.type === 'tool-result') {
      const str = typeof part.result === 'string' ? part.result : JSON.stringify(part.result);
      toolResultIndices.push(i);
      toolResultSizes.push(str.length);
    } else if (part.type === 'text' || part.type === 'reasoning') {
      nonToolChars += part.text.length;
    } else if (part.type === 'tool-call') {
      nonToolChars += JSON.stringify(part.args).length;
    }
  }

  if (toolResultIndices.length === 0) return message;

  const toolBudget = Math.max(0, totalCharBudget - nonToolChars);
  const totalToolChars = toolResultSizes.reduce((a, b) => a + b, 0);
  if (totalToolChars <= toolBudget) return message;

  // Distribute budget proportionally across tool results
  const ratio = toolBudget / totalToolChars;
  const newParts = [...message.parts];
  for (let j = 0; j < toolResultIndices.length; j++) {
    const idx = toolResultIndices[j]!;
    const part = newParts[idx]!;
    if (part.type !== 'tool-result') continue;
    const str = typeof part.result === 'string' ? part.result : JSON.stringify(part.result);
    const maxChars = Math.max(MIN_KEEP_CHARS, Math.floor(toolResultSizes[j]! * ratio));
    if (str.length > maxChars) {
      newParts[idx] = { ...part, result: truncateToolResultText(str, maxChars) };
    }
  }

  return { ...message, parts: newParts };
};

/**
 * Truncate tool-result parts that exceed a share of the effective context.
 * Returns a shallow copy with oversized results trimmed.
 */
const truncateOversizedToolResults = (
  messages: ChatMessage[],
  modelId: string,
  contextWindowOverride?: number,
): ChatMessage[] => {
  const computed = Math.floor(
    getEffectiveContextLimit(modelId, contextWindowOverride) * MAX_TOOL_RESULT_CONTEXT_SHARE * 4,
  );
  const maxChars = Math.min(computed, HARD_MAX_TOOL_RESULT_CHARS);
  return messages.map(msg => {
    const hasOversized = msg.parts.some(part => {
      if (part.type !== 'tool-result') return false;
      const str = typeof part.result === 'string' ? part.result : JSON.stringify(part.result);
      return str.length > maxChars;
    });
    if (!hasOversized) return msg;
    return {
      ...msg,
      parts: msg.parts.map(part => {
        if (part.type !== 'tool-result') return part;
        const resultStr =
          typeof part.result === 'string' ? part.result : JSON.stringify(part.result);
        if (resultStr.length <= maxChars) return part;
        return { ...part, result: truncateToolResultText(resultStr, maxChars) };
      }),
    };
  });
};

const TOOL_RESULT_COMPACTION_PLACEHOLDER = '[compacted: tool output removed to free context]';

/**
 * Replace oldest tool-result contents with a placeholder until total chars
 * fit within the budget. Walks from oldest to newest so recent results are
 * preserved preferentially.
 */
const compactOldestToolResults = (messages: ChatMessage[], budgetChars: number): ChatMessage[] => {
  let totalChars = 0;
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === 'text' || part.type === 'reasoning') totalChars += part.text.length;
      else if (part.type === 'tool-call') totalChars += JSON.stringify(part.args).length;
      else if (part.type === 'tool-result') {
        const str = typeof part.result === 'string' ? part.result : JSON.stringify(part.result);
        totalChars += str.length;
      } else if (part.type === 'file') {
        // Image files: 1600 tokens × 4 chars; non-image files: 500 tokens × 4 chars
        totalChars += part.data && part.mediaType?.startsWith('image/') ? 6400 : 2000;
      }
    }
  }

  if (totalChars <= budgetChars) return messages;

  let charsNeeded = totalChars - budgetChars;
  return messages.map(msg => {
    if (charsNeeded <= 0) return msg;
    const hasToolResults = msg.parts.some(p => p.type === 'tool-result');
    if (!hasToolResults) return msg;

    return {
      ...msg,
      parts: msg.parts.map(part => {
        if (charsNeeded <= 0 || part.type !== 'tool-result') return part;
        const str = typeof part.result === 'string' ? part.result : JSON.stringify(part.result);
        if (str.length <= TOOL_RESULT_COMPACTION_PLACEHOLDER.length) return part;
        charsNeeded -= str.length - TOOL_RESULT_COMPACTION_PLACEHOLDER.length;
        return { ...part, result: TOOL_RESULT_COMPACTION_PLACEHOLDER };
      }),
    };
  });
};

/**
 * Find the index of the last user message, searching backward from `startFrom`.
 * Used to anchor the recent-message window at a user turn boundary.
 * Returns the index of the user message, or -1 if no user message found.
 */
const findLastUserMessageIndex = (messages: ChatMessage[], startFrom: number): number => {
  for (let i = startFrom; i >= 0; i--) {
    if (messages[i]!.role === 'user') return i;
  }
  return -1;
};

interface CompactionResult {
  messages: ChatMessage[];
  wasCompacted: boolean;
  compactionMethod?: 'summary' | 'sliding-window' | 'none';
  summary?: string;
  tokensBefore?: number;
  tokensAfter?: number;
  messagesDropped?: number;
  durationMs?: number;
}

/** Detect long base64 sequences in text (data URLs or JSON-embedded base64) */
const BASE64_LONG_RE = /[A-Za-z0-9+/=]{1000,}/g;

/**
 * Estimate tokens for text that may contain base64 data.
 * Base64 encodes at ~1:1 char:token ratio (not the usual 4:1),
 * causing massive underestimates if treated as normal text.
 */
const estimateTokensWithBase64Awareness = (text: string): number => {
  const matches = text.match(BASE64_LONG_RE);
  if (!matches) return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);

  let base64Chars = 0;
  for (const m of matches) base64Chars += m.length;
  const nonBase64Chars = text.length - base64Chars;

  // base64 at 1:1 ratio, non-base64 at conservative CHARS_PER_TOKEN_ESTIMATE ratio
  return base64Chars + Math.ceil(nonBase64Chars / CHARS_PER_TOKEN_ESTIMATE);
};

/**
 * Estimate token count for a single message part.
 * Uses a conservative ~3 characters per token heuristic to avoid
 * underestimating structured content (JSON, URLs, code).
 * Special handling for base64 content and image files.
 */
const estimatePartTokens = (part: ChatMessagePart): number => {
  switch (part.type) {
    case 'text':
    case 'reasoning':
      return Math.ceil(part.text.length / CHARS_PER_TOKEN_ESTIMATE);
    case 'tool-call':
      return Math.ceil(
        (part.toolName.length + JSON.stringify(part.args).length) / CHARS_PER_TOKEN_ESTIMATE,
      );
    case 'tool-result': {
      const resultStr = typeof part.result === 'string' ? part.result : JSON.stringify(part.result);
      return (
        estimateTokensWithBase64Awareness(resultStr) +
        Math.ceil(part.toolName.length / CHARS_PER_TOKEN_ESTIMATE)
      );
    }
    case 'file':
      // Image files via vision API: ~1600 tokens per image (Anthropic pricing)
      if (part.data && part.mediaType?.startsWith('image/')) return 1600;
      return 500; // Fixed overhead for non-image files
    default:
      return 0;
  }
};

/**
 * Estimate total token count for a message.
 */
const estimateMessageTokens = (message: ChatMessage): number => {
  if (message.parts.length === 0) return 4; // Minimum overhead for role + empty content
  return message.parts.reduce((sum, part) => sum + estimatePartTokens(part), 0) + 4; // +4 for role overhead
};

/**
 * Preprocess messages: truncate oversized tool results, then compact oldest
 * results if total chars exceed the char-level budget.
 */
const preprocessToolResults = (
  messages: ChatMessage[],
  modelId: string,
  systemPromptTokens: number,
  contextWindowOverride?: number,
): ChatMessage[] => {
  const afterTruncation = truncateOversizedToolResults(messages, modelId, contextWindowOverride);
  const effectiveLimit = getEffectiveContextLimit(modelId, contextWindowOverride);
  const budgetChars = Math.floor((effectiveLimit - systemPromptTokens) * CHARS_PER_TOKEN_BUDGET);
  return compactOldestToolResults(afterTruncation, budgetChars);
};

/** Repair history without merging/deduplicating the current user prompt into it. */
const repairCompactionTranscript = (messages: ChatMessage[]): ChatMessage[] => {
  const latestUser = messages.findLastIndex(
    m => m.role === 'user' && m.parts.some(p => p.type !== 'tool-result'),
  );
  if (latestUser <= 0) return repairTranscript(messages);
  return [
    ...repairTranscript(messages.slice(0, latestUser)),
    ...repairTranscript(messages.slice(latestUser)),
  ];
};

/**
 * Core sliding-window compaction on already-preprocessed messages.
 * Operates on messages that have already been through truncation and
 * oldest-result compaction — callers must preprocess first.
 */
const compactMessagesCore = (
  preprocessed: ChatMessage[],
  modelId: string,
  systemPromptTokens: number,
  contextWindowOverride?: number,
  skipRepair?: boolean,
  tokenSafetyMargin = TOKEN_SAFETY_MARGIN,
): CompactionResult => {
  const startTime = Date.now();
  const budget = getEffectiveContextLimit(modelId, contextWindowOverride) - systemPromptTokens;
  const messages = skipRepair ? preprocessed : repairCompactionTranscript(preprocessed);
  const messageSizes = messages.map(estimateMessageTokens);
  const totalTokens = messageSizes.reduce((a, b) => a + b, 0);

  const adjustedTotal = Math.ceil(totalTokens * tokenSafetyMargin);
  if (adjustedTotal <= budget) {
    return { messages, wasCompacted: false };
  }

  // Always keep the first user message as anchor
  const anchorIdx = messages.findIndex(m => m.role === 'user');
  if (anchorIdx < 0) {
    // No user message — cannot compact meaningfully
    return { messages, wasCompacted: false };
  }

  const anchorTokens = messageSizes[anchorIdx]!;
  const markerTokens = 20; // Estimate for the compaction marker

  let remainingBudget = budget - anchorTokens - markerTokens;
  if (remainingBudget <= 0) {
    const bounded = enforceHardTokenLimit(
      messages,
      modelId,
      systemPromptTokens,
      contextWindowOverride,
      tokenSafetyMargin,
    );
    return {
      messages: bounded,
      wasCompacted: true,
      compactionMethod: 'sliding-window',
      tokensBefore: totalTokens,
      tokensAfter: bounded.reduce((sum, message) => sum + estimateMessageTokens(message), 0),
      messagesDropped: messages.length - bounded.length,
      durationMs: Date.now() - startTime,
    };
  }

  // Fill from the end — but guarantee at least MIN_RECENT_MESSAGES
  const recentMessages: ChatMessage[] = [];
  for (let i = messages.length - 1; i > anchorIdx; i--) {
    const size = messageSizes[i]!;
    const mustKeep = recentMessages.length < MIN_RECENT_MESSAGES;
    if (size <= remainingBudget) {
      recentMessages.unshift(messages[i]!);
      remainingBudget -= size;
    } else if (mustKeep) {
      // Force-keep even if over budget — better to exceed slightly than lose all context
      recentMessages.unshift(messages[i]!);
      remainingBudget -= size;
    } else {
      break;
    }
  }

  const droppedCount = messages.length - 1 - recentMessages.length; // -1 for anchor

  const compactionMarker: ChatMessage = {
    id: '__compaction_marker__',
    chatId: messages[0]!.chatId,
    role: 'system',
    parts: [
      {
        type: 'text',
        text: `[${droppedCount} earlier messages omitted to fit context window]`,
      },
    ],
    createdAt: Date.now(),
  };

  let result = repairToolUseResultPairing([
    messages[anchorIdx]!,
    compactionMarker,
    ...recentMessages,
  ]);

  // Post-compaction safety: if the result still exceeds the hard limit,
  // aggressively truncate the largest tool results in the recent window.
  result = enforceHardTokenLimit(
    result,
    modelId,
    systemPromptTokens,
    contextWindowOverride,
    tokenSafetyMargin,
  );

  const tokensAfter = result.reduce((sum, m) => sum + estimateMessageTokens(m), 0);

  // Guard: if compaction made things worse (e.g. repair added synthetic messages),
  // abort and return the original messages unchanged.
  if (tokensAfter >= totalTokens) {
    compactionLog.trace('compaction: sliding-window produced no savings, aborting', {
      tokensBefore: totalTokens,
      tokensAfter,
    });
    return { messages, wasCompacted: false };
  }

  const messagesDropped = messages.length - result.length;
  const durationMs = Date.now() - startTime;

  compactionLog.info('Compaction complete', {
    method: 'sliding-window',
    tokensBefore: totalTokens,
    tokensAfter,
    tokensSaved: totalTokens - tokensAfter,
    messagesDropped,
    durationMs,
    messagesBefore: messages.length,
    messagesAfter: result.length,
  });

  return {
    messages: result,
    wasCompacted: true,
    compactionMethod: 'sliding-window',
    tokensBefore: totalTokens,
    tokensAfter,
    messagesDropped,
    durationMs,
  };
};

/** Bound all history content, including legacy flattened text, after compaction.
 * The latest user prompt is never truncated. Full UI history remains in storage.
 */
const enforceHardTokenLimit = (
  messages: ChatMessage[],
  modelId: string,
  systemPromptTokens: number,
  contextWindowOverride?: number,
  tokenSafetyMargin = TOKEN_SAFETY_MARGIN,
): ChatMessage[] => {
  const budget = Math.floor(
    (getEffectiveContextLimit(modelId, contextWindowOverride) - systemPromptTokens) /
      tokenSafetyMargin,
  );
  const totalTokens = messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  if (totalTokens <= budget) return messages;

  const latestUser = messages.findLastIndex(
    message => message.role === 'user' && message.parts.some(part => part.type !== 'tool-result'),
  );
  const latestTokens = latestUser < 0 ? 0 : estimateMessageTokens(messages[latestUser]!);
  if (latestTokens > budget || budget < 32) {
    throw new Error(
      'Context compaction failed: the latest message and system instructions exceed this model’s context budget. Shorten the message or select a model with a larger context window.',
    );
  }

  const marker: ChatMessage = {
    id: '__context_budget_marker__',
    chatId: messages[0]!.chatId,
    role: 'system',
    parts: [{ type: 'text', text: '[Earlier context shortened to fit the model context window.]' }],
    createdAt: 0,
  };
  let remaining = budget - latestTokens;
  const markerTokens = estimateMessageTokens(marker);
  const includeMarker = remaining >= markerTokens;
  if (includeMarker) remaining -= markerTokens;
  const kept = new Map<number, ChatMessage>();
  if (latestUser >= 0) kept.set(latestUser, messages[latestUser]!);

  const keepWithin = (index: number, allowance: number): void => {
    const message = messages[index]!;
    const size = estimateMessageTokens(message);
    if (size <= allowance) {
      kept.set(index, message);
      remaining -= size;
    } else if (allowance >= 32) {
      // A shortened message is portable context, not a reconstructed tool call.
      const text = message.parts
        .flatMap(part => {
          if (part.type === 'text') return [part.text];
          if (part.type === 'tool-call')
            return [`Tool call (${part.toolName}): ${JSON.stringify(part.args)}`];
          if (part.type === 'tool-result')
            return [`Tool result (${part.toolName}): ${JSON.stringify(part.result)}`];
          if (part.type === 'file') return [`File: ${part.filename ?? 'attachment'}`];
          return [];
        })
        .join('\n');
      const notice = '\n[... earlier content shortened ...]\n';
      const chars = Math.max(0, (allowance - 4) * CHARS_PER_TOKEN_ESTIMATE - notice.length);
      const head = Math.ceil(chars / 2);
      const tail = Math.floor(chars / 2);
      const shortened: ChatMessage = {
        ...message,
        parts: [
          {
            type: 'text',
            text:
              text.length <= chars
                ? text
                : text.slice(0, head) + notice + (tail ? text.slice(-tail) : ''),
          },
        ],
      };
      kept.set(index, shortened);
      remaining -= estimateMessageTokens(shortened);
    }
  };

  // Keep a bounded anchor, then prioritize recent messages over older history.
  const anchor = messages.findIndex(message => message.role === 'user');
  if (anchor >= 0 && anchor !== latestUser) keepWithin(anchor, Math.floor(remaining * 0.15));
  let recent = 0;
  for (let index = messages.length - 1; index >= 0 && remaining >= 4; index--) {
    if (kept.has(index)) continue;
    const size = estimateMessageTokens(messages[index]!);
    if (size > remaining && recent >= MIN_RECENT_MESSAGES) break;
    const allowance =
      size <= remaining
        ? remaining
        : Math.floor(remaining / Math.max(1, MIN_RECENT_MESSAGES - recent));
    keepWithin(index, allowance);
    recent++;
  }
  const result = [...kept.entries()].sort(([a], [b]) => a - b).map(([, message]) => message);
  if (includeMarker) result.splice(anchor >= 0 && kept.has(anchor) ? 1 : 0, 0, marker);
  return result;
};

/**
 * Compact messages to fit within the model's context window.
 *
 * Strategy (sliding window):
 * 1. Preprocess: truncate oversized tool results + compact oldest results
 * 2. Estimate tokens per message using length/3 heuristic
 * 3. If total fits in budget → return as-is
 * 4. Else: keep first user message (anchor) + fill from the end (most recent)
 * 5. Insert a system-role compaction marker between anchor and recent window
 *
 * The compaction marker is never saved to IndexedDB — full history is preserved.
 */
const compactMessages = (
  messages: ChatMessage[],
  modelId: string,
  systemPromptTokens = 0,
  contextWindowOverride?: number,
): CompactionResult => {
  if (messages.length === 0) {
    return { messages, wasCompacted: false };
  }

  const preprocessed = preprocessToolResults(
    messages,
    modelId,
    systemPromptTokens,
    contextWindowOverride,
  );
  return compactMessagesCore(preprocessed, modelId, systemPromptTokens, contextWindowOverride);
};

/**
 * Compact messages with LLM-powered summarization.
 *
 * Strategy:
 * 1. If within budget → return as-is
 * 2. Split into older messages (to summarize) and recent messages (to keep)
 * 3. Call LLM to summarize the older messages
 * 4. Replace older messages with a summary system message
 * 5. Fall back to sliding-window compaction on failure
 */
const COMPACTION_TIMEOUT_MS = 180_000;

const compactMessagesWithSummary = async (
  messages: ChatMessage[],
  modelId: string,
  modelConfig: ChatModel,
  options: {
    signal?: AbortSignal;
    systemPromptTokens?: number;
    existingSummary?: string;
    contextWindowOverride?: number;
    force?: boolean;
    criticalRules?: string;
    compactionConfig?: Partial<CompactionConfig>;
  } = {},
): Promise<CompactionResult> => {
  options.signal?.throwIfAborted();
  const startTime = Date.now();
  const {
    systemPromptTokens = 0,
    existingSummary,
    contextWindowOverride,
    force,
    criticalRules,
    compactionConfig,
  } = options;

  // Resolve configurable values from compaction config or hardcoded defaults
  const cfgMaxHistoryShare = compactionConfig?.maxHistoryShare ?? MAX_HISTORY_SHARE;
  const cfgTokenSafetyMargin = compactionConfig?.tokenSafetyMargin ?? TOKEN_SAFETY_MARGIN;
  const cfgMinRecentMessages = compactionConfig?.recentTurnsPreserve ?? MIN_RECENT_MESSAGES;

  if (messages.length === 0) {
    return { messages, wasCompacted: false, compactionMethod: 'none' };
  }

  // Repair transcript: remove empty/duplicate messages, fix role ordering, repair tool pairing
  const repaired = repairCompactionTranscript(messages);

  // Preprocess: truncate oversized tool results + compact oldest results
  const truncated = preprocessToolResults(
    repaired,
    modelId,
    systemPromptTokens,
    contextWindowOverride,
  );

  const effectiveLimit = getEffectiveContextLimit(modelId, contextWindowOverride);
  const budget = effectiveLimit - systemPromptTokens;
  const messageSizes = truncated.map(estimateMessageTokens);
  const totalTokens = messageSizes.reduce((a, b) => a + b, 0);

  const adjustedTotal = Math.ceil(totalTokens * cfgTokenSafetyMargin);

  compactionLog.trace('compaction: budget calculation', {
    effectiveLimit,
    budget,
    totalTokens,
    adjustedTotal,
    messageCount: truncated.length,
    largestMessage: Math.max(...messageSizes),
    contextWindowOverride,
  });

  if (!force && adjustedTotal <= budget) {
    return { messages: truncated, wasCompacted: false, compactionMethod: 'none' };
  }

  // Find anchor (first user message)
  const anchorIdx = truncated.findIndex(m => m.role === 'user');
  if (anchorIdx < 0) {
    return { messages: truncated, wasCompacted: false, compactionMethod: 'none' };
  }

  // Reserve tokens for the summary injection (enough for a ~8K char summary)
  const summaryReserve = 2000;
  const anchorTokens = messageSizes[anchorIdx]!;
  let remainingBudget = budget - anchorTokens - summaryReserve;

  if (remainingBudget <= 0) {
    return compactMessagesCore(
      truncated,
      modelId,
      systemPromptTokens,
      contextWindowOverride,
      true,
      cfgTokenSafetyMargin,
    );
  }

  // maxHistoryShare guard: cap how much of the budget any single message
  // can consume. If a message exceeds the configured share of the budget,
  // truncate its tool results to fit within the cap.
  const historyShareCap = Math.floor(budget * cfgMaxHistoryShare);
  for (let i = anchorIdx + 1; i < truncated.length; i++) {
    if (messageSizes[i]! > historyShareCap) {
      compactionLog.trace('compaction: maxHistoryShare guard triggered, truncating', {
        messageIndex: i,
        messageTokens: messageSizes[i],
        cap: historyShareCap,
      });
      // Truncate tool results in this message to fit within cap
      const targetChars = historyShareCap * CHARS_PER_TOKEN_BUDGET;
      truncated[i] = truncateMessageToolResults(truncated[i]!, targetChars);
      messageSizes[i] = estimateMessageTokens(truncated[i]!);
    }
  }

  // Fill from the end — but guarantee at least cfgMinRecentMessages
  // AND ensure the last user turn boundary is always included (turn-boundary-aware preservation strategy).
  // Max messages to force-keep from the last user turn boundary
  const MAX_TURN_MESSAGES = 4;

  const recentMessages: ChatMessage[] = [];
  let splitIdx = truncated.length;

  // Find the start of the last complete user turn so we can force-keep it
  const lastUserTurnIdx = findLastUserMessageIndex(truncated, truncated.length - 1);

  for (let i = truncated.length - 1; i > anchorIdx; i--) {
    const size = messageSizes[i]!;
    const mustKeep = recentMessages.length < cfgMinRecentMessages;
    // Also force-keep messages from the last user turn boundary onwards,
    // but cap to a reasonable turn size (user + assistant + tool results)
    // to prevent unbounded force-keeps when the last user message is far back.
    const isInLastUserTurn =
      lastUserTurnIdx > anchorIdx &&
      i >= lastUserTurnIdx &&
      truncated.length - lastUserTurnIdx <= MAX_TURN_MESSAGES;
    if (size <= remainingBudget) {
      recentMessages.unshift(truncated[i]!);
      remainingBudget -= size;
      splitIdx = i;
    } else if (mustKeep || isInLastUserTurn) {
      // Force-keep: prevents losing the current user turn context
      recentMessages.unshift(truncated[i]!);
      remainingBudget -= size;
      splitIdx = i;
    } else {
      break;
    }
  }

  const recentTokens = recentMessages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);

  compactionLog.trace('compaction: split decision', {
    olderCount: splitIdx - anchorIdx - 1,
    recentCount: recentMessages.length,
    recentTokens,
    remainingBudget,
  });

  // Fix: if recent messages alone exceed the budget (e.g. huge tool results),
  // no amount of summarizing older messages will help. Aggressively truncate
  // tool results in the recent window to make room.
  if (recentTokens > budget * 0.8) {
    const targetTokens = Math.floor(budget * 0.6);
    const perMessageCharBudget = Math.floor(
      (targetTokens * CHARS_PER_TOKEN_BUDGET) / recentMessages.length,
    );

    compactionLog.trace('compaction: recent messages exceed budget, truncating tool results', {
      recentTokens,
      budgetThreshold: Math.floor(budget * 0.8),
      targetTokens,
      perMessageCharBudget,
    });

    for (let i = 0; i < recentMessages.length; i++) {
      recentMessages[i] = truncateMessageToolResults(recentMessages[i]!, perMessageCharBudget);
    }
  }

  // Messages to summarize: everything between anchor (exclusive) and splitIdx (exclusive)
  let olderMessages = truncated.slice(anchorIdx + 1, splitIdx);

  if (olderMessages.length === 0 && force) {
    // Force mode: split messages so the older half gets summarized
    const postAnchor = truncated.length - anchorIdx - 1;
    if (postAnchor >= 2) {
      const keepCount = Math.max(MIN_RECENT_MESSAGES, Math.floor(postAnchor / 2));
      const forcedSplitIdx = truncated.length - keepCount;
      olderMessages = truncated.slice(anchorIdx + 1, forcedSplitIdx);
    }
  }

  if (olderMessages.length === 0) {
    // Nothing to summarize — fall back to sliding window (already preprocessed + repaired)
    const fallback = compactMessagesCore(
      truncated,
      modelId,
      systemPromptTokens,
      contextWindowOverride,
      true,
      cfgTokenSafetyMargin,
    );
    // Preserve the outer startTime for more accurate total duration
    if (fallback.wasCompacted) {
      fallback.durationMs = Date.now() - startTime;
      fallback.tokensBefore = fallback.tokensBefore ?? totalTokens;
    }
    return fallback;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const summarizationResult = await Promise.race([
      (async (): Promise<CompactionResult> => {
        // Build summary from older messages + any existing summary context
        const toSummarize = existingSummary
          ? [
              {
                id: '__prior_summary__',
                chatId: truncated[0]!.chatId,
                role: 'system' as const,
                parts: [{ type: 'text' as const, text: `Previous summary: ${existingSummary}` }],
                createdAt: 0,
              },
              ...olderMessages,
            ]
          : olderMessages;

        // Sanitize tool results before summarization
        let sanitized = repairToolUseResultPairing(stripToolResultDetails(toSummarize));

        // Fix: ensure the messages to summarize don't exceed what the summarization
        // LLM can handle. Use 60% of the effective limit as a safe ceiling, then
        // aggressively truncate tool results if the sanitized messages are too large.
        const maxSummarizationTokens = Math.floor(effectiveLimit * 0.6);
        const sanitizedTokens = sanitized.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
        if (sanitizedTokens > maxSummarizationTokens) {
          compactionLog.trace(
            'compaction: sanitized messages too large for summarization, truncating',
            {
              sanitizedTokens,
              maxSummarizationTokens,
            },
          );
          sanitized = enforceHardTokenLimit(
            sanitized,
            modelId,
            systemPromptTokens,
            contextWindowOverride,
          );
        }

        const useAdaptive = shouldUseAdaptiveCompaction(sanitized, modelId, contextWindowOverride);

        compactionLog.trace('compaction: sanitized for summarization', {
          messagesBefore: toSummarize.length,
          messagesAfter: sanitized.length,
          method: useAdaptive ? 'adaptive' : 'single-pass',
        });

        if (useAdaptive) {
          compactionLog.trace('compaction: using adaptive summarization', {
            totalTokens,
            contextWindow: budget + systemPromptTokens,
          });
        }

        // Build summarizer options from compaction config
        const summarizerOpts: SummarizerOptions = {
          signal: options.signal,
          criticalRules,
          qualityGuardEnabled: compactionConfig?.qualityGuardEnabled,
          qualityGuardMaxRetries: compactionConfig?.qualityGuardMaxRetries,
          identifierPolicy: compactionConfig?.identifierPolicy,
        };

        // Choose single-pass or adaptive (multi-part) summarization
        const summary = useAdaptive
          ? await summarizeInStages(
              sanitized,
              modelConfig,
              modelId,
              contextWindowOverride,
              summarizerOpts,
            )
          : await summarizeMessages(sanitized, modelConfig, summarizerOpts);

        const summaryMessage: ChatMessage = {
          id: '__compaction_summary__',
          chatId: truncated[0]!.chatId,
          role: 'system',
          parts: [
            {
              type: 'text',
              text: `[Conversation summary]\n${summary}`,
            },
          ],
          createdAt: Date.now(),
        };

        compactionLog.trace('compaction: summary completed', {
          method: useAdaptive ? 'adaptive' : 'single-pass',
          summaryLength: summary.length,
          olderMessages: olderMessages.length,
          recentMessages: recentMessages.length,
        });

        let repaired = repairToolUseResultPairing([
          truncated[anchorIdx]!,
          summaryMessage,
          ...recentMessages,
        ]);

        // Post-compaction safety: enforce hard token limit on summary result too
        repaired = enforceHardTokenLimit(
          repaired,
          modelId,
          systemPromptTokens,
          contextWindowOverride,
          cfgTokenSafetyMargin,
        );

        const tokensAfter = repaired.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
        const messagesDropped = truncated.length - repaired.length;
        const durationMs = Date.now() - startTime;

        compactionLog.info('Compaction complete', {
          method: 'summary',
          tokensBefore: totalTokens,
          tokensAfter,
          tokensSaved: totalTokens - tokensAfter,
          messagesDropped,
          durationMs,
          messagesBefore: truncated.length,
          messagesAfter: repaired.length,
        });

        return {
          messages: repaired,
          wasCompacted: true,
          compactionMethod: 'summary',
          summary,
          tokensBefore: totalTokens,
          tokensAfter,
          messagesDropped,
          durationMs,
        };
      })(),
      new Promise<CompactionResult>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Compaction timeout')),
          COMPACTION_TIMEOUT_MS,
        );
      }),
    ]);

    clearTimeout(timeoutId);
    return summarizationResult;
  } catch (err) {
    clearTimeout(timeoutId);
    options.signal?.throwIfAborted();
    // Summarization or timeout failed — fall back to sliding window
    // truncated is safe to reuse here: the summarization IIFE creates its own copies
    compactionLog.info('compaction: fell back to sliding-window', {
      error: err instanceof Error ? err.message : String(err),
    });
    const fallback = compactMessagesCore(
      truncated,
      modelId,
      systemPromptTokens,
      contextWindowOverride,
      true,
      cfgTokenSafetyMargin,
    );
    // Preserve the outer startTime for more accurate total duration
    if (fallback.wasCompacted) {
      fallback.durationMs = Date.now() - startTime;
      fallback.tokensBefore = fallback.tokensBefore ?? totalTokens;
    }
    return { ...fallback, compactionMethod: 'sliding-window' };
  }
};

// ── Pre-compaction memory flush ──

const FLUSH_RESERVE_TOKENS = 4000;
const FLUSH_SOFT_THRESHOLD_TOKENS = 4000;

interface MemoryFlushCheck {
  totalTokens: number;
  modelId: string;
  systemPromptTokens?: number;
  compactionCount?: number;
  memoryFlushCompactionCount?: number;
  contextWindowOverride?: number;
}

/**
 * Determine whether a pre-compaction memory flush should run.
 *
 * Returns true when:
 * 1. Estimated context tokens exceed the soft threshold
 * 2. A flush has not already run for the current compaction cycle
 *
 * softThreshold = effectiveContextLimit - reserveTokens - softThresholdTokens
 */
const shouldRunMemoryFlush = (check: MemoryFlushCheck): boolean => {
  const effectiveLimit = getEffectiveContextLimit(check.modelId, check.contextWindowOverride);
  const softThreshold =
    effectiveLimit -
    (check.systemPromptTokens ?? 0) -
    FLUSH_RESERVE_TOKENS -
    FLUSH_SOFT_THRESHOLD_TOKENS;

  if (check.totalTokens < softThreshold) return false;

  // Once-per-cycle guard: skip if already flushed for this compaction cycle
  const currentCycle = check.compactionCount ?? 0;
  const lastFlushCycle = check.memoryFlushCompactionCount;
  if (lastFlushCycle !== undefined && lastFlushCycle === currentCycle) return false;

  return true;
};

export {
  compactMessages,
  compactMessagesWithSummary,
  compactOldestToolResults,
  estimateMessageTokens,
  estimatePartTokens,
  truncateMessageToolResults,
  truncateOversizedToolResults,
  shouldRunMemoryFlush,
  FLUSH_RESERVE_TOKENS,
  FLUSH_SOFT_THRESHOLD_TOKENS,
  MIN_RECENT_MESSAGES,
  MAX_TOOL_RESULT_CONTEXT_SHARE,
  TOKEN_SAFETY_MARGIN,
  HARD_MAX_TOOL_RESULT_CHARS,
  MIN_KEEP_CHARS,
  CHARS_PER_TOKEN_BUDGET,
  MAX_HISTORY_SHARE,
  TOOL_RESULT_COMPACTION_PLACEHOLDER,
  COMPACTION_TIMEOUT_MS,
};
export type { CompactionResult, MemoryFlushCheck };
