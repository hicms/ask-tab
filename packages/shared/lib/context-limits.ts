/** Known context window sizes (in tokens) for popular models */
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // OpenAI
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4': 8_192,
  'gpt-3.5-turbo': 16_385,
  o1: 200_000,
  'o1-mini': 128_000,
  'o1-pro': 200_000,
  o3: 200_000,
  'o3-mini': 200_000,
  'o4-mini': 200_000,
  'gpt-5': 1_000_000,
  'gpt-5-mini': 1_000_000,
  'gpt-5.1-codex': 1_000_000,
  'gpt-5.3-codex': 1_000_000,
  'codex-mini-latest': 192_000,

  // Anthropic
  'claude-opus-4-6': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  'claude-3-5-sonnet-20241022': 200_000,
  'claude-3-5-haiku-20241022': 200_000,
  'claude-3-opus-20240229': 200_000,

  // Google
  'gemini-3.1-pro': 1_000_000,
  'gemini-3-pro': 1_000_000,
  'gemini-3-flash': 200_000,
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'gemini-2.0-flash': 1_000_000,
  'gemini-2.0-flash-lite': 1_000_000,
  'gemini-1.5-pro': 2_000_000,
  'gemini-1.5-flash': 1_000_000,
};

const DEFAULT_CONTEXT_LIMIT = 128_000;

/** Reserve 25% of context for response + system prompt */
const CONTEXT_RATIO = 0.75;

/**
 * Resolve a model's context limit from the known table.
 * Tries the raw ID first, then normalizes dots → dashes so that
 * user-configured IDs like "claude-opus-4.6" match "claude-opus-4-6".
 */
const resolveContextLimit = (modelId: string, contextWindowOverride?: number): number => {
  if (contextWindowOverride != null && contextWindowOverride > 0) return contextWindowOverride;

  const direct = MODEL_CONTEXT_LIMITS[modelId];
  if (direct !== undefined) return direct;

  const normalized = modelId.replace(/\./g, '-');
  return MODEL_CONTEXT_LIMITS[normalized] ?? DEFAULT_CONTEXT_LIMIT;
};

/**
 * Get the effective context limit for a model (after reserving space for output).
 * Returns the number of tokens available for input messages.
 */
const getEffectiveContextLimit = (modelId: string, contextWindowOverride?: number): number =>
  Math.floor(resolveContextLimit(modelId, contextWindowOverride) * CONTEXT_RATIO);

/**
 * Get the raw context window size for a model (before reserving output space).
 */
const getModelContextLimit = (modelId: string, contextWindowOverride?: number): number =>
  resolveContextLimit(modelId, contextWindowOverride);

export {
  getEffectiveContextLimit,
  getModelContextLimit,
  MODEL_CONTEXT_LIMITS,
  DEFAULT_CONTEXT_LIMIT,
  CONTEXT_RATIO,
};
