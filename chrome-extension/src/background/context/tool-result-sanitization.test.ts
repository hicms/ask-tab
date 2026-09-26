import {
  repairToolUseResultPairing,
  repairTranscript,
  stripToolResultDetails,
} from './tool-result-sanitization';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@extension/shared';

const makeMessage = (role: 'user' | 'assistant', parts: ChatMessage['parts']): ChatMessage => ({
  id: 'msg-1',
  chatId: 'chat-1',
  role,
  parts,
  createdAt: Date.now(),
});

describe('stripToolResultDetails', () => {
  it('passes through messages without tool parts', () => {
    const messages = [
      makeMessage('user', [{ type: 'text', text: 'hello' }]),
      makeMessage('assistant', [{ type: 'text', text: 'world' }]),
    ];
    const result = stripToolResultDetails(messages);
    expect(result).toEqual(messages);
  });

  it('truncates large tool-result values', () => {
    const largeResult = 'x'.repeat(2000);
    const messages = [
      makeMessage('assistant', [
        {
          type: 'tool-result',
          toolCallId: 'tc-1',
          toolName: 'web_search',
          result: largeResult,
        },
      ]),
    ];
    const result = stripToolResultDetails(messages);
    const part = result[0]!.parts[0]! as { type: 'tool-result'; result: string };
    expect((part.result as string).length).toBeLessThan(largeResult.length);
    expect(part.result).toContain('truncated');
  });

  it('removes state field from tool-result parts', () => {
    const messages = [
      makeMessage('assistant', [
        {
          type: 'tool-result',
          toolCallId: 'tc-1',
          toolName: 'test',
          result: 'ok',
          state: 'completed' as ChatMessage['parts'][number] extends { state?: infer S }
            ? S
            : 'output-available',
        },
      ]),
    ];
    const result = stripToolResultDetails(messages);
    const part = result[0]!.parts[0]!;
    expect('state' in part).toBe(false);
    expect('details' in part).toBe(false);
  });

  it('truncates large tool-call args', () => {
    const largeArgs = { data: 'x'.repeat(2000) };
    const messages = [
      makeMessage('assistant', [
        {
          type: 'tool-call',
          toolCallId: 'tc-1',
          toolName: 'test',
          args: largeArgs,
        },
      ]),
    ];
    const result = stripToolResultDetails(messages);
    const part = result[0]!.parts[0]! as { type: 'tool-call'; args: Record<string, unknown> };
    expect(part.args._truncated).toBeDefined();
  });

  it('is non-mutating', () => {
    const original = [
      makeMessage('assistant', [
        {
          type: 'tool-result',
          toolCallId: 'tc-1',
          toolName: 'test',
          result: 'x'.repeat(2000),
        },
      ]),
    ];
    const originalPart = original[0]!.parts[0]! as { type: 'tool-result'; result: string };
    const originalResult = originalPart.result;

    stripToolResultDetails(original);

    // Original should be unchanged
    expect((original[0]!.parts[0]! as { type: 'tool-result'; result: string }).result).toBe(
      originalResult,
    );
  });

  it('preserves small tool results unchanged', () => {
    const messages = [
      makeMessage('assistant', [
        {
          type: 'tool-result',
          toolCallId: 'tc-1',
          toolName: 'test',
          result: 'small result',
        },
      ]),
    ];
    const result = stripToolResultDetails(messages);
    expect(
      (result[0]!.parts[0]! as Extract<ChatMessage['parts'][number], { type: 'tool-result' }>)
        .result,
    ).toBe('small result');
  });
});

describe('repairToolUseResultPairing', () => {
  it('preserves paired tool-call and tool-result', () => {
    const messages = [
      makeMessage('assistant', [
        { type: 'tool-call', toolCallId: 'tc-1', toolName: 'test', args: {} },
      ]),
      makeMessage('assistant', [
        { type: 'tool-result', toolCallId: 'tc-1', toolName: 'test', result: 'ok' },
      ]),
    ];
    const result = repairToolUseResultPairing(messages);
    expect(result[1]!.parts).toHaveLength(1);
    expect(result[1]!.parts[0]!.type).toBe('tool-result');
  });

  it('removes orphaned tool-result parts', () => {
    const messages = [
      makeMessage('assistant', [
        { type: 'tool-result', toolCallId: 'tc-orphan', toolName: 'test', result: 'dangling' },
      ]),
    ];
    const result = repairToolUseResultPairing(messages);
    // Should have placeholder text instead of orphaned tool-result
    expect(result[0]!.parts[0]!.type).toBe('text');
  });

  it('keeps non-tool-result parts even when removing orphans', () => {
    const messages = [
      makeMessage('assistant', [
        { type: 'text', text: 'some context' },
        { type: 'tool-result', toolCallId: 'tc-orphan', toolName: 'test', result: 'orphaned' },
      ]),
    ];
    const result = repairToolUseResultPairing(messages);
    expect(result[0]!.parts).toHaveLength(1);
    expect(result[0]!.parts[0]!.type).toBe('text');
    expect(
      (result[0]!.parts[0]! as Extract<ChatMessage['parts'][number], { type: 'text' }>).text,
    ).toBe('some context');
  });

  it('passes through messages without tool-result parts', () => {
    const messages = [
      makeMessage('user', [{ type: 'text', text: 'hello' }]),
      makeMessage('assistant', [{ type: 'text', text: 'world' }]),
    ];
    const result = repairToolUseResultPairing(messages);
    expect(result).toEqual(messages);
  });

  it('is non-mutating', () => {
    const messages = [
      makeMessage('assistant', [
        { type: 'tool-result', toolCallId: 'tc-orphan', toolName: 'test', result: 'dangling' },
      ]),
    ];
    const originalLength = messages[0]!.parts.length;
    repairToolUseResultPairing(messages);
    expect(messages[0]!.parts.length).toBe(originalLength);
  });
});

