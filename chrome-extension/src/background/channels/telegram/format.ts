// ──────────────────────────────────────────────
// Markdown → Telegram HTML Converter
// ──────────────────────────────────────────────
// Telegram's HTML parse mode supports a limited subset:
// <b>, <i>, <s>, <code>, <pre>, <blockquote>, <a href="">
// This converter takes LLM markdown output and produces safe Telegram HTML.

/** Placeholder to protect code blocks/inline code from further processing */
const PLACEHOLDER_PREFIX = '\x00CB';
const PLACEHOLDER_SUFFIX = '\x00CE';

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Convert markdown text to Telegram-safe HTML.
 *
 * Processing order:
 * 1. HTML-escape: & < > → entities
 * 2. Extract fenced code blocks → placeholders
 * 3. Extract inline code → placeholders
 * 4. Convert: **bold**, *italic*, _italic_, ~~strike~~, > blockquote, [link](url)
 * 5. Restore placeholders
 */
const formatTelegramHtml = (markdown: string): string => {
  if (!markdown) return '';

  // Strip null bytes to prevent placeholder collision
  // eslint-disable-next-line no-control-regex -- intentionally strips NUL used as placeholder sentinel
  markdown = markdown.replace(/\x00/g, '');

  const placeholders: string[] = [];
  const addPlaceholder = (html: string): string => {
    const idx = placeholders.length;
    placeholders.push(html);
    return `${PLACEHOLDER_PREFIX}${idx}${PLACEHOLDER_SUFFIX}`;
  };

  // 1. Escape HTML entities
  let text = escapeHtml(markdown);

  // 2. Extract fenced code blocks: ```lang\n...\n```
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    const trimmed = code.replace(/\n$/, '');
    if (lang) {
      return addPlaceholder(`<pre><code class="language-${lang}">${trimmed}</code></pre>`);
    }
    return addPlaceholder(`<pre>${trimmed}</pre>`);
  });

  // Also handle ``` without newline after lang (edge case)
  text = text.replace(/```([\s\S]*?)```/g, (_match, code: string) => {
    const trimmed = code.replace(/^\n/, '').replace(/\n$/, '');
    return addPlaceholder(`<pre>${trimmed}</pre>`);
  });

  // 3. Extract inline code: `...`
  text = text.replace(/`([^`\n]+)`/g, (_match, code: string) =>
    addPlaceholder(`<code>${code}</code>`),
  );

  // 4. Convert markdown formatting

  // Bold: **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  text = text.replace(/__(.+?)__/g, '<b>$1</b>');

  // Italic: *text* or _text_ (but not inside words with underscores like file_name)
  text = text.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, '<i>$1</i>');
  text = text.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '<i>$1</i>');

  // Strikethrough: ~~text~~
  text = text.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // Links: [text](url)
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');

  // Blockquotes: > text (at start of line)
  text = text.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  // Merge consecutive blockquotes
  text = text.replace(/<\/blockquote>\n<blockquote>/g, '\n');

  // Headers: # text → bold (Telegram has no header tag)
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

  // Horizontal rules: --- or *** → simple line
  text = text.replace(/^[-*]{3,}$/gm, '───────────────');

  // 5. Restore placeholders
  for (let i = placeholders.length - 1; i >= 0; i--) {
    text = text.replace(`${PLACEHOLDER_PREFIX}${i}${PLACEHOLDER_SUFFIX}`, placeholders[i]);
  }

  return text;
};

export { formatTelegramHtml };
