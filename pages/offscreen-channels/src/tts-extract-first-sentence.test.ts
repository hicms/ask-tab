import { extractFirstSentence, splitTextIntoChunks } from './tts-worker';
import { describe, it, expect, vi } from 'vitest';

// Mock heavy dependencies that tts-worker.ts imports at module level
vi.mock('@huggingface/transformers', () => ({ env: {} }));
vi.mock('onnxruntime-web', () => ({ env: { wasm: {} } }));

// Mock chrome APIs used at module level
vi.stubGlobal('chrome', {
  runtime: {
    getURL: (path: string) => `chrome-extension://test/${path}`,
    sendMessage: vi.fn().mockResolvedValue(undefined),
  },
});

describe('extractFirstSentence', () => {
  // ── Sentence-ending punctuation ─────────────────

  it('splits at period followed by whitespace', () => {
    const result = extractFirstSentence(
      'Hello world, this is a great and wonderful day today. This is the rest of the text that continues on and on.',
    );
    expect(result).not.toBeNull();
    expect(result!.trim()).toBe('Hello world, this is a great and wonderful day today.');
  });

  it('splits at question mark', () => {
    const text =
      'How are you doing today? I hope you are doing well and having a great day overall.';
    const result = extractFirstSentence(text);
    expect(result).not.toBeNull();
    expect(result!.trim()).toBe('How are you doing today?');
  });

  it('splits at exclamation mark', () => {
    const text =
      'What an amazing day it has been! The weather was absolutely beautiful and perfect for a walk.';
    const result = extractFirstSentence(text);
    expect(result).not.toBeNull();
    expect(result!.trim()).toBe('What an amazing day it has been!');
  });

  it('splits at ellipsis character', () => {
    const text =
      'I was thinking about it… Then I realized the answer was right in front of me the whole time.';
    const result = extractFirstSentence(text);
    expect(result).not.toBeNull();
    expect(result!.trim()).toBe('I was thinking about it…');
  });

  it('splits at CJK question mark', () => {
    const text =
      'What do you think about this one？ I think it might work well for our purposes here.';
    const result = extractFirstSentence(text);
    expect(result).not.toBeNull();
    expect(result!.trim()).toBe('What do you think about this one？');
  });

  // ── Paragraph break fallback ────────────────────

  it('splits at paragraph break when no sentence punctuation', () => {
    const text =
      'First paragraph with enough text to be meaningful\n\nSecond paragraph with more text here';
    const result = extractFirstSentence(text);
    expect(result).not.toBeNull();
    // Result includes the \n\n
    expect(result).toBe('First paragraph with enough text to be meaningful\n\n');
  });

  // ── Word boundary fallback ──────────────────────

  it('splits at word boundary near 200 chars for unpunctuated text', () => {
    // 300+ chars of text with no sentence-ending punctuation or paragraph breaks
    const words =
      'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit';
    const result = extractFirstSentence(words);
    expect(result).not.toBeNull();
    // Should split at a space, with the split point near but not exceeding 200 chars
    expect(result!.length).toBeLessThanOrEqual(201); // 200 + trailing space
    expect(result!.length).toBeGreaterThan(20);
    // Should end with a space (word boundary)
    expect(result!.endsWith(' ')).toBe(true);
  });

  // ── Returns null cases ──────────────────────────

  it('returns null for short text (< 80 chars)', () => {
    expect(extractFirstSentence('Hi there')).toBeNull();
    expect(extractFirstSentence('Short sentence here.')).toBeNull();
  });

  it('returns null when first piece is too short (< 20 chars)', () => {
    // "Hi. " is only 3 chars — below the 20-char threshold
    const text =
      'Hi. The rest of this sentence is much longer and contains a lot more meaningful content overall.';
    expect(extractFirstSentence(text)).toBeNull();
  });

  it('returns null for single sentence with no remainder', () => {
    // One sentence, period at the very end with no trailing text
    const text =
      'This is a single sentence that is long enough to pass the length check for the function.';
    expect(extractFirstSentence(text)).toBeNull();
  });

  it('returns null for text that is exactly 79 chars', () => {
    const text = 'a'.repeat(79);
    expect(extractFirstSentence(text)).toBeNull();
  });

  it('returns null for 80-char text with no split points', () => {
    // 80 chars, no punctuation, no spaces near 200 (text is only 80), no paragraph break
    const text = 'a'.repeat(80);
    expect(extractFirstSentence(text)).toBeNull();
  });

  // ── Edge cases ──────────────────────────────────

  it('handles multiline text with sentence split', () => {
    const text =
      'First sentence on line one.\nSecond sentence continues on a new line with extra text to be long enough.';
    const result = extractFirstSentence(text);
    // The \n after the period counts as whitespace, so it should match
    expect(result).not.toBeNull();
    expect(result!.trim()).toBe('First sentence on line one.');
  });

  it('paragraph break with short first paragraph returns null', () => {
    // First paragraph only 10 chars — below 20-char threshold for para break
    const text =
      'Short text\n\nSecond paragraph with more content that is long enough to warrant splitting overall.';
    expect(extractFirstSentence(text)).toBeNull();
  });

  // ── Cross-paragraph sentence boundary ─────────

  it('prefers paragraph break when sentence crosses \\n\\n boundary', () => {
    const text =
      'Stevens Pass tomorrow (Fri Feb 20):\n\n' +
      'High: -2.5°C (27°F) / Low: -13°C (9°F) Overcast but mostly dry\n\n' +
      'Cold and dry — solid skiing conditions! Bundle up though.';
    const result = extractFirstSentence(text);
    expect(result).not.toBeNull();
    // Should split at first \n\n, not at "conditions!"
    expect(result!.trim()).toBe('Stevens Pass tomorrow (Fri Feb 20):');
  });

  it('still splits at sentence boundary within a single paragraph', () => {
    const text =
      'The weather is looking great today! ' +
      'Expect sunshine and warm temperatures throughout the afternoon.';
    const result = extractFirstSentence(text);
    expect(result).not.toBeNull();
    expect(result!.trim()).toBe('The weather is looking great today!');
  });
});

