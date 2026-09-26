import { formatWhatsAppText } from './format';
import { describe, expect, it } from 'vitest';

describe('formatWhatsAppText', () => {
  it('converts bold **text** to *text*', () => {
    expect(formatWhatsAppText('**hello**')).toBe('*hello*');
  });

  it('converts bold __text__ to *text*', () => {
    expect(formatWhatsAppText('__hello__')).toBe('*hello*');
  });

  it('converts italic *text* to _text_', () => {
    // After bold conversion, remaining single * italic is converted to _
    expect(formatWhatsAppText('*hello*')).toBe('_hello_');
  });

  it('converts strikethrough ~~text~~ to ~text~', () => {
    expect(formatWhatsAppText('~~deleted~~')).toBe('~deleted~');
  });

  it('converts inline code to triple backtick', () => {
    expect(formatWhatsAppText('use `foo()` here')).toBe('use ```foo()``` here');
  });

  it('preserves fenced code blocks', () => {
    const input = '```\nsome code\n```';
    const result = formatWhatsAppText(input);
    expect(result).toContain('```');
    expect(result).toContain('some code');
  });

  it('converts fenced code blocks with language', () => {
    const input = '```js\nconsole.log("hi")\n```';
    const result = formatWhatsAppText(input);
    expect(result).toContain('```');
    expect(result).toContain('console.log("hi")');
  });

  it('converts links [text](url) to text (url)', () => {
    expect(formatWhatsAppText('[click](https://example.com)')).toBe('click (https://example.com)');
  });

  it('converts headers to bold', () => {
    expect(formatWhatsAppText('# Header')).toBe('*Header*');
    expect(formatWhatsAppText('## Sub-header')).toBe('*Sub-header*');
    expect(formatWhatsAppText('### Deep-header')).toBe('*Deep-header*');
  });

  it('converts horizontal rules to line separator', () => {
    expect(formatWhatsAppText('---')).toBe('───────────────');
    expect(formatWhatsAppText('***')).toBe('───────────────');
  });

  it('returns empty string for empty input', () => {
    expect(formatWhatsAppText('')).toBe('');
  });

  it('returns empty string for null-ish input', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(formatWhatsAppText(undefined as any)).toBe('');
  });

  it('strips null bytes to prevent placeholder collision', () => {
    const input = 'hello\x00world';
    const result = formatWhatsAppText(input);
    expect(result).not.toContain('\x00');
  });

  it('protects code blocks from formatting', () => {
    const input = '```\n**not bold** _not italic_\n```';
    const result = formatWhatsAppText(input);
    expect(result).toContain('**not bold**');
    expect(result).toContain('_not italic_');
  });

  it('handles mixed formatting', () => {
    const input = '**bold** and *italic* and `code`';
    const result = formatWhatsAppText(input);
    expect(result).toContain('*bold*');
    expect(result).toContain('_italic_');
    expect(result).toContain('```code```');
  });

  // ── Blockquote ──

  it('preserves > blockquote syntax', () => {
    const input = '> This is a blockquote';
    const result = formatWhatsAppText(input);
    expect(result).toContain('> This is a blockquote');
  });

  // ── Non-http links ──

  it('does not convert non-http/https links', () => {
    const input = '[link](ftp://example.com/file)';
    const result = formatWhatsAppText(input);
    // ftp:// should not be converted (regex only matches https?)
    expect(result).toContain('[link](ftp://example.com/file)');
  });

  // ── Multiple inline code segments ──

  it('multiple inline code segments in one line', () => {
    const input = 'use `foo()` and `bar()`';
    const result = formatWhatsAppText(input);
    expect(result).toContain('```foo()```');
    expect(result).toContain('```bar()```');
  });

  // ── Code block with backticks in content ──

  it('code block with backticks in content preserved', () => {
    const input = '```\nconst x = "test";\n```';
    const result = formatWhatsAppText(input);
    expect(result).toContain('const x = "test";');
  });

  // ── # not at line start ──

  it('# not at line start is not converted', () => {
    const input = 'This is a comment # not a header';
    const result = formatWhatsAppText(input);
    // Should NOT be converted to bold
    expect(result).toContain('#');
    expect(result).toBe('This is a comment # not a header');
  });

  // ── Nested bold inside italic ──

  it('nested bold inside italic', () => {
    const input = '*some **bold** text*';
    const result = formatWhatsAppText(input);
    // **bold** becomes *bold* (via placeholder), then outer * becomes _
    expect(result).toContain('*bold*');
  });

  // ── Underscore italic pass through ──

  it('underscore italic _text_ passes through', () => {
    const input = '_italic text_';
    const result = formatWhatsAppText(input);
    // Single underscore italic is already WA format
    expect(result).toContain('_italic text_');
  });

  // ── Multiple bold segments ──

  it('multiple bold segments in one line', () => {
    const input = '**a** and **b**';
    const result = formatWhatsAppText(input);
    expect(result).toContain('*a*');
    expect(result).toContain('*b*');
  });

  // ── Horizontal rule with 5+ dashes ──

  it('horizontal rule with 5+ dashes', () => {
    const result = formatWhatsAppText('-----');
    expect(result).toBe('───────────────');
  });

  // ── Double underscore with surrounding text ──

  it('double underscore with surrounding text', () => {
    const input = 'text __bold__ text';
    const result = formatWhatsAppText(input);
    expect(result).toContain('*bold*');
    expect(result).toContain('text');
  });
});
