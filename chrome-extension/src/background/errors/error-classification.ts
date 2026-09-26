/**
 * Error classification utilities for LLM API errors.
 * Pure functions with zero dependencies.
 */

// ── Error category enum ────────────────────────

type ErrorCategory =
  | 'context-overflow'
  | 'compaction-failure'
  | 'rate-limit'
  | 'transient'
  | 'auth'
  | 'unknown';

// ── Regex patterns ────────────

/** Exact context overflow patterns — provider-specific error substrings */
const CONTEXT_OVERFLOW_PATTERNS = [
  'maximum context length',
  'max_tokens',
  'context_length_exceeded',
  'prompt is too long',
  'input is too long',
  'too many tokens',
  'request too large',
  'content_too_large',
  'exceeds the model',
  'token limit',
  'context window',
  "model's maximum",
  'reduce the length',
  'reduce your prompt',
  'please shorten',
  'prompt has roughly',
  'too long for model',
  'Input token count',
];

/** Broad hint regex for context overflow — matches across providers */
const CONTEXT_OVERFLOW_HINT_RE =
  /context.{0,20}(length|limit|window|exceed|overflow|too.?long)|too.many.tokens|token.{0,10}(limit|exceed|overflow)|prompt.{0,10}(too.long|too.large)|max.?tokens|content.?too.?large|request.?too.?large|input.{0,10}too.{0,5}long/i;

/** Compaction-specific overflow — the summarizer itself overflows */
const CONTEXT_WINDOW_TOO_SMALL_RE =
  /context.{0,15}(too.?small|insufficient)|cannot.{0,10}compact|compaction.{0,10}fail|summary.{0,15}(too.?long|overflow|exceed)/i;

/** Rate limit patterns */
const RATE_LIMIT_HINT_RE =
  /429|rate.?limit|too.?many.?requests|quota.?exceed|resource.?exhaust|capacity|overloaded/i;

// ── Classifier functions ────────────────────────

/**
 * Check if the error message indicates a context overflow (exact match).
 * Uses substring matching against known provider error patterns.
 */
const isContextOverflowError = (msg: string): boolean => {
  const lower = msg.toLowerCase();
  return CONTEXT_OVERFLOW_PATTERNS.some(p => lower.includes(p.toLowerCase()));
};

/**
 * Check if the error message likely indicates a context overflow (broad match).
 * Uses regex patterns. Excludes rate limit errors to avoid false positives.
 */
const isLikelyContextOverflowError = (msg: string): boolean => {
  if (isRateLimitError(msg)) return false;
  return CONTEXT_OVERFLOW_HINT_RE.test(msg);
};

/**
 * Check if the error is a compaction-specific failure (the summarizer itself overflowed).
 */
const isCompactionFailureError = (msg: string): boolean => CONTEXT_WINDOW_TOO_SMALL_RE.test(msg);

/**
 * Check if the error is a rate limit / quota error.
 */
const isRateLimitError = (msg: string): boolean => RATE_LIMIT_HINT_RE.test(msg);

/**
 * Check if the error is a transient HTTP error (retryable server errors).
 */
const isTransientHttpError = (msg: string): boolean =>
  /\b(500|502|503|504)\b|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket.?hang.?up|network.?error|fetch.?failed/i.test(
    msg,
  );

/**
 * Check if the error is an authentication/authorization error.
 */
const isAuthError = (msg: string): boolean =>
  /\b(401|403)\b|unauthorized|forbidden|invalid.?api.?key|authentication.?fail|access.?denied/i.test(
    msg,
  );

/**
 * Classify an error message into a category.
 * Priority: compaction-failure > context-overflow > auth > rate-limit > transient > unknown
 */
const classifyError = (msg: string): ErrorCategory => {
  if (isCompactionFailureError(msg)) return 'compaction-failure';
  if (isContextOverflowError(msg) || isLikelyContextOverflowError(msg)) return 'context-overflow';
  if (isAuthError(msg)) return 'auth';
  if (isRateLimitError(msg)) return 'rate-limit';
  if (isTransientHttpError(msg)) return 'transient';
  return 'unknown';
};

/**
 * Parse the actual token limit from a provider error message.
 * Returns the limit number or undefined if not extractable.
 *
 * Example messages:
 * - "This model's maximum context length is 128000 tokens"
 * - "exceeds the limit of 128000"
 * - "Input token count 180000 exceeds the model maximum of 128000"
 * - "max_tokens: 128000"
 */
const LIMIT_PATTERNS = [
  /limit\s+of\s+(\d+)/i,
  /maximum\s+(?:of\s+|is\s+|context\s+length\s+(?:of\s+|is\s+))(\d+)/i,
  /max_tokens[:\s]+(\d+)/i,
  /model\s+maximum\s+(?:of\s+)?(\d+)/i,
];

const parseProviderTokenLimit = (msg: string): number | undefined => {
  for (const pattern of LIMIT_PATTERNS) {
    const match = msg.match(pattern);
    if (match?.[1]) {
      const num = parseInt(match[1], 10);
      if (num > 0) return num;
    }
  }
  return undefined;
};

export {
  isContextOverflowError,
  isLikelyContextOverflowError,
  isCompactionFailureError,
  isRateLimitError,
  isTransientHttpError,
  isAuthError,
  classifyError,
  parseProviderTokenLimit,
};

export type { ErrorCategory };