describe('repairTranscript — empty message removal', () => {
  it('removes messages with no parts', () => {
    const messages = [
      makeMessage('user', []),
      makeMessage('user', [{ type: 'text', text: 'kept' }]),
    ];
    const result = repairTranscript(messages);
    expect(result).toHaveLength(1);
    expect(
      (result[0]!.parts[0]! as Extract<ChatMessage['parts'][number], { type: 'text' }>).text,
    ).toBe('kept');
  });

  it('removes messages with only empty text parts', () => {
    const messages = [
      makeMessage('user', [{ type: 'text', text: '' }]),
      makeMessage('user', [{ type: 'text', text: '  ' }]),
      makeMessage('assistant', [{ type: 'text', text: 'hello' }]),
    ];
    const result = repairTranscript(messages);
    // The two empty user messages should be removed, leaving just assistant
    expect(result.filter(m => m.role === 'user')).toHaveLength(0);
  });

  it('keeps messages with non-empty parts', () => {
    const messages = [
      makeMessage('user', [{ type: 'text', text: 'hello' }]),
      makeMessage('assistant', [{ type: 'text', text: 'world' }]),
    ];
    const result = repairTranscript(messages);
    expect(result).toHaveLength(2);
  });
});

describe('repairTranscript — deduplication', () => {
  it('removes exact duplicate messages (same parts content)', () => {
    const msg1 = makeMessage('user', [{ type: 'text', text: 'hello' }]);
    const msg2 = makeMessage('user', [{ type: 'text', text: 'hello' }]);
    const result = repairTranscript([msg1, msg2]);
    expect(result).toHaveLength(1);
  });

  it('keeps messages with different content', () => {
    const msg1 = makeMessage('user', [{ type: 'text', text: 'hello' }]);
    const msg2 = makeMessage('user', [{ type: 'text', text: 'world' }]);
    const result = repairTranscript([msg1, msg2]);
    // After dedup both are unique, but they are consecutive same-role → merged
    expect(result).toHaveLength(1);
    expect(result[0]!.parts).toHaveLength(2);
  });

  it('keeps messages with same text but different roles', () => {
    const msg1 = makeMessage('user', [{ type: 'text', text: 'hello' }]);
    const msg2 = makeMessage('assistant', [{ type: 'text', text: 'hello' }]);
    const result = repairTranscript([msg1, msg2]);
    expect(result).toHaveLength(2);
  });
});

describe('repairTranscript — role ordering', () => {
  it('merges consecutive user messages', () => {
    const messages = [
      makeMessage('user', [{ type: 'text', text: 'part1' }]),
      makeMessage('user', [{ type: 'text', text: 'part2' }]),
    ];
    const result = repairTranscript(messages);
    expect(result.filter(m => m.role === 'user')).toHaveLength(1);
    expect(result[0]!.parts).toHaveLength(2);
  });

  it('merges consecutive assistant messages', () => {
    const messages = [
      makeMessage('user', [{ type: 'text', text: 'ask' }]),
      makeMessage('assistant', [{ type: 'text', text: 'resp1' }]),
      makeMessage('assistant', [{ type: 'text', text: 'resp2' }]),
    ];
    const result = repairTranscript(messages);
    const assistants = result.filter(m => m.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0]!.parts).toHaveLength(2);
  });

  it('preserves system messages anywhere', () => {
    const messages = [
      makeMessage('user', [{ type: 'text', text: 'ask1' }]),
      { ...makeMessage('user', [{ type: 'text', text: 'system note' }]), role: 'system' as const },
      makeMessage('assistant', [{ type: 'text', text: 'resp' }]),
    ];
    const result = repairTranscript(messages);
    expect(result.some(m => m.role === 'system')).toBe(true);
  });

  it('preserves correct alternation', () => {
    const messages = [
      makeMessage('user', [{ type: 'text', text: 'q1' }]),
      makeMessage('assistant', [{ type: 'text', text: 'a1' }]),
      makeMessage('user', [{ type: 'text', text: 'q2' }]),
    ];
    const result = repairTranscript(messages);
    expect(result).toHaveLength(3);
    expect(result.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
  });
});
