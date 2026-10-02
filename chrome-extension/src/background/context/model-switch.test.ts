import { compactMessages, compactMessagesWithSummary } from './compaction';
import { createTransformContext } from './transform';
import { chatDb } from '../../../../packages/storage/lib/impl/chat-db';
import { convertToLlm } from '../agents/message-adapter';
import { loadModelHistory, modelSourceKey } from '../agents/model-transcript';
import { createPortableHistory, displayHistoryAsContext } from '../agents/portable-history';
import { createChat, saveModelTranscript } from '@extension/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatModel } from '@extension/shared';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));
vi.mock('./summarizer', () => ({
  summarizeMessages: vi.fn(async () => 'Earlier benchmark notes.'),
  summarizeInStages: vi.fn(async () => 'Earlier benchmark notes.'),
  shouldUseAdaptiveCompaction: vi.fn(() => false),
  extractCriticalRules: vi.fn(() => ''),
}));

const model: ChatModel = {
  id: 'source-model',
  name: 'Source',
  provider: 'custom',
  contextWindow: 128000,
};
const target: ChatModel = { ...model, id: 'target-model', name: 'Target' };
const chatId = 'switch-regression';
const message = (index: number, role: ChatMessage['role'], text: string): ChatMessage => ({
  id: `message-${index}`,
  chatId,
  role,
  parts: [{ type: 'text', text }],
  createdAt: index + 1,
});
const latest: AgentMessage = { role: 'user', content: 'Reply only OK.', timestamp: 1000 };
const history = Array.from({ length: 160 }, (_, index) =>
  message(
    index,
    index % 2 === 0 ? 'user' : 'assistant',
    index === 0 ? 'Keep these notes.' : `Record ${index}. ${'alpha beta gamma delta '.repeat(140)}`,
  ),
);
const wireTokens = (messages: AgentMessage[]): number =>
  convertToLlm(messages).reduce((sum, item) => {
    const text =
      typeof item.content === 'string'
        ? item.content
        : item.content.map(part => (part.type === 'text' ? part.text : '')).join('');
    return sum + Math.ceil(text.length / 3) + 4;
  }, 0);

beforeEach(async () => {
  await chatDb.modelTranscripts.clear();
  await chatDb.chats.clear();
  await createChat({ id: chatId, title: 'Regression', createdAt: 1, updatedAt: 1 });
});

describe('long history after switching models', () => {
  it('compacts 160 structured messages before encoding and honors a smaller provider window', async () => {
    await saveModelTranscript({
      chatId,
      schemaVersion: 1,
      status: 'complete',
      sourceKey: modelSourceKey(model),
      lastUiMessageId: history.at(-1)!.id,
      messages: [],
    });
    const loaded = await loadModelHistory(
      chatId,
      [...history, message(160, 'user', 'Reply only OK.')],
      target,
    );
    const prompt: AgentMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'Keep these notes.' },
        { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
      ],
      timestamp: 1000,
    };
    const input = [...loaded, prompt];
    const before = JSON.stringify(input);
    expect(wireTokens(input)).toBeGreaterThan(128000);
    const transform = createTransformContext({
      chatId,
      modelConfig: target,
      systemPromptTokens: 1000,
    });
    const output = await transform.transformContext(input);
    expect(wireTokens(output)).toBeLessThan(95000);
    expect(convertToLlm(output).at(-1)).toBe(prompt);
    expect(JSON.stringify(output)).toContain('Record 159.');
    expect(transform.getResult().wasCompacted).toBe(true);

    transform.prepareRetry(64000);
    const retried = await transform.transformContext(input);
    expect(wireTokens(retried)).toBeLessThan(wireTokens(output));
    expect(wireTokens(retried)).toBeLessThan(47000);
    expect(convertToLlm(retried).at(-1)).toBe(prompt);
    expect(JSON.stringify(input)).toBe(before);

    transform.prepareRetry(); // Providers may omit the numeric limit on another overflow.
    const reduced = await transform.transformContext(input);
    expect(wireTokens(reduced)).toBeLessThan(wireTokens(retried));
    expect(convertToLlm(reduced).at(-1)).toBe(prompt);
  });

  it('bounds huge tool output before it becomes ordinary portable text', async () => {
    const toolHistory = [
      message(0, 'user', 'Read the page.'),
      {
        ...message(1, 'assistant', ''),
        parts: [
          { type: 'reasoning' as const, text: 'private reasoning', signature: 'opaque-signature' },
          {
            type: 'tool-call' as const,
            toolCallId: 'lookup',
            toolName: 'web_fetch',
            args: { url: 'https://example.invalid' },
          },
          {
            type: 'tool-result' as const,
            toolCallId: 'lookup',
            toolName: 'web_fetch',
            result: `HEAD ${'alpha beta '.repeat(60000)} TAIL`,
            state: 'output-available' as const,
          },
        ],
      },
    ];
    const input = [...createPortableHistory(toolHistory), latest];
    const transform = createTransformContext({
      chatId,
      modelConfig: target,
      systemPromptTokens: 1000,
    });
    const wire = JSON.stringify(convertToLlm(await transform.transformContext(input)));
    expect(wire.length).toBeLessThan(20000);
    expect(wire).toContain('HEAD');
    expect(wire).toContain('TAIL');
    expect(wire).not.toContain('private reasoning');
    expect(wire).not.toContain('opaque-signature');
    expect(convertToLlm(input).every(item => item.role === 'user')).toBe(true);
  });

  it('repairs legacy two-message flattened histories without merging away the new prompt', async () => {
    const input = [...displayHistoryAsContext(history), latest];
    const transform = createTransformContext({
      chatId,
      modelConfig: target,
      systemPromptTokens: 1000,
    });
    const output = await transform.transformContext(input);
    expect(wireTokens(output)).toBeLessThan(95000);
    expect(output.at(-1)).toBe(latest);
    expect(JSON.stringify(convertToLlm(output)).match(/Reply only OK/g)).toHaveLength(1);
  });

  it('rejects an oversized current prompt locally instead of truncating it', async () => {
    const input = [message(0, 'user', 'current '.repeat(150000))];
    expect(() => compactMessages(input, target.id, 1000, 64000)).toThrow('latest message');
    await expect(
      compactMessagesWithSummary(input, target.id, target, { contextWindowOverride: 64000 }),
    ).rejects.toThrow('latest message');
  });
});
