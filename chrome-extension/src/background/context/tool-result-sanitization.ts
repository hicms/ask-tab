/**
 * Tool result sanitization for the compaction summarizer.
 *
 * Strips verbose fields and truncates large tool results/args before
 * passing messages to the LLM summarizer. Non-mutating.
 */

import type { ChatMessage, ChatMessagePart } from '@extension/shared';

const MAX_RESULT_CHARS = 1000;
const MAX_ARGS_CHARS = 1000;

/**
 * Truncate a value to a string representation of at most maxChars.
 */
const truncateValue = (value: unknown, maxChars: number): unknown => {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (str === undefined || str === null) return value;
  if (str.length <= maxChars) return value;
  return str.slice(0, maxChars) + `... [truncated ${str.length - maxChars} chars]`;
};

/**
 * Strip verbose fields from tool-result and tool-call parts for summarization.
 *
 * 1. Truncates tool-result.result to MAX_RESULT_CHARS
 * 2. Removes .details and .state fields from tool results
 * 3. Truncates tool-call.args if serialized > MAX_ARGS_CHARS
 *
 * Non-mutating — returns new array of messages.
 */
const stripToolResultDetails = (messages: ChatMessage[]): ChatMessage[] =>
  messages.map(msg => {
    const hasToolParts = msg.parts.some(p => p.type === 'tool-result' || p.type === 'tool-call');
    if (!hasToolParts) return msg;

    const newParts: ChatMessagePart[] = msg.parts.map(part => {
      if (part.type === 'tool-result') {
        const truncatedResult = truncateValue(part.result, MAX_RESULT_CHARS);
        // Rebuild without details/state
        return {
          type: 'tool-result' as const,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          result: truncatedResult,
        };
      }

      if (part.type === 'tool-call') {
        const argsStr = JSON.stringify(part.args);
        if (argsStr.length > MAX_ARGS_CHARS) {
          return {
            ...part,
            args: { _truncated: argsStr.slice(0, MAX_ARGS_CHARS) + '...' } as Record<
              string,
              unknown
            >,
          };
        }
        // Remove state field if present
        const { state: _, ...rest } = part;
        return rest as ChatMessagePart;
      }

      return part;
    });

    return { ...msg, parts: newParts };
  });

/**
 * Repair tool-use/result pairing in messages.
 *
 * 1. Drops orphaned tool-result parts that have no matching tool-call
 * 2. Inserts synthetic error results for orphaned tool-calls (no matching result)
 * 3. Deduplicates tool-result parts with the same toolCallId
 *
 * Non-mutating — returns a new array.
 */
