import { formatTelegramHtml } from '../telegram/format';
import { describe, expect, it } from 'vitest';

describe('formatTelegramHtml', () => {
  it('converts bold **text** to <b>', () => {
    expect(formatTelegramHtml('**hello**')).toBe('<b>hello</b>');
  });

  it('converts bold __text__ to <b>', () => {
    expect(formatTelegramHtml('__hello__')).toBe('<b>hello</b>');
  });

  it('converts italic *text* to <i>', () => {
    expect(formatTelegramHtml('*hello*')).toBe('<i>hello</i>');
  });

  it('converts italic _text_ to <i>', () => {
    expect(formatTelegramHtml('_hello_')).toBe('<i>hello</i>');
  });

  it('converts strikethrough ~~text~~ to <s>', () => {
    expect(formatTelegramHtml('~~deleted~~')).toBe('<s>deleted</s>');
  });

  it('converts inline code to <code>', () => {
    expect(formatTelegramHtml('use `foo()` here')).toBe('use <code>foo()</code> here');
  });

  it('converts fenced code blocks to <pre>', () => {
    const input = '```\nsome code\n```';
    expect(formatTelegramHtml(input)).toContain('<pre>');
    expect(formatTelegramHtml(input)).toContain('some code');
  });

  it('converts fenced code blocks with language to <pre><code>', () => {
    const input = '```js\nconsole.log("hi")\n```';
    const result = formatTelegramHtml(input);
    expect(result).toContain('<pre><code class="language-js">');
    expect(result).toContain('console.log(&quot;hi&quot;)');
  });

  it('converts links [text](url) to <a href>', () => {
    expect(formatTelegramHtml('[click](https://example.com)')).toBe(
      '<a href="https://example.com">click</a>',
    );
  });

  it('converts blockquotes > text to <blockquote>', () => {
    expect(formatTelegramHtml('> quoted text')).toBe('<blockquote>quoted text</blockquote>');
  });

  it('merges consecutive blockquotes', () => {
    const input = '> line1\n> line2';
    const result = formatTelegramHtml(input);
    expect(result).toBe('<blockquote>line1\nline2</blockquote>');
  });

  it('converts headers to bold', () => {
    expect(formatTelegramHtml('# Header')).toBe('<b>Header</b>');
    expect(formatTelegramHtml('## Sub-header')).toBe('<b>Sub-header</b>');
    expect(formatTelegramHtml('### Deep-header')).toBe('<b>Deep-header</b>');
  });

  it('escapes HTML entities & < > "', () => {
    expect(formatTelegramHtml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });

  it('strips null bytes to prevent placeholder collision', () => {
    const input = 'hello\x00world';
    const result = formatTelegramHtml(input);
    expect(result).not.toContain('\x00');
    expect(result).toBe('helloworld');
  });

  it('protects code blocks from formatting', () => {
    const input = '```\n**not bold** _not italic_\n```';
    const result = formatTelegramHtml(input);
    expect(result).not.toContain('<b>');
    expect(result).not.toContain('<i>');
    expect(result).toContain('**not bold**');
  });

  it('returns empty string for empty input', () => {
    expect(formatTelegramHtml('')).toBe('');
  });

  it('returns empty string for null-ish input', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(formatTelegramHtml(undefined as any)).toBe('');
  });

  it('converts horizontal rules to line separator', () => {
    expect(formatTelegramHtml('---')).toBe('───────────────');
    expect(formatTelegramHtml('***')).toBe('───────────────');
  });

  it('handles mixed formatting', () => {
    const input = '**bold** and *italic* and `code`';
    const result = formatTelegramHtml(input);
    expect(result).toContain('<b>bold</b>');
    expect(result).toContain('<i>italic</i>');
    expect(result).toContain('<code>code</code>');
  });
});
