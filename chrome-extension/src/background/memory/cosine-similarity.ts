/**
 * Cosine similarity between two vectors.
 * Since we L2-normalize all embeddings before storage, this equals the dot product.
 * But we keep the full formula for safety with any un-normalized vectors.
 *
 */
const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length === 0 || b.length === 0) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom < 1e-10 ? 0 : dot / denom;
};

export { cosineSimilarity };