const repairToolUseResultPairing = (messages: ChatMessage[]): ChatMessage[] => {
  // Pass 1: collect all tool-call IDs and tool-result IDs
  const knownToolCallIds = new Set<string>();
  const knownToolResultIds = new Set<string>();

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === 'tool-call') {
        knownToolCallIds.add(part.toolCallId);
      } else if (part.type === 'tool-result') {
        knownToolResultIds.add(part.toolCallId);
      }
    }
  }

  // Pass 2: repair messages
  const seenResultIds = new Set<string>();

  return messages
    .map(msg => {
      let parts = msg.parts;
      let modified = false;

      // Remove orphaned tool-results (no matching tool-call)
      if (parts.some(p => p.type === 'tool-result')) {
        const filtered = parts.filter(part => {
          if (part.type === 'tool-result') {
            // Drop if no matching tool-call exists
            if (!knownToolCallIds.has(part.toolCallId)) return false;
            // Deduplicate: drop if we've already seen a result for this call
            if (seenResultIds.has(part.toolCallId)) return false;
            seenResultIds.add(part.toolCallId);
          }
          return true;
        });

        if (filtered.length !== parts.length) {
          parts = filtered;
          modified = true;
        }
      }

      // Insert synthetic error results for orphaned tool-calls (no matching result)
      if (msg.role === 'assistant' && parts.some(p => p.type === 'tool-call')) {
        const orphanedCalls = parts.filter(
          p => p.type === 'tool-call' && !knownToolResultIds.has(p.toolCallId),
        );

        if (orphanedCalls.length > 0) {
          // We need to add synthetic results — but they go in a user-role message.
          // For now, mark them so the next user message can pick them up.
          // Instead, we'll handle this after the map by injecting synthetic messages.
          // For in-place repair, we just track which calls are orphaned.
        }
      }

      // If all parts were filtered out, keep a placeholder
      if (parts.length === 0) {
        return {
          ...msg,
          parts: [
            { type: 'text' as const, text: '[tool results removed — no matching tool call]' },
          ],
        };
      }

      return modified ? { ...msg, parts } : msg;
    })
    .flatMap((msg, idx, arr) => {
      // After each assistant message with orphaned tool-calls, inject synthetic error results
      if (msg.role !== 'assistant') return [msg];

      const orphanedCalls = msg.parts.filter(
        p => p.type === 'tool-call' && !knownToolResultIds.has(p.toolCallId),
      );

      if (orphanedCalls.length === 0) return [msg];

      // Check if the next message already has results for these calls
      const nextMsg = arr[idx + 1];
      const nextResultIds = new Set(
        nextMsg?.parts
          .filter(p => p.type === 'tool-result')
          .map(p => (p as { type: 'tool-result'; toolCallId: string }).toolCallId) ?? [],
      );

      const syntheticParts: ChatMessagePart[] = orphanedCalls
        .filter(
          p => !nextResultIds.has((p as { type: 'tool-call'; toolCallId: string }).toolCallId),
        )
        .filter(
          p => !seenResultIds.has((p as { type: 'tool-call'; toolCallId: string }).toolCallId),
        )
        .map(p => {
          const tc = p as { type: 'tool-call'; toolCallId: string; toolName: string };
          seenResultIds.add(tc.toolCallId);
          return {
            type: 'tool-result' as const,
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            result: '[error: tool result missing — likely lost during context compaction]',
          };
        });

      if (syntheticParts.length === 0) return [msg];

      // Insert a synthetic user message with the error results
      const syntheticMsg: ChatMessage = {
        id: `__synthetic_repair_${idx}__`,
        chatId: msg.chatId,
        role: 'user',
        parts: syntheticParts,
        createdAt: msg.createdAt + 1,
      };

      return [msg, syntheticMsg];
    });
};

/**
 * Comprehensive session transcript repair.
 * Runs all repairs in sequence:
 * 1. Remove empty messages
 * 2. Deduplicate messages
 * 3. Role ordering repair (ensure alternating user/assistant)
 * 4. Tool use/result pairing repair
 *
 * Non-mutating — returns a new array.
 */
const repairTranscript = (messages: ChatMessage[]): ChatMessage[] => {
  // Step 1: Remove empty messages
  let repaired = messages.filter(msg => {
    if (msg.parts.length === 0) return false;
    // Remove messages with only empty text parts
    const hasContent = msg.parts.some(p => {
      if (p.type === 'text') return p.text.trim().length > 0;
      return true; // non-text parts always count as content
    });
    return hasContent;
  });

  // Step 2: Deduplicate messages by content hash
  // Use a lightweight key for messages with tool parts to avoid serializing large results
  const seen = new Set<string>();
  repaired = repaired.filter(msg => {
    const hasToolParts = msg.parts.some(p => p.type === 'tool-result' || p.type === 'tool-call');
    const hash = hasToolParts
      ? `${msg.role}:${msg.parts.length}:${msg.parts.map(p => `${p.type}:${'toolCallId' in p ? p.toolCallId : ''}`).join(',')}`
      : `${msg.role}:${JSON.stringify(msg.parts)}`;
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });

  // Step 3: Role ordering repair — merge consecutive same-role messages
  // System messages can appear anywhere (skip in alternation check)
  const merged: ChatMessage[] = [];
  let lastNonSystemIdx = -1;
  for (const msg of repaired) {
    if (msg.role === 'system') {
      merged.push(msg);
      continue;
    }
    if (lastNonSystemIdx >= 0 && merged[lastNonSystemIdx]!.role === msg.role) {
      // Merge into the last same-role message
      merged[lastNonSystemIdx] = {
        ...merged[lastNonSystemIdx]!,
        parts: [...merged[lastNonSystemIdx]!.parts, ...msg.parts],
      };
    } else {
      merged.push(msg);
      lastNonSystemIdx = merged.length - 1;
    }
  }
  repaired = merged;

  // Step 4: Tool use/result pairing repair (existing function)
  repaired = repairToolUseResultPairing(repaired);

  return repaired;
};

export {
  stripToolResultDetails,
  repairToolUseResultPairing,
  repairTranscript,
  MAX_RESULT_CHARS,
  MAX_ARGS_CHARS,
};
