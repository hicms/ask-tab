import { serializeTranscript } from './serialize-transcript';
import { describe, it, expect } from 'vitest';
import type { SerializableMessage } from './serialize-transcript';

const makeMsg = (
  role: string,
  parts: Array<{ type: string; [key: string]: unknown }>,
  createdAt = Date.now(),
): SerializableMessage => ({ role, parts, createdAt });

describe('serializeTranscript', () => {
  it('returns empty string for empty array', () => {
    expect(serializeTranscript([])).toBe('');
  });

  it('returns empty string when messages have no text parts', () => {
    const messages = [makeMsg('assistant', [{ type: 'tool-result', toolCallId: 'x', result: {} }])];
    expect(serializeTranscript(messages)).toBe('');
  });

  it('serializes user and assistant text parts', () => {
    const messages = [
      makeMsg('user', [{ type: 'text', text: 'Hello' }]),
      makeMsg('assistant', [{ type: 'text', text: 'Hi there!' }]),
    ];
    expect(serializeTranscript(messages)).toBe('User: Hello\nAssistant: Hi there!');
  });

  it('maps system role correctly', () => {
    const messages = [makeMsg('system', [{ type: 'text', text: 'You are a bot' }])];
    expect(serializeTranscript(messages)).toBe('System: You are a bot');
  });

  it('summarizes tool-call parts as [Tool: name]', () => {
    const messages = [
      makeMsg('assistant', [
        { type: 'text', text: 'Let me search.' },
        { type: 'tool-call', toolName: 'web_search', toolCallId: 'tc1', args: {} },
      ]),
    ];
    expect(serializeTranscript(messages)).toBe('Assistant: Let me search. [Tool: web_search]');
  });

  it('skips tool-result and reasoning parts', () => {
    const messages = [
      makeMsg('assistant', [
        { type: 'reasoning', text: 'thinking...' },
        { type: 'tool-result', toolCallId: 'x', result: 'data' },
        { type: 'text', text: 'Here is the answer.' },
      ]),
    ];
    expect(serializeTranscript(messages)).toBe('Assistant: Here is the answer.');
  });

  it('skips messages with only whitespace text', () => {
    const messages = [
      makeMsg('user', [{ type: 'text', text: '   ' }]),
      makeMsg('assistant', [{ type: 'text', text: 'Response' }]),
    ];
    expect(serializeTranscript(messages)).toBe('Assistant: Response');
  });

  it('truncates from the front to fit maxChars', () => {
    const messages = [
      makeMsg('user', [{ type: 'text', text: 'A'.repeat(100) }]),
      makeMsg('assistant', [{ type: 'text', text: 'B'.repeat(100) }]),
      makeMsg('user', [{ type: 'text', text: 'C'.repeat(100) }]),
    ];
    const result = serializeTranscript(messages, 150);
    // Should keep recent content and drop the beginning
    expect(result.length).toBeLessThanOrEqual(150);
    expect(result).toContain('C'.repeat(100));
    expect(result).not.toContain('A'.repeat(100));
  });

  it('starts at a complete line after truncation', () => {
    const messages = [
      makeMsg('user', [{ type: 'text', text: 'First message' }]),
      makeMsg('assistant', [{ type: 'text', text: 'Second message' }]),
      makeMsg('user', [{ type: 'text', text: 'Third message' }]),
    ];
    const result = serializeTranscript(messages, 40);
    // Should not start mid-line — first char should be a role prefix
    expect(result).toMatch(/^(User|Assistant|System):/);
  });

  it('returns full transcript when within maxChars', () => {
    const messages = [
      makeMsg('user', [{ type: 'text', text: 'Short' }]),
      makeMsg('assistant', [{ type: 'text', text: 'Also short' }]),
    ];
    const result = serializeTranscript(messages, 8000);
    expect(result).toBe('User: Short\nAssistant: Also short');
  });

  it('joins multiple text parts in a single message', () => {
    const messages = [
      makeMsg('user', [
        { type: 'text', text: 'Part one.' },
        { type: 'text', text: 'Part two.' },
      ]),
    ];
    expect(serializeTranscript(messages)).toBe('User: Part one. Part two.');
  });
});
