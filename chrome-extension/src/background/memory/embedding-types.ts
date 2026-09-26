/**
 * Unified embedding provider interface.
 *
 * Implementing a new provider requires only:
 * 1. Create a function that returns EmbeddingProvider
 * 2. Add a branch in embedding-provider.ts factory
 */
interface EmbeddingProvider {
  /** Provider identifier, e.g. 'openai-compatible' or 'local' */
  readonly id: string;
  /** Model name, e.g. 'text-embedding-3-small' */
  readonly model: string;
  /** Changes when Rust changes the upstream model behind a public ID. */
  readonly spaceId: string;
  /** Max input tokens the model accepts (optional safety check) */
  readonly maxInputTokens?: number;
  /** Embed a single query string → vector */
  embedQuery(text: string): Promise<number[]>;
  /** Embed multiple texts in one call → array of vectors */
  embedBatch(texts: string[]): Promise<number[][]>;
}

export type { EmbeddingProvider };
