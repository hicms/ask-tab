/**
 * Converts chat messages into a plain-text transcript for LLM consumption.
 * Works with both DbChatMessage and ChatMessage shapes.
 */

interface SerializableMessage {
  role: string;
  parts: Array<{ type: string; [key: string]: unknown }>;
  createdAt: number;
}

const DEFAULT_MAX_CHARS = 8000;

/**
 * Serialize an array of chat messages into a readable transcript string.
 * Truncates from the front (keeps recent messages) to fit within maxChars.
 * Returns empty string for empty/trivial content.
 */
const serializeTranscript = (
  messages: SerializableMessage[],
  maxChars: number = DEFAULT_MAX_CHARS,
): string => {
  if (messages.length === 0) return '';

  const lines: string[] = [];

  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'Assistant' : msg.role === 'user' ? 'User' : 'System';
    const textParts: string[] = [];

    for (const part of msg.parts) {
      if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        textParts.push(part.text.trim());
      } else if (part.type === 'tool-call' && typeof part.toolName === 'string') {
        textParts.push(`[Tool: ${part.toolName}]`);
      } else if (part.type === 'tool-result') {
        // Skip tool results — they're noise for journal purposes
      } else if (part.type === 'reasoning' && typeof part.text === 'string') {
        // Skip reasoning — internal model thoughts
      }
    }

    if (textParts.length > 0) {
      lines.push(`${role}: ${textParts.join(' ')}`);
    }
  }

  if (lines.length === 0) return '';

  // Join all lines, then truncate from the front to keep recent context
  let transcript = lines.join('\n');

  if (transcript.length > maxChars) {
    transcript = transcript.slice(-maxChars);
    // Clean up — start at the first complete line
    const firstNewline = transcript.indexOf('\n');
    if (firstNewline > 0) {
      transcript = transcript.slice(firstNewline + 1);
    }
  }

  return transcript;
};

export { serializeTranscript };
export type { SerializableMessage };
