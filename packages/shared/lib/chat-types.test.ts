import {
  isTextPart,
  isReasoningPart,
  isToolCallPart,
  isToolResultPart,
  isFilePart,
  isValidStreamingStatus,
  isValidToolPartState,
  isStreamChunk,
  isStreamEnd,
  isStreamError,
} from './chat-types';
import { describe, it, expect } from 'vitest';
import type {
  ChatMessagePart,
  PortMessage,
  SessionUsage,
  LLMStreamEnd,
  LLMStepFinish,
  ChatModel,
} from './chat-types';

describe('ChatMessagePart type guards', () => {
  const textPart: ChatMessagePart = { type: 'text', text: 'hello' };
  const reasoningPart: ChatMessagePart = { type: 'reasoning', text: 'thinking...' };
  const toolCallPart: ChatMessagePart = {
    type: 'tool-call',
    toolCallId: 'tc-1',
    toolName: 'web_search',
    args: { city: 'SF' },
  };
  const toolResultPart: ChatMessagePart = {
    type: 'tool-result',
    toolCallId: 'tc-1',
    toolName: 'web_search',
    result: { temp: 72 },
  };
  const filePart: ChatMessagePart = {
    type: 'file',
    url: 'https://example.com/img.png',
    filename: 'img.png',
    mediaType: 'image/png',
  };

  it('isTextPart identifies text parts', () => {
    expect(isTextPart(textPart)).toBe(true);
    expect(isTextPart(reasoningPart)).toBe(false);
    expect(isTextPart(toolCallPart)).toBe(false);
  });

  it('isReasoningPart identifies reasoning parts', () => {
    expect(isReasoningPart(reasoningPart)).toBe(true);
    expect(isReasoningPart(textPart)).toBe(false);
  });

  it('isToolCallPart identifies tool-call parts', () => {
    expect(isToolCallPart(toolCallPart)).toBe(true);
    expect(isToolCallPart(textPart)).toBe(false);
  });

  it('isToolResultPart identifies tool-result parts', () => {
    expect(isToolResultPart(toolResultPart)).toBe(true);
    expect(isToolResultPart(toolCallPart)).toBe(false);
  });

  it('isFilePart identifies file parts', () => {
    expect(isFilePart(filePart)).toBe(true);
    expect(isFilePart(textPart)).toBe(false);
  });
});

describe('isValidStreamingStatus', () => {
  it('accepts valid statuses', () => {
    expect(isValidStreamingStatus('idle')).toBe(true);
    expect(isValidStreamingStatus('connecting')).toBe(true);
    expect(isValidStreamingStatus('streaming')).toBe(true);
    expect(isValidStreamingStatus('complete')).toBe(true);
    expect(isValidStreamingStatus('error')).toBe(true);
  });

  it('rejects invalid values', () => {
    expect(isValidStreamingStatus('unknown')).toBe(false);
    expect(isValidStreamingStatus('')).toBe(false);
    expect(isValidStreamingStatus(42)).toBe(false);
    expect(isValidStreamingStatus(null)).toBe(false);
    expect(isValidStreamingStatus(undefined)).toBe(false);
  });
});

describe('isValidToolPartState', () => {
  it('accepts valid states', () => {
    expect(isValidToolPartState('input-streaming')).toBe(true);
    expect(isValidToolPartState('input-available')).toBe(true);
    expect(isValidToolPartState('output-available')).toBe(true);
    expect(isValidToolPartState('output-error')).toBe(true);
  });

  it('rejects invalid values', () => {
    expect(isValidToolPartState('unknown')).toBe(false);
    expect(isValidToolPartState(42)).toBe(false);
    expect(isValidToolPartState(null)).toBe(false);
  });
});

describe('PortMessage type guards', () => {
  it('isStreamChunk identifies LLM_STREAM_CHUNK messages', () => {
    const chunk: PortMessage = { type: 'LLM_STREAM_CHUNK', chatId: 'c1', delta: 'hi' };
    const end: PortMessage = { type: 'LLM_STREAM_END', chatId: 'c1', finishReason: 'stop' };
    expect(isStreamChunk(chunk)).toBe(true);
    expect(isStreamChunk(end)).toBe(false);
  });

  it('isStreamEnd identifies LLM_STREAM_END messages', () => {
    const end: PortMessage = { type: 'LLM_STREAM_END', chatId: 'c1', finishReason: 'stop' };
    expect(isStreamEnd(end)).toBe(true);
  });

  it('isStreamError identifies LLM_STREAM_ERROR messages', () => {
    const error: PortMessage = { type: 'LLM_STREAM_ERROR', chatId: 'c1', error: 'fail' };
    expect(isStreamError(error)).toBe(true);
  });
});

describe('SessionUsage type', () => {
  it('SessionUsage has required fields: promptTokens, completionTokens, totalTokens', () => {
    const usage: SessionUsage = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    };
    expect(usage.promptTokens).toBe(100);
    expect(usage.completionTokens).toBe(50);
    expect(usage.totalTokens).toBe(150);
  });
});

describe('LLMStreamEnd with wasCompacted', () => {
  it('LLMStreamEnd accepts wasCompacted boolean', () => {
    const end: LLMStreamEnd = {
      type: 'LLM_STREAM_END',
      chatId: 'c1',
      finishReason: 'stop',
      wasCompacted: true,
    };
    expect(end.wasCompacted).toBe(true);
  });

  it('LLMStreamEnd works without wasCompacted (backward compat)', () => {
    const end: LLMStreamEnd = {
      type: 'LLM_STREAM_END',
      chatId: 'c1',
      finishReason: 'stop',
    };
    expect(end.wasCompacted).toBeUndefined();
  });
});

describe('LLM_STEP_FINISH type', () => {
  it('accepts stepNumber and usage fields', () => {
    const step: LLMStepFinish = {
      type: 'LLM_STEP_FINISH',
      chatId: 'c1',
      stepNumber: 2,
      usage: {
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
      },
    };
    expect(step.type).toBe('LLM_STEP_FINISH');
    expect(step.stepNumber).toBe(2);
    expect(step.usage?.promptTokens).toBe(500);
    expect(step.usage?.completionTokens).toBe(200);
    expect(step.usage?.totalTokens).toBe(700);
  });

  it('accepts LLM_STEP_FINISH without usage (optional)', () => {
    const step: LLMStepFinish = {
      type: 'LLM_STEP_FINISH',
      chatId: 'c1',
      stepNumber: 1,
    };
    expect(step.usage).toBeUndefined();
  });
});

describe('ChatModel toolTimeoutSeconds', () => {
  it('toolTimeoutSeconds defaults to undefined (use 300)', () => {
    const model: ChatModel = {
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'openai',
      routingMode: 'direct',
    };
    expect(model.toolTimeoutSeconds).toBeUndefined();
  });

  it('toolTimeoutSeconds can be set to a custom value', () => {
    const model: ChatModel = {
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'openai',
      routingMode: 'direct',
      toolTimeoutSeconds: 600,
    };
    expect(model.toolTimeoutSeconds).toBe(600);
  });
});

describe('ChatModel without systemPrompt', () => {
  it('ChatModel no longer has systemPrompt field', () => {
    const model: ChatModel = {
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'openai',
      routingMode: 'direct',
    };
    // systemPrompt should not exist on ChatModel
    expect('systemPrompt' in model).toBe(false);
  });
});
