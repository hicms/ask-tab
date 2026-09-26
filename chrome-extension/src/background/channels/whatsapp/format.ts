// ──────────────────────────────────────────────
// Markdown → WhatsApp Markup Converter
// ──────────────────────────────────────────────
// WhatsApp uses its own markup syntax:
//   *bold*  _italic_  ~strikethrough~  ```code```
//   > blockquote (supported since 2024)

/** Placeholder to protect code blocks from further processing */
const PLACEHOLDER_PREFIX = '\x00CB';
const PLACEHOLDER_SUFFIX = '\x00CE';

/**
 * Convert markdown text to WhatsApp markup.
 *
 * Processing order:
 * 1. Extract fenced code blocks → placeholders
 * 2. Convert inline code: `x` → ```x```
 * 3. Convert bold: **x** → *x*
 * 4. Convert italic: *x* → _x_ (after bold, so ** is already consumed)
 * 5. Convert strikethrough: ~~x~~ → ~x~
 * 6. Convert links: [text](url) → text (url)
 * 7. Convert headers: # text → *text*
 * 8. Restore placeholders
 */
const formatWhatsAppText = (markdown: string): string => {
  if (!markdown) return '';

  // Strip null bytes to prevent placeholder collision
  // eslint-disable-next-line no-control-regex -- intentionally strips NUL used as placeholder sentinel
  markdown = markdown.replace(/\x00/g, '');

  const placeholders: string[] = [];
  const addPlaceholder = (text: string): string => {
    const idx = placeholders.length;
    placeholders.push(text);
    return `${PLACEHOLDER_PREFIX}${idx}${PLACEHOLDER_SUFFIX}`;
  };

  let text = markdown;

  // 1. Extract fenced code blocks: ```lang\n...\n```
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang: string, code: string) => {
    const trimmed = code.replace(/\n$/, '');
    return addPlaceholder(`\`\`\`${trimmed}\`\`\``);
  });

  // Also handle ``` without newline after lang
  text = text.replace(/```([\s\S]*?)```/g, (_match, code: string) => {
    const trimmed = code.replace(/^\n/, '').replace(/\n$/, '');
    return addPlaceholder(`\`\`\`${trimmed}\`\`\``);
  });

  // 2. Convert inline code: `x` → ```x```
  text = text.replace(/`([^`\n]+)`/g, (_match, code: string) =>
    addPlaceholder(`\`\`\`${code}\`\`\``),
  );

  // 3. Convert bold: **text** or __text__ → *text* (protect with placeholders to avoid
  //    the italic regex re-matching the output)
  text = text.replace(/\*\*(.+?)\*\*/g, (_match, content: string) =>
    addPlaceholder(`*${content}*`),
  );
  text = text.replace(/__(.+?)__/g, (_match, content: string) => addPlaceholder(`*${content}*`));

  // 4. Convert italic: *text* (single asterisk) → _text_
  // After step 3, bold markers are replaced with placeholders, so remaining *text* are italic
  text = text.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '_$1_');
  // Underscore italic _text_ is already correct for WhatsApp — no conversion needed

  // 5. Convert strikethrough: ~~text~~ → ~text~
  text = text.replace(/~~(.+?)~~/g, '~$1~');

  // 6. Convert links: [text](url) → text (url)
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)');

  // 7. Convert headers: # text → *text*
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // 8. Horizontal rules: --- or *** → simple line
  text = text.replace(/^[-*]{3,}$/gm, '───────────────');

  // 9. Restore placeholders
  for (let i = placeholders.length - 1; i >= 0; i--) {
    text = text.replace(`${PLACEHOLDER_PREFIX}${i}${PLACEHOLDER_SUFFIX}`, placeholders[i]);
  }

  return text;
};

export { formatWhatsAppText };
