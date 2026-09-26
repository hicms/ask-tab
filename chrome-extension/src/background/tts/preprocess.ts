// ── TTS Text Preprocessing ────────────────────────────
// Strip markdown formatting and code blocks so TTS output
// sounds natural instead of reading out syntax characters.

/**
 * Preprocess text for TTS synthesis.
 * Strips markdown, removes code blocks, truncates to maxChars.
 */
const preprocessForTts = (text: string, maxChars: number): string => {
  let cleaned = text;

  // 1. Remove fenced code blocks (```lang\n...\n```)
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');

  // 2. Remove inline code
  cleaned = cleaned.replace(/`([^`]*)`/g, '$1');

  // 3. Strip markdown headers (### Title → Title)
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');

  // 4. Strip bold/italic
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
  cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
  cleaned = cleaned.replace(/_([^_]+)_/g, '$1');

  // 5. Strip strikethrough
  cleaned = cleaned.replace(/~~([^~]+)~~/g, '$1');

  // 6. Strip links [text](url) → text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // 7. Strip list bullets (- item, * item, + item)
  cleaned = cleaned.replace(/^[\s]*[-*+]\s+/gm, '');

  // 8. Strip numbered list prefixes (1. item)
  cleaned = cleaned.replace(/^[\s]*\d+\.\s+/gm, '');

  // 9. Strip markdown table rows (|...|)
  cleaned = cleaned.replace(/^\|.*\|$/gm, '');

  // 10. Strip horizontal rules (---, ***, ___)
  cleaned = cleaned.replace(/^[\s]*[-*_]{3,}[\s]*$/gm, '');

  // 11. Strip blockquotes (> text → text)
  cleaned = cleaned.replace(/^>\s?/gm, '');

  // 12. Collapse excessive whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  // 13. Truncate if too long
  if (cleaned.length > maxChars) {
    // Try to break at a sentence boundary
    const truncated = cleaned.slice(0, maxChars);
    const lastSentence = truncated.lastIndexOf('. ');
    if (lastSentence > maxChars * 0.7) {
      cleaned = truncated.slice(0, lastSentence + 1);
    } else {
      cleaned = truncated.trimEnd() + '...';
    }
  }

  return cleaned;
};

export { preprocessForTts };