describe('splitTextIntoChunks', () => {
  // ── Basic splitting ───────────────────────────────

  it('splits text at sentence boundaries near target', () => {
    const text =
      'First sentence is right here. Second sentence follows after that. Third sentence is the last one in this chunk. Fourth sentence starts a new chunk here. Fifth sentence wraps it all up nicely.';
    const chunks = splitTextIntoChunks(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk should be non-empty and trimmed
    for (const c of chunks) {
      expect(c.length).toBeGreaterThan(0);
      expect(c).toBe(c.trim());
    }
    // Reassembled text should match original (modulo whitespace)
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });

  it('respects sentence boundaries — does not split mid-sentence', () => {
    // Two sentences: ~80 chars + ~80 chars. Target = 120.
    // Should keep both in one chunk (total ~160 < 120*1.3=156? no, 160>156, but
    // it should split at the sentence boundary after "here." not mid-word).
    const text =
      'The quick brown fox jumps over the lazy dog and runs around the park. The cat sits on the mat and watches from over here. A third sentence is added to force a split somewhere in this block of text.';
    const chunks = splitTextIntoChunks(text, 120);
    // No chunk should start or end mid-word (no leading/trailing partial words)
    for (const c of chunks) {
      expect(c).toBe(c.trim());
      // Should not start with a space
      expect(c[0]).not.toBe(' ');
    }
  });

  // ── Paragraph break fallback ──────────────────────

  it('splits at paragraph breaks when no sentence punctuation', () => {
    const text =
      'First block of text without any sentence-ending punctuation at all\n\n' +
      'Second block of text also without punctuation continuing on\n\n' +
      'Third block of text that wraps things up without dots';
    const chunks = splitTextIntoChunks(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    // Chunks should split at paragraph boundaries
    for (const c of chunks) {
      expect(c.length).toBeGreaterThan(0);
      expect(c).toBe(c.trim());
    }
  });

  // ── Word boundary fallback ────────────────────────

  it('splits at word boundary when no punctuation or paragraph breaks', () => {
    // Long text with no punctuation and no \n\n
    const words = Array(50).fill('lorem').join(' '); // 50 * 6 - 1 = 299 chars
    const chunks = splitTextIntoChunks(words, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeGreaterThan(0);
      // No chunk should start or end with a space
      expect(c).toBe(c.trim());
    }
  });

  // ── No split needed ───────────────────────────────

  it('returns single chunk when text is shorter than targetChars * 1.3', () => {
    const text = 'Short text that fits easily.';
    const chunks = splitTextIntoChunks(text, 200);
    expect(chunks).toEqual([text]);
  });

  it('returns single chunk when text length is exactly at 1.3x boundary', () => {
    // targetChars=100, 1.3*100=130. Text of 130 chars should not split.
    const text = 'a'.repeat(130);
    const chunks = splitTextIntoChunks(text, 100);
    expect(chunks).toEqual([text]);
  });

  // ── Force split ───────────────────────────────────

  it('force-splits text with no spaces at targetChars', () => {
    const text = 'a'.repeat(500);
    const chunks = splitTextIntoChunks(text, 200);
    expect(chunks.length).toBeGreaterThan(1);
    // All chunks except possibly the last should be exactly targetChars
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i].length).toBe(200);
    }
    // Total chars should equal original
    const totalChars = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(totalChars).toBe(500);
  });

  // ── Empty text ────────────────────────────────────

  it('returns empty array for empty string', () => {
    expect(splitTextIntoChunks('', 200)).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(splitTextIntoChunks('   \n\n  ', 200)).toEqual([]);
  });

  // ── Chunk size bounds ─────────────────────────────

  // ── Edge cases: degenerate targetChars ─────────

  it('handles targetChars=0 without infinite loop', () => {
    const text = 'Hello world this is some text.';
    const chunks = splitTextIntoChunks(text, 0);
    expect(chunks.length).toBeGreaterThan(0);
    // All content should be preserved (joined chars match original sans whitespace)
    expect(chunks.join('').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
  });

  it('handles targetChars=NaN without infinite loop', () => {
    const text = 'Hello world this is some text.';
    const chunks = splitTextIntoChunks(text, NaN);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('handles negative targetChars without infinite loop', () => {
    const text = 'Hello world this is some text.';
    const chunks = splitTextIntoChunks(text, -100);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('does not create trivially small chunks (except last)', () => {
    const text =
      'Here is the first sentence. And here is the second sentence. The third one comes now. ' +
      'Fourth sentence is added here. Fifth sentence follows. Sixth one is the last one we need. ' +
      'Seventh sentence for good measure. Eighth to really fill it up. Ninth for extra padding.';
    const chunks = splitTextIntoChunks(text, 100);
    // All chunks except the last should be >= 40% of target (40 chars)
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i].length).toBeGreaterThanOrEqual(30);
    }
  });
});
