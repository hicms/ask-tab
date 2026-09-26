import { chunkText } from './memory-chunker';
import { describe, it, expect } from 'vitest';

describe('chunkText', () => {
  it('empty content returns empty array', async () => {
    expect(await chunkText('')).toEqual([]);
  });

  it('single short line returns single chunk', async () => {
    const chunks = await chunkText('Hello world');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('Hello world');
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(1);
  });

  it('content within maxChars returns single chunk with correct line numbers', async () => {
    const content = 'Line 1\nLine 2\nLine 3';
    const chunks = await chunkText(content, { maxChars: 1600 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(3);
    expect(chunks[0].text).toBe(content);
  });

  it('content exceeding maxChars produces multiple chunks with overlap', async () => {
    // Create content that will exceed maxChars
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}: ${'x'.repeat(40)}`);
    const content = lines.join('\n');
    const chunks = await chunkText(content, { maxChars: 200, overlapChars: 50 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('overlap lines appear in consecutive chunks', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}: ${'a'.repeat(30)}`);
    const content = lines.join('\n');
    const chunks = await chunkText(content, { maxChars: 200, overlapChars: 80 });

    if (chunks.length >= 2) {
      // Second chunk should start before first chunk ends
      expect(chunks[1].startLine).toBeLessThanOrEqual(chunks[0].endLine);
    }
  });

  it('very long single line is split into segments', async () => {
    const longLine = 'a'.repeat(500);
    const chunks = await chunkText(longLine, { maxChars: 200, overlapChars: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    // All segments share the same line number
    for (const chunk of chunks) {
      expect(chunk.startLine).toBe(1);
      expect(chunk.endLine).toBe(1);
    }
  });

  it('small file with less content than overlap returns single chunk', async () => {
    const content = 'Short';
    const chunks = await chunkText(content, { maxChars: 1600, overlapChars: 320 });
    expect(chunks).toHaveLength(1);
  });

  it('content hash is deterministic', async () => {
    const content = 'Hello world\nSecond line';
    const chunks1 = await chunkText(content);
    const chunks2 = await chunkText(content);
    expect(chunks1[0].contentHash).toBe(chunks2[0].contentHash);
  });

  it('different content produces different hashes', async () => {
    const chunks1 = await chunkText('Content A');
    const chunks2 = await chunkText('Content B');
    expect(chunks1[0].contentHash).not.toBe(chunks2[0].contentHash);
  });

  it('line numbers are 1-based', async () => {
    const content = 'First\nSecond\nThird';
    const chunks = await chunkText(content);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(3);
  });
});
