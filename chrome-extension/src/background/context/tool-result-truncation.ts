/**
 * Tool result truncation for context overflow recovery.
 * Operates on AgentMessage[] — truncates oversized tool results in-flight
 * without modifying the original messages stored in IndexedDB.
 */

import { getModelContextLimit } from '@extension/shared';
import type { AgentMessage, ToolResultMessage, TextContent } from '../agents';

/** Maximum share of context window that tool results may consume */
const MAX_TOOL_RESULT_CONTEXT_SHARE = 0.3;

/** Minimum characters to keep when truncating (always keep at least this much) */
const MIN_KEEP_CHARS = 2000;

/** Approximate chars per token for budget calculation */
const CHARS_PER_TOKEN = 4;

// ── Base64 detection and stripping ────────────────────────

/** Match JSON-wrapped base64 image data (e.g. {"base64":"...","mimeType":"image/png"}) */
const BASE64_JSON_RE = /("(?:base64|data|image|imageData)":\s*")[A-Za-z0-9+/=]{1000,}(")/g;

/** Match data URLs with base64 content */
const DATA_URL_BASE64_RE = /(data:image\/[^;]+;base64,)[A-Za-z0-9+/=]{1000,}/g;

/** Match long standalone base64 blobs in JSON string values (e.g. CDP Runtime.evaluate results).
 * Uses 8000-char minimum to avoid false positives on minified JS, long hex strings, or JWTs. */
const STANDALONE_BASE64_RE = /("[^"]{0,50}"\s*:\s*")[A-Za-z0-9+/]{8000,}={0,2}(")/g;

/**
 * Strip base64 image data from tool result text, replacing with a placeholder.
 * Handles both JSON-wrapped base64 and data URLs.
 * This prevents legacy messages (pre-image-block) from bloating context.
 */
const stripBase64FromText = (text: string): string => {
  let result = text;
  result = result.replace(
    BASE64_JSON_RE,
    (_match, prefix: string, suffix: string) => `${prefix}[image data removed]${suffix}`,
  );
  result = result.replace(
    DATA_URL_BASE64_RE,
    (_match, prefix: string) => `${prefix}[image data removed]`,
  );
  // Strip long standalone base64 blobs (e.g. CDP debugger responses with image data in JSON values)
  result = result.replace(
    STANDALONE_BASE64_RE,
    (_match, prefix: string, suffix: string) => `${prefix}[base64 data removed]${suffix}`,
  );
  return result;
};

// ── Public API ────────────────────────

/**
 * Calculate the maximum characters allowed for tool result text,
 * based on 30% of the model's context window × 4 chars/token.
 *
 * @param contextLimitOverride — if provided, use this instead of the model's default context limit
 *        (e.g. when a proxy/gateway imposes a lower limit than the model's native window)
 */
const calculateMaxToolResultChars = (modelId: string, contextLimitOverride?: number): number => {
  const contextWindow = contextLimitOverride ?? getModelContextLimit(modelId);
  return Math.max(
    Math.floor(contextWindow * MAX_TOOL_RESULT_CONTEXT_SHARE * CHARS_PER_TOKEN),
    MIN_KEEP_CHARS,
  );
};

/** Chars to keep from the head of truncated content */
const HEAD_KEEP_CHARS = 1500;

/** Chars to keep from the tail of truncated content */
const TAIL_KEEP_CHARS = 1500;

/**
 * Truncate a single text string using head+tail strategy.
 * First strips any embedded base64 image data to prevent token waste.
 * Keeps both the beginning (context) and end (conclusions/final output).
 */
const truncateToolResultText = (text: string, maxChars: number): string => {
  // Strip base64 image data first — prevents legacy screenshot payloads from bloating context
  const cleaned = stripBase64FromText(text);
  if (cleaned.length <= maxChars) return cleaned;

  const removedChars = cleaned.length - maxChars;
  const truncationNotice = `\n\n[... truncated ${removedChars} characters to fit context window ...]\n\n`;

  const headChars = Math.max(
    MIN_KEEP_CHARS,
    Math.min(HEAD_KEEP_CHARS, Math.floor(maxChars * 0.45)),
  );
  const tailChars = Math.min(TAIL_KEEP_CHARS, Math.floor(maxChars * 0.45));

  // If we can fit head+tail+notice, use head+tail
  if (headChars + tailChars + truncationNotice.length < cleaned.length) {
    // Try to cut head at a newline boundary
    let headCut = headChars;
    const headNewline = cleaned.lastIndexOf('\n', headChars);
    if (headNewline > headChars * 0.8) headCut = headNewline;

    // Try to cut tail at a newline boundary
    let tailStart = cleaned.length - tailChars;
    const tailNewline = cleaned.indexOf('\n', tailStart);
    if (tailNewline > 0 && tailNewline < tailStart + tailChars * 0.2) tailStart = tailNewline + 1;

    return cleaned.slice(0, headCut) + truncationNotice + cleaned.slice(tailStart);
  }

  // Fallback: head-only when text is too small for head+tail
  const cutPoint = cleaned.lastIndexOf('\n', maxChars);
  const effectiveCut = cutPoint > MIN_KEEP_CHARS ? cutPoint : maxChars;
  const kept = cleaned.slice(0, effectiveCut);
  return `${kept}\n\n[... truncated ${removedChars} characters to fit context window ...]`;
};

/**
 * Scan messages for oversized tool results and return a new array with truncated text.
 * Returns a new array — does NOT mutate the input.
 *
 * @param contextLimitOverride — optional override for the model's context limit
 * @returns `{ messages, truncatedCount }` — the (possibly) truncated messages and how many were truncated
 */
const truncateToolResults = (
  messages: AgentMessage[],
  modelId: string,
  contextLimitOverride?: number,
): { messages: AgentMessage[]; truncatedCount: number } => {
  const maxChars = calculateMaxToolResultChars(modelId, contextLimitOverride);
  let truncatedCount = 0;

  const result = messages.map(msg => {
    if (msg.role !== 'toolResult') return msg;

    const toolMsg = msg as ToolResultMessage;
    let didTruncate = false;

    const newContent = toolMsg.content.map(c => {
      if (c.type !== 'text') return c;
      const textContent = c as TextContent;
      if (textContent.text.length <= maxChars) return c;

      didTruncate = true;
      return { ...textContent, text: truncateToolResultText(textContent.text, maxChars) };
    });

    if (!didTruncate) return msg;
    truncatedCount++;
    return { ...toolMsg, content: newContent };
  });

  return { messages: result, truncatedCount };
};

/**
 * Check if any tool result in the messages exceeds the model's limit.
 *
 * @param contextLimitOverride — optional override for the model's context limit
 */
const hasOversizedToolResults = (
  messages: AgentMessage[],
  modelId: string,
  contextLimitOverride?: number,
): boolean => {
  const maxChars = calculateMaxToolResultChars(modelId, contextLimitOverride);

  return messages.some(msg => {
    if (msg.role !== 'toolResult') return false;
    const toolMsg = msg as ToolResultMessage;
    return toolMsg.content.some(
      c => c.type === 'text' && (c as TextContent).text.length > maxChars,
    );
  });
};

export {
  calculateMaxToolResultChars,
  truncateToolResultText,
  truncateToolResults,
  hasOversizedToolResults,
  stripBase64FromText,
  MAX_TOOL_RESULT_CONTEXT_SHARE,
  MIN_KEEP_CHARS,
  CHARS_PER_TOKEN,
};
