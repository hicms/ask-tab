import { sanitizeAndNormalizeEmbedding } from './embedding-normalize';
import { describe, it, expect } from 'vitest';

describe('sanitizeAndNormalizeEmbedding', () => {
  it('normalizes to unit magnitude', () => {
    const result = sanitizeAndNormalizeEmbedding([3, 4]);
    // magnitude = 5, normalized = [0.6, 0.8]
    expect(result[0]).toBeCloseTo(0.6);
    expect(result[1]).toBeCloseTo(0.8);
    // Verify unit magnitude
    const mag = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
    expect(mag).toBeCloseTo(1.0);
  });

  it('rejects NaN', () => {
    expect(() => sanitizeAndNormalizeEmbedding([NaN, 1])).toThrow('Invalid embedding vector');
  });

  it('rejects Infinity', () => {
    expect(() => sanitizeAndNormalizeEmbedding([Infinity, 1])).toThrow('Invalid embedding vector');
  });

  it('returns zero vector unchanged when magnitude is near zero', () => {
    const result = sanitizeAndNormalizeEmbedding([0, 0, 0]);
    expect(result).toEqual([0, 0, 0]);
  });

  it('handles single-element vector', () => {
    const result = sanitizeAndNormalizeEmbedding([5]);
    expect(result[0]).toBeCloseTo(1.0);
  });
});
