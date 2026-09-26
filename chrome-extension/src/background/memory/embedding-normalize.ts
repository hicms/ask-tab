/**
 * Sanitize non-finite values (NaN, Infinity) and L2-normalize to unit magnitude.
 * After normalization, cosine similarity equals the dot product.
 *
 */
const sanitizeAndNormalizeEmbedding = (vec: number[]): number[] => {
  if (vec.length === 0 || vec.some(v => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new Error('Invalid embedding vector');
  }
  const sanitized = vec;
  const magnitude = Math.sqrt(sanitized.reduce((sum, v) => sum + v * v, 0));
  if (magnitude < 1e-10) return sanitized;
  return sanitized.map(v => v / magnitude);
};

export { sanitizeAndNormalizeEmbedding };
