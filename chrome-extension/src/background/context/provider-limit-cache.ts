/**
 * In-memory cache for detected provider token limits.
 *
 * When a provider (e.g. LiteLLM proxy) rejects a request because the prompt
 * exceeds a limit lower than the model's native context window, we cache that
 * limit so that subsequent compaction calls (including /compact) can use it
 * without needing to fail first.
 */

const cache = new Map<string, number>();

/** Store a detected provider limit for a model. */
const setProviderTokenLimit = (modelId: string, limit: number): void => {
  const existing = cache.get(modelId);
  // Keep the lowest observed limit (most restrictive)
  if (existing === undefined || limit < existing) {
    cache.set(modelId, limit);
  }
};

/** Get the cached provider limit for a model, if any. */
const getProviderTokenLimit = (modelId: string): number | undefined => cache.get(modelId);

export { setProviderTokenLimit, getProviderTokenLimit };
