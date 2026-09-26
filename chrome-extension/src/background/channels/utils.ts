import type { ChannelConfig } from './types';

/**
 * Split text into chunks respecting a max length, breaking at newline boundaries.
 * Falls back to hard-split when no good newline is found.
 */
const splitMessage = (text: string, maxLength: number): string[] => {
  // F21: Return empty array for empty/whitespace-only text
  if (!text.trim()) return [];

  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find the last newline within the limit
    let splitAt = remaining.lastIndexOf('\n', maxLength);

    // If no good newline found, try splitting at last space
    if (splitAt <= 0) {
      splitAt = remaining.lastIndexOf(' ', maxLength);
    }

    // Hard-split if no natural break point
    if (splitAt <= 0) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    // F6c: Trim leading whitespace/newlines from the remainder
    remaining = remaining.slice(splitAt).replace(/^[\s\n]+/, '');
  }

  return chunks;
};

/**
 * Normalize a WhatsApp JID for allowlist comparison.
 * Strips the device suffix (e.g. "12345:67@s.whatsapp.net" → "12345@s.whatsapp.net")
 * so the allowlist can contain just the phone JID.
 */
const normalizeJidForAllowlist = (jid: string): string => {
  const atIdx = jid.indexOf('@');
  if (atIdx === -1) return jid;
  const user = jid.slice(0, atIdx);
  const domain = jid.slice(atIdx);
  // Remove device suffix (":N" where N is a number)
  const colonIdx = user.indexOf(':');
  if (colonIdx === -1) return jid;
  return user.slice(0, colonIdx) + domain;
};

/** Check if a sender is on the allowlist */
const isAllowedSender = (
  senderId: string,
  config: Pick<ChannelConfig, 'allowedSenderIds'>,
): boolean => {
  if (config.allowedSenderIds.length === 0) return false;
  if (config.allowedSenderIds.includes(senderId)) return true;
  // Fallback: check normalized JID (strips WhatsApp device suffix)
  const normalized = normalizeJidForAllowlist(senderId);
  return normalized !== senderId && config.allowedSenderIds.includes(normalized);
};

export { splitMessage, isAllowedSender };
