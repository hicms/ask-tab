/**
 * Runtime tool result context guard.
 *
 * Enforces per-result and global token budgets on tool results BEFORE
 * they enter the compaction pipeline. Prevents massive tool results
 * from triggering the "fail then retry" loop.
 */

import { getEffectiveContextLimit } from './limits';
import { truncateToolResultText } from './tool-result-truncation';
import type { ChatMessage } from '@extension/shared';

/** Max share of context window a single tool result can occupy */
const SINGLE_TOOL_RESULT_CONTEXT_SHARE = 0.5;

/** Max share of context window for all input messages */
const CONTEXT_INPUT_HEADROOM_RATIO = 0.75;

/** Placeholder for compacted tool output */
const COMPACTION_PLACEHOLDER = '[compacted: tool output removed to free context]';

/** Conservative chars-per-token estimate — must match CHARS_PER_TOKEN_BUDGET in compaction.ts.
 * Duplicated here to avoid circular dependency (compaction → summarizer → adaptive-compaction). */
const CHARS_PER_TOKEN_ESTIMATE = 3;

/**
 * Estimate total chars for a message array (simplified, for budget checks).
 */
const estimateTotalChars = (messages: ChatMessage[]): number => {
  let total = 0;
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === 'text' || part.type === 'reasoning') {
        total += part.text.length;
      } else if (part.type === 'tool-call') {
        total += JSON.stringify(part.args).length + part.toolName.length;
      } else if (part.type === 'tool-result') {
        const str = typeof part.result === 'string' ? part.result : JSON.stringify(part.result);
        total += str.length + part.toolName.length;
      } else if (part.type === 'file') {
        total += part.data && part.mediaType?.startsWith('image/') ? 6400 : 2000;
      }
    }
  }
  return total;
};

/**
 * Enforce tool result budgets on messages.
 *
 * Phase 1: Per-result cap — truncate any single tool-result exceeding 50% of context
 * Phase 2: Global cap — replace oldest tool-results with placeholder until under 75% of context
 *
 * Returns a new array (does not mutate input).
 */
const enforceToolResultBudget = (
  messages: ChatMessage[],
  modelId: string,
  contextWindowOverride?: number,
): ChatMessage[] => {
  if (messages.length === 0) return [];

  const contextWindow = getEffectiveContextLimit(modelId, contextWindowOverride);
  const perResultMaxChars = Math.floor(
    contextWindow * SINGLE_TOOL_RESULT_CONTEXT_SHARE * CHARS_PER_TOKEN_ESTIMATE,
  );
  const globalMaxChars = Math.floor(
    contextWindow * CONTEXT_INPUT_HEADROOM_RATIO * CHARS_PER_TOKEN_ESTIMATE,
  );

  // Phase 1: Per-result cap
  const result = messages.map(msg => {
    const hasOversized = msg.parts.some(part => {
      if (part.type !== 'tool-result') return false;
      const str = typeof part.result === 'string' ? part.result : JSON.stringify(part.result);
      return str.length > perResultMaxChars;
    });
    if (!hasOversized) return { ...msg, parts: [...msg.parts] };

    return {
      ...msg,
      parts: msg.parts.map(part => {
        if (part.type !== 'tool-result') return part;
        const str = typeof part.result === 'string' ? part.result : JSON.stringify(part.result);
        if (str.length <= perResultMaxChars) return part;
        return { ...part, result: truncateToolResultText(str, perResultMaxChars) };
      }),
    };
  });

  // Phase 2: Global cap — replace oldest tool-results until under budget
  const totalChars = estimateTotalChars(result);
  if (totalChars <= globalMaxChars) return result;

  let charsToFree = totalChars - globalMaxChars;

  // Walk oldest to newest, replacing tool-result contents
  for (let mi = 0; mi < result.length && charsToFree > 0; mi++) {
    const msg = result[mi]!;
    let msgModified = false;
    const newParts = msg.parts.map(part => {
      if (charsToFree <= 0 || part.type !== 'tool-result') return part;
      const str = typeof part.result === 'string' ? part.result : JSON.stringify(part.result);
      if (str.length <= COMPACTION_PLACEHOLDER.length) return part;

      const freed = str.length - COMPACTION_PLACEHOLDER.length;
      charsToFree -= freed;
      msgModified = true;
      return { ...part, result: COMPACTION_PLACEHOLDER };
    });

    if (msgModified) {
      result[mi] = { ...msg, parts: newParts };
    }
  }

  return result;
};

export {
  enforceToolResultBudget,
  SINGLE_TOOL_RESULT_CONTEXT_SHARE,
  CONTEXT_INPUT_HEADROOM_RATIO,
  COMPACTION_PLACEHOLDER,
};
