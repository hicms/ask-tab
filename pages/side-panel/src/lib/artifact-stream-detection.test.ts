import {
  finalizeArtifact,
  isDocumentToolCall,
  processArtifactDelta,
  processArtifactToolCall,
} from '@extension/ui';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessagePart } from '@extension/shared';
import type { UIArtifact } from '@extension/ui';

describe('isDocumentToolCall', () => {
  it('detects create_document tool call', () => {
    const part: ChatMessagePart = {
      type: 'tool-call',
      toolCallId: 'tc_1',
      toolName: 'create_document',
      args: { title: 'Test', kind: 'text' },
    };
    expect(isDocumentToolCall(part)).toBe(true);
  });

  it('returns false for other tool calls', () => {
    const part: ChatMessagePart = {
      type: 'tool-call',
      toolCallId: 'tc_3',
      toolName: 'web_search',
      args: { query: 'NYC weather' },
    };
    expect(isDocumentToolCall(part)).toBe(false);
  });

  it('returns false for text parts', () => {
    const part: ChatMessagePart = {
      type: 'text',
      text: 'Hello',
    };
    expect(isDocumentToolCall(part)).toBe(false);
  });

  it('returns false for reasoning parts', () => {
    const part: ChatMessagePart = {
      type: 'reasoning',
      text: 'Thinking...',
    };
    expect(isDocumentToolCall(part)).toBe(false);
  });
});

describe('processArtifactToolCall', () => {
  it('returns false for non-tool-call parts', () => {
    const part: ChatMessagePart = { type: 'text', text: 'hello' };
    const setter = vi.fn();
    expect(processArtifactToolCall(part, setter)).toBe(false);
    expect(setter).not.toHaveBeenCalled();
  });

  it('returns false for non-document tool calls', () => {
    const part: ChatMessagePart = {
      type: 'tool-call',
      toolCallId: 'tc_1',
      toolName: 'web_search',
      args: { query: 'test' },
    };
    const setter = vi.fn();
    expect(processArtifactToolCall(part, setter)).toBe(false);
  });

  it('returns true and calls setter for create_document', () => {
    const part: ChatMessagePart = {
      type: 'tool-call',
      toolCallId: 'tc_1',
      toolName: 'create_document',
      args: { title: 'My Doc', kind: 'code' },
    };
    const setter = vi.fn();
    expect(processArtifactToolCall(part, setter)).toBe(true);
    expect(setter).toHaveBeenCalled();
  });

  it('handles missing args gracefully', () => {
    const part = {
      type: 'tool-call' as const,
      toolCallId: 'tc_1',
      toolName: 'create_document',
      args: undefined as unknown as Record<string, unknown>,
    };
    const setter = vi.fn();
    expect(processArtifactToolCall(part, setter)).toBe(false);
  });
});

describe('processArtifactDelta', () => {
  it('returns false if artifact is not streaming', () => {
    const artifact: UIArtifact = {
      documentId: 'doc-1',
      content: '',
      kind: 'text',
      title: 'Test',
      status: 'idle',
      isVisible: false,
    };
    const setter = vi.fn();
    expect(processArtifactDelta('hello', artifact, setter)).toBe(false);
  });

  it('returns false if documentId is init', () => {
    const artifact: UIArtifact = {
      documentId: 'init',
      content: '',
      kind: 'text',
      title: '',
      status: 'streaming',
      isVisible: false,
    };
    const setter = vi.fn();
    expect(processArtifactDelta('hello', artifact, setter)).toBe(false);
  });

  it('returns true and appends delta when streaming', () => {
    const artifact: UIArtifact = {
      documentId: 'doc-1',
      content: 'existing',
      kind: 'text',
      title: 'Test',
      status: 'streaming',
      isVisible: true,
    };
    const setter = vi.fn();
    expect(processArtifactDelta(' content', artifact, setter)).toBe(true);
    expect(setter).toHaveBeenCalled();
  });
});

describe('finalizeArtifact', () => {
  it('does nothing for init documentId', async () => {
    const artifact: UIArtifact = {
      documentId: 'init',
      content: 'test',
      kind: 'text',
      title: 'Test',
      status: 'idle',
      isVisible: false,
    };
    const setter = vi.fn();
    await finalizeArtifact(artifact, 'chat-1', setter);
    expect(setter).not.toHaveBeenCalled();
  });

  it('does nothing for empty content', async () => {
    const artifact: UIArtifact = {
      documentId: 'doc-1',
      content: '',
      kind: 'text',
      title: 'Test',
      status: 'idle',
      isVisible: false,
    };
    const setter = vi.fn();
    await finalizeArtifact(artifact, 'chat-1', setter);
    expect(setter).not.toHaveBeenCalled();
  });
});
