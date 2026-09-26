/**
 * Adaptive compaction — for very long histories, split into parts,
 * summarize each independently, then merge partial summaries.
 *
 * Preserves more information than single-pass summarization.
 */

import { getModelContextLimit } from './limits';
import type { ChatMessage } from '@extension/shared';

/**
 * Rough token estimate for a message (same heuristic as compaction.ts).
 * Inlined here to avoid circular dependency with compaction → summarizer → adaptive-compaction.
 */
const estimateTokensRough = (message: ChatMessage): number => {
  const partTokens = message.parts.reduce((sum, part) => {
    if (part.type === 'text' || part.type === 'reasoning')
      return sum + Math.ceil(part.text.length / 4);
    if (part.type === 'tool-call')
      return sum + Math.ceil((part.toolName.length + JSON.stringify(part.args).length) / 4);
    if (part.type === 'tool-result')
      return sum + Math.ceil((part.toolName.length + JSON.stringify(part.result).length) / 4);
    if (part.type === 'file') return sum + 500;
    return sum;
  }, 0);
  return partTokens + 4; // +4 for role overhead
};

/** Safety margin multiplier for adaptive compaction threshold */
const SAFETY_MARGIN = 1.2;

/** Overhead tokens reserved for each summarization call */
const SUMMARIZATION_OVERHEAD_TOKENS = 4096;

/** Base ratio of context window for each chunk (at 1.5x overflow) */
const BASE_CHUNK_RATIO = 0.4;

/** Minimum ratio — floor to prevent excessively small chunks */
const MIN_CHUNK_RATIO = 0.15;

/**
 * Determine whether adaptive (multi-part) compaction should be used.
 *
 * Returns true when total message tokens exceed 1.5x the model's context window.
 */
const shouldUseAdaptiveCompaction = (
  messages: ChatMessage[],
  modelId: string,
  contextWindowOverride?: number,
): boolean => {
  const contextWindow = getModelContextLimit(modelId, contextWindowOverride);
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokensRough(m), 0);
  return totalTokens > contextWindow * SAFETY_MARGIN;
};

/**
 * Compute the number of parts to split messages into.
 *
 * 2-8 parts based on overflow ratio. Each part must fit within
 * (contextWindow - overhead) tokens.
 */
const computePartCount = (
  messages: ChatMessage[],
  modelId: string,
  contextWindowOverride?: number,
): number => {
  const contextWindow = getModelContextLimit(modelId, contextWindowOverride);
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokensRough(m), 0);
  const overflowRatio = totalTokens / contextWindow;

  // Scale chunk ratio down as overflow grows
  const chunkRatio = Math.max(MIN_CHUNK_RATIO, BASE_CHUNK_RATIO / overflowRatio);
  const maxTokensPerPart = contextWindow * chunkRatio;
  const rawParts = Math.ceil(totalTokens / maxTokensPerPart);

  return Math.min(8, Math.max(2, rawParts));
};

/**
 * Split messages into roughly equal token-sized parts.
 *
 * Never splits a message across parts — messages stay intact.
 */
const splitMessagesByTokenShare = (messages: ChatMessage[], parts: number): ChatMessage[][] => {
  if (parts <= 1) return [messages];
  if (messages.length === 0) return [];

  const totalTokens = messages.reduce((sum, m) => sum + estimateTokensRough(m), 0);
  const targetTokensPerPart = totalTokens / parts;

  const result: ChatMessage[][] = [];
  let currentPart: ChatMessage[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    const msgTokens = estimateTokensRough(message);
    currentPart.push(message);
    currentTokens += msgTokens;

    // Start a new part when we exceed the target (unless it's the last part)
    if (currentTokens >= targetTokensPerPart && result.length < parts - 1) {
      result.push(currentPart);
      currentPart = [];
      currentTokens = 0;
    }
  }

  // Push remaining messages as the last part
  if (currentPart.length > 0) {
    result.push(currentPart);
  }

  return result;
};

export {
  shouldUseAdaptiveCompaction,
  computePartCount,
  splitMessagesByTokenShare,
  SAFETY_MARGIN,
  SUMMARIZATION_OVERHEAD_TOKENS,
  BASE_CHUNK_RATIO,
  MIN_CHUNK_RATIO,
};
