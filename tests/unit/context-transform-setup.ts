/**
 * Tests for context-transform.ts — createTransformContext
 * Verifies compaction pipeline and result reporting.
 * Note: Memory flush logic was moved to memory-flush.ts — see memory-flush.test.ts.
 */
import { vi } from 'vitest';
import type { ChatModel, ChatMessage } from '../../packages/shared/lib/chat-types.js';

// Import after mocks

// ── Mocks ────────────────────────────────────────────────

vi.mock('../../chrome-extension/src/background/context/compaction', () => ({
  compactMessagesWithSummary: vi.fn(),
  estimateMessageTokens: vi.fn(() => 100),
}));

vi.mock('../../chrome-extension/src/background/agents/message-adapter', () => ({
  chatMessagesToPiMessages: vi.fn((msgs: ChatMessage[]) =>
    msgs.map(m => ({
      role: m.role,
      content:
        m.role === 'user'
          ? (m.parts[0] as { type: 'text'; text: string })?.text || ''
          : (m.parts?.map((p: unknown) => ({
              type: 'text',
              text: (p as { text?: string }).text,
            })) ?? []),
      timestamp: m.createdAt,
      ...(m.role === 'assistant'
        ? {
            api: 'openai-completions',
            provider: 'openai',
            model: 'test',
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: 'stop',
          }
        : {}),
    })),
  ),
}));

vi.mock('../../chrome-extension/src/background/logging/logger-buffer', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  }),
}));

vi.mock('../../chrome-extension/src/background/ask-service/endpoint', () => ({
  getServiceUrl: () => 'http://ask.test',
  serviceUrlReady: async () => {},
}));
vi.mock('@extension/storage', () => ({
  updateCompactionSummary: vi.fn(async () => {}),
  incrementCompactionCount: vi.fn(async () => {}),
  updateCompactionMetadata: vi.fn(async () => {}),
  getChat: vi.fn(async () => null),
  getAgent: vi.fn(async () => undefined),
  getEnabledWorkspaceFiles: vi.fn(async () => []),
}));

vi.mock('../../chrome-extension/src/background/context/tool-result-context-guard', () => ({
  enforceToolResultBudget: vi.fn((msgs: ChatMessage[]) => msgs),
}));

vi.mock('../../chrome-extension/src/background/context/summarizer', () => ({
  extractCriticalRules: vi.fn(() => undefined),
}));

// ── Test fixtures ────────────────────────────────────────

const mockModelConfig: ChatModel = {
  id: 'gpt-4o',
  name: 'GPT-4o',
  provider: 'openai',
  routingMode: 'direct',
};

const makeAgentUserMessage = (text: string, ts?: number) => ({
  role: 'user' as const,
  content: text,
  timestamp: ts ?? Date.now(),
});

const makeAgentAssistantMessage = (text: string, ts?: number) => ({
  role: 'assistant' as const,
  content: [{ type: 'text' as const, text }],
  api: 'openai-completions' as const,
  provider: 'openai' as const,
  model: 'gpt-4o',
  usage: {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop' as const,
  timestamp: ts ?? Date.now(),
});

const defaultOpts = {
  chatId: 'chat-1',
  modelConfig: mockModelConfig,
  systemPromptTokens: 500,
};

export { makeAgentUserMessage, makeAgentAssistantMessage, defaultOpts };
