import type { ChatMessage } from '@extension/shared';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { UserMessage } from '@mariozechner/pi-ai';

/** Keep display history structured until context budgeting has finished. */
interface PortableHistory {
  role: 'portableHistory';
  messages: ChatMessage[];
  timestamp: number;
}

declare module '@mariozechner/pi-agent-core' {
  interface CustomAgentMessages {
    portableHistory: PortableHistory;
  }
}

const createPortableHistory = (history: ChatMessage[]): AgentMessage[] => {
  const messages = history
    .map(message => ({
      ...message,
      parts: message.parts.filter(part => part.type !== 'reasoning'),
    }))
    .filter(message => message.parts.length > 0);
  return messages.length
    ? [{ role: 'portableHistory', messages, timestamp: messages.at(-1)!.createdAt }]
    : [];
};

/** Serialize only after compaction; never replay another provider's tool protocol. */
const displayHistoryAsContext = (
  history: ChatMessage[],
  options: { includeSystem?: boolean } = {},
): UserMessage[] => {
  const lines: string[] = [];
  for (const message of history) {
    if (message.role === 'system' && !options.includeSystem) continue;
    const details = message.parts.flatMap(part => {
      if (part.type === 'text') return [part.text];
      if (part.type === 'tool-call')
        return [`Tool call: ${part.toolName} ${JSON.stringify(part.args)}`];
      if (part.type === 'tool-result')
        return [`Tool result (${part.toolName}): ${JSON.stringify(part.result)}`];
      if (part.type === 'file') return [`File: ${part.filename ?? part.mediaType ?? 'attachment'}`];
      return [];
    });
    if (details.length) lines.push(`${message.role}: ${details.join('\n')}`);
  }
  if (!lines.length) return [];
  return [
    {
      role: 'user',
      content: `Previous conversation context:\n${lines.join('\n\n')}`,
      timestamp: history.at(-1)?.createdAt ?? Date.now(),
    },
  ];
};

export { createPortableHistory, displayHistoryAsContext };
