import { tokenize, buildIndex, search, scoreBM25 } from './memory-search';
import { describe, it, expect } from 'vitest';
import type { DbMemoryChunk } from '@storage-internal/chat-db';

const makeChunk = (id: string, text: string, filePath = 'memory/test.md'): DbMemoryChunk => ({
  id,
  fileId: 'file-1',
  filePath,
  startLine: 1,
  endLine: 10,
  text,
  fileUpdatedAt: Date.now(),
});

describe('tokenize', () => {
  it('extracts lowercase alphanumeric tokens', () => {
    const tokens = tokenize('Hello World 123 test_var');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
    expect(tokens).toContain('123');
    expect(tokens).toContain('test_var');
  });

  it('filters stop words', () => {
    const tokens = tokenize('the quick brown fox is a test');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('is');
    expect(tokens).not.toContain('a');
    expect(tokens).toContain('quick');
    expect(tokens).toContain('brown');
    expect(tokens).toContain('fox');
    expect(tokens).toContain('test');
  });

  it('handles empty input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });

  it('tokenizes Chinese text into bigrams', () => {
    const tokens = tokenize('人工智能');
    // 4 CJK chars → 3 bigrams: 人工, 工智, 智能
    expect(tokens).toContain('人工');
    expect(tokens).toContain('工智');
    expect(tokens).toContain('智能');
  });

  it('tokenizes Japanese mixed-script text', () => {
    const tokens = tokenize('東京タワー hello');
    // CJK bigrams from 東京
    expect(tokens).toContain('東京');
    // Latin token
    expect(tokens).toContain('hello');
    // Katakana run: タワー
    expect(tokens).toContain('タワー');
  });

  it('tokenizes Korean Hangul syllables', () => {
    const tokens = tokenize('안녕하세요');
    // Each Hangul syllable should be a token (after stop word filter)
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('handles mixed Latin and CJK text', () => {
    const tokens = tokenize('React 組件 component');
    expect(tokens).toContain('react');
    expect(tokens).toContain('component');
    // CJK bigram (only 2 chars, so 1 bigram)
    expect(tokens).toContain('組件');
  });

  it('filters non-English stop words', () => {
    // French stop words: 'est', 'une', 'le' should be filtered
    const tokens = tokenize('est une le programmation');
    expect(tokens).not.toContain('est');
    expect(tokens).not.toContain('une');
    expect(tokens).toContain('programmation');
  });

  it('filters Chinese stop words in CJK single-char output', () => {
    // Single CJK chars that are stop words should be filtered
    const tokens = tokenize('的好');
    // '的' is a stop word, '好' is not
    expect(tokens).not.toContain('的');
  });

  it('produces tokens for Arabic/Cyrillic text', () => {
    const tokens = tokenize('тестирование');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).toContain('тестирование');
  });
});

describe('buildIndex', () => {
  it('creates postings for single document', () => {
    const chunks = [makeChunk('c1', 'typescript javascript testing')];
    const index = buildIndex(chunks);
    expect(index.postings.has('typescript')).toBe(true);
    expect(index.postings.has('javascript')).toBe(true);
    expect(index.docCount).toBe(1);
  });

  it('creates postings for multiple documents', () => {
    const chunks = [makeChunk('c1', 'typescript rocks'), makeChunk('c2', 'javascript also rocks')];
    const index = buildIndex(chunks);
    const rocksEntries = index.postings.get('rocks');
    expect(rocksEntries).toHaveLength(2);
    expect(index.docCount).toBe(2);
  });

  it('computes correct avgDocLength', () => {
    const chunks = [
      makeChunk('c1', 'one two three'), // 3 tokens
      makeChunk('c2', 'four five'), // 2 tokens
    ];
    const index = buildIndex(chunks);
    expect(index.avgDocLength).toBe(2.5);
  });
});

describe('BM25 scoring', () => {
  it('exact match scores higher than partial match', () => {
    const chunks = [
      makeChunk('c1', 'typescript testing framework vitest'),
      makeChunk('c2', 'python testing framework pytest unittest'),
    ];
    const index = buildIndex(chunks);
    const scoreTS = scoreBM25(['typescript', 'testing'], 'c1', index);
    const scorePY = scoreBM25(['typescript', 'testing'], 'c2', index);
    expect(scoreTS).toBeGreaterThan(scorePY);
  });

  it('rare terms score higher than common terms (IDF)', () => {
    const chunks = [
      makeChunk('c1', 'common rare_unique_term common common'),
      makeChunk('c2', 'common common common common'),
      makeChunk('c3', 'common common common'),
    ];
    const index = buildIndex(chunks);
    // rare_unique_term only appears in c1, so searching for it should give c1 highest score
    const results = search(index, 'rare_unique_term');
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('memory/test.md');
  });

  it('shorter documents score higher than longer ones (length normalization)', () => {
    const chunks = [
      makeChunk('c1', 'target keyword'),
      makeChunk('c2', 'target keyword plus many other words that pad the document length out'),
    ];
    const index = buildIndex(chunks);
    const scoreShort = scoreBM25(['target', 'keyword'], 'c1', index);
    const scoreLong = scoreBM25(['target', 'keyword'], 'c2', index);
    expect(scoreShort).toBeGreaterThan(scoreLong);
  });
});

describe('search', () => {
  it('AND semantics: matches chunks with all query terms', () => {
    const chunks = [
      makeChunk('c1', 'typescript vitest testing'),
      makeChunk('c2', 'typescript react components'),
      makeChunk('c3', 'python flask testing'),
    ];
    const index = buildIndex(chunks);
    const results = search(index, 'typescript testing');
    // c1 has both terms, should be the top result
    expect(results[0].path).toBe('memory/test.md');
    // AND yields c1 only; c2 and c3 each lack one term
    expect(results).toHaveLength(1);
  });

  it('OR fallback: returns results when AND yields nothing', () => {
    const chunks = [makeChunk('c1', 'typescript framework'), makeChunk('c2', 'python framework')];
    const index = buildIndex(chunks);
    // No single doc has both "typescript" and "python"
    const results = search(index, 'typescript python');
    expect(results.length).toBeGreaterThan(0);
  });

  it('results sorted by score descending', () => {
    const chunks = [
      makeChunk('c1', 'machine learning deep learning neural networks'),
      makeChunk('c2', 'machine learning algorithms'),
      makeChunk('c3', 'cooking recipes pasta'),
    ];
    const index = buildIndex(chunks);
    const results = search(index, 'machine learning');
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });

  it('minScore filters low-scoring results', () => {
    const chunks = [
      makeChunk('c1', 'exact match keyword'),
      makeChunk('c2', 'some unrelated content stuff words'),
    ];
    const index = buildIndex(chunks);
    const results = search(index, 'keyword', { minScore: 0.5 });
    // Only the exact match doc should remain at high minScore
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('maxResults limits output count', () => {
    const chunks = Array.from({ length: 20 }, (_, i) =>
      makeChunk(`c${i}`, `result content item ${i}`),
    );
    const index = buildIndex(chunks);
    const results = search(index, 'result content', { maxResults: 5 });
    expect(results.length).toBeLessThanOrEqual(5);
  });
});
