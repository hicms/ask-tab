import { preprocessForTts } from './preprocess';
import { describe, it, expect } from 'vitest';

describe('preprocessForTts', () => {
  const MAX = 200;

  // ── Code blocks ─────────────────────────────────
  it('removes fenced code blocks', () => {
    const input = 'Before\n```js\nconst x = 1;\n```\nAfter';
    const result = preprocessForTts(input, MAX);
    expect(result).not.toContain('const x');
    expect(result).not.toContain('```');
    expect(result).toContain('Before');
    expect(result).toContain('After');
  });

  it('removes inline code backticks but keeps text', () => {
    const result = preprocessForTts('Use the `forEach` method', MAX);
    expect(result).toBe('Use the forEach method');
  });

  it('handles input that is only code blocks', () => {
    const input = '```\nsome code\n```';
    const result = preprocessForTts(input, MAX);
    expect(result.trim()).toBe('');
  });

  // ── Markdown formatting ─────────────────────────
  it('strips headers', () => {
    expect(preprocessForTts('### Title', MAX)).toBe('Title');
    expect(preprocessForTts('# H1', MAX)).toBe('H1');
    expect(preprocessForTts('###### H6', MAX)).toBe('H6');
  });

  it('strips bold', () => {
    expect(preprocessForTts('This is **bold** text', MAX)).toBe('This is bold text');
  });

  it('strips italic (asterisks)', () => {
    expect(preprocessForTts('This is *italic* text', MAX)).toBe('This is italic text');
  });

  it('strips bold (underscores)', () => {
    expect(preprocessForTts('This is __bold__ text', MAX)).toBe('This is bold text');
  });

  it('strips italic (underscores)', () => {
    expect(preprocessForTts('This is _italic_ text', MAX)).toBe('This is italic text');
  });

  it('strips strikethrough', () => {
    expect(preprocessForTts('This is ~~deleted~~ text', MAX)).toBe('This is deleted text');
  });

  it('strips links, keeping text', () => {
    expect(preprocessForTts('Click [here](https://example.com) now', MAX)).toBe('Click here now');
  });

  it('strips list bullets (dash)', () => {
    const input = '- item one\n- item two';
    const result = preprocessForTts(input, MAX);
    expect(result).toContain('item one');
    expect(result).toContain('item two');
    expect(result).not.toContain('- ');
  });

  it('strips list bullets (asterisk)', () => {
    const input = '* item one\n* item two';
    const result = preprocessForTts(input, MAX);
    expect(result).not.toContain('* ');
  });

  it('strips numbered list prefixes', () => {
    const input = '1. first\n2. second';
    const result = preprocessForTts(input, MAX);
    expect(result).toContain('first');
    expect(result).not.toMatch(/^\d+\./m);
  });

  it('strips table rows', () => {
    const input = 'Before\n| a | b |\n|---|---|\n| 1 | 2 |\nAfter';
    const result = preprocessForTts(input, MAX);
    expect(result).toContain('Before');
    expect(result).toContain('After');
    expect(result).not.toContain('|');
  });

  it('strips horizontal rules', () => {
    const input = 'Before\n---\nAfter';
    const result = preprocessForTts(input, MAX);
    expect(result).toContain('Before');
    expect(result).toContain('After');
    expect(result).not.toContain('---');
  });

  it('strips blockquotes', () => {
    const result = preprocessForTts('> This is a quote', MAX);
    expect(result).toBe('This is a quote');
  });

  // ── Whitespace ──────────────────────────────────
  it('collapses excessive newlines', () => {
    const input = 'A\n\n\n\n\nB';
    const result = preprocessForTts(input, MAX);
    expect(result).toBe('A\n\nB');
  });

  // ── Truncation ──────────────────────────────────
  it('truncates text exceeding maxChars', () => {
    const longText = 'A '.repeat(200); // 400 chars
    const result = preprocessForTts(longText, 100);
    expect(result.length).toBeLessThanOrEqual(103); // 100 + '...'
  });

  it('truncates at sentence boundary when possible', () => {
    // Build text where a sentence ends within the last 30% of maxChars
    const text =
      'First sentence here. Second sentence is also here. Third sentence continues on and on and on to make this longer.';
    const result = preprocessForTts(text, 60);
    // Should cut at ". " boundary
    expect(result).toMatch(/\.$/);
    expect(result.length).toBeLessThanOrEqual(60);
  });

  it('preserves short text unchanged', () => {
    expect(preprocessForTts('Hello world', MAX)).toBe('Hello world');
  });

  // ── Edge cases ──────────────────────────────────
  it('handles empty input', () => {
    expect(preprocessForTts('', MAX)).toBe('');
  });

  it('handles plain text without markdown', () => {
    const text = 'This is just a normal sentence with no markdown.';
    expect(preprocessForTts(text, MAX)).toBe(text);
  });

  it('handles complex mixed markdown', () => {
    const input = `### Summary

**Key points:**
- First item with *emphasis*
- Second item with [a link](http://example.com)

> A blockquote here

\`\`\`python
print("hello")
\`\`\`

Final paragraph.`;
    const result = preprocessForTts(input, MAX);
    expect(result).toContain('Summary');
    expect(result).toContain('First item with emphasis');
    expect(result).toContain('a link');
    expect(result).toContain('A blockquote here');
    expect(result).toContain('Final paragraph.');
    expect(result).not.toContain('**');
    expect(result).not.toContain('```');
    expect(result).not.toContain('print(');
  });
});
