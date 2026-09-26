import { cosineSimilarity } from './cosine-similarity';
import { describe, it, expect } from 'vitest';

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it('returns -1.0 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it('returns 0.0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('handles zero-magnitude vectors (returns 0)', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('handles mismatched lengths (uses shorter)', () => {
    // [1,0] · [1] with len=1 → dot=1, mag=1*1 → 1.0
    expect(cosineSimilarity([1, 0], [1])).toBeCloseTo(1.0);
  });

  it('computes correct similarity for real-world-like vectors', () => {
    const a = [0.1, 0.2, 0.3, 0.4];
    const b = [0.4, 0.3, 0.2, 0.1];
    // Manually: dot=0.04+0.06+0.06+0.04=0.2
    //           |a|=sqrt(0.3), |b|=sqrt(0.3) → sim = 0.2/0.3 ≈ 0.6667
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.6667, 3);
  });
});
