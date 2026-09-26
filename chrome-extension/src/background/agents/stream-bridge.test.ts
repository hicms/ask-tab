/**
 * Tests for pi-stream-bridge.ts — createStreamFn and completeText
 */

import { completeText, createStreamFn } from './stream-bridge';
import { confirmSessionAfterModelError } from '../ask-service/client';
import { createAssistantMessageEventStream } from '@mariozechner/pi-ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatModel } from '@extension/shared';
import type {
  Api,
  SimpleStreamOptions,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
} from '@mariozechner/pi-ai';

// ── Mocks ────────────────────────────────────────────────

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  }),
}));

let mockStreamSimpleResult: ReturnType<typeof createAssistantMessageEventStream>;
let mockCompleteSimpleResult: AssistantMessage;

vi.mock('@mariozechner/pi-ai', async importOriginal => {
  const actual = await importOriginal<typeof import('@mariozechner/pi-ai')>();
  return {
    ...actual,
    streamSimple: vi.fn(
      (_model: Model<Api>, _context: Context, _options: SimpleStreamOptions) =>
        mockStreamSimpleResult,
    ),
    completeSimple: vi.fn(
      async (_model: Model<Api>, _context: Context, _options: SimpleStreamOptions) =>
        mockCompleteSimpleResult,
    ),
  };
});

vi.mock('../ask-service/client', () => ({
  confirmSessionAfterModelError: vi.fn(async () => {}),
  requireSession: vi.fn(async () => ({
    token: 'test-jwt',
    userId: 'u',
    email: 'a@b.co',
    expiresAt: 9999999999999,
  })),
}));

// Mock chatModelToPiModel — returns a ResolvedModel
vi.mock('./model-adapter', () => ({
  chatModelToPiModel: vi.fn((_config: ChatModel) => ({
    model: {
      id: 'gpt-4o',
      name: 'GPT-4o',
      api: 'openai-completions',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 32000,
    },
  })),
}));

// ── Test Fixtures ────────────────────────────────────────

const TEST_CHAT_MODEL: ChatModel = {
  id: 'gpt-4o',
  name: 'GPT-4o',
  provider: 'openai',
  routingMode: 'direct',
};

const TEST_PI_MODEL: Model<'openai-completions'> = {
  id: 'gpt-4o',
  name: 'GPT-4o',
  api: 'openai-completions',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 32000,
};

/** Collect all events from an AssistantMessageEventStream. */
const collectEvents = async (
  stream: AsyncIterable<AssistantMessageEvent>,
): Promise<AssistantMessageEvent[]> => {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

const makeAssistantMessage = (overrides: Partial<AssistantMessage> = {}): AssistantMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text: 'Hello' }],
  api: 'openai-completions',
  provider: 'openai',
  model: 'gpt-4o',
  usage: {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop',
  timestamp: Date.now(),
  ...overrides,
});

// ── Tests ────────────────────────────────────────────────

describe('createStreamFn', () => {
  beforeEach(() => {
    mockStreamSimpleResult = createAssistantMessageEventStream();
  });

  it('returns a StreamFn that delegates to streamSimple', async () => {
    const streamFn = createStreamFn(TEST_CHAT_MODEL);
    const context: Context = {
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'Hi', timestamp: Date.now() }],
    };

    // Push events to the mock stream
    const finalMsg = makeAssistantMessage();
    setTimeout(() => {
      mockStreamSimpleResult.push({ type: 'start', partial: finalMsg });
      mockStreamSimpleResult.push({ type: 'text_start', contentIndex: 0, partial: finalMsg });
      mockStreamSimpleResult.push({
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Hello',
        partial: finalMsg,
      });
      mockStreamSimpleResult.push({
        type: 'text_end',
        contentIndex: 0,
        content: 'Hello',
        partial: finalMsg,
      });
      mockStreamSimpleResult.push({ type: 'done', reason: 'stop', message: finalMsg });
    }, 0);

    const streamOrPromise = streamFn(TEST_PI_MODEL, context);
    const stream = streamOrPromise instanceof Promise ? await streamOrPromise : streamOrPromise;
    const events = await collectEvents(stream);

    expect(events.length).toBe(5);
    const doneEvent = events.find(e => e.type === 'done');
    expect(doneEvent).toBeDefined();
    if (doneEvent?.type === 'done') {
      expect(doneEvent.reason).toBe('stop');
    }
  });

  it('error event → stream emits error with stopReason aborted', async () => {
    const streamFn = createStreamFn(TEST_CHAT_MODEL);
    const context: Context = {
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'Hi', timestamp: Date.now() }],
    };

    const errorMsg = makeAssistantMessage({ stopReason: 'aborted' });
    setTimeout(() => {
      mockStreamSimpleResult.push({ type: 'error', reason: 'aborted', error: errorMsg });
    }, 0);

    const streamOrPromise2 = streamFn(TEST_PI_MODEL, context);
    const stream = streamOrPromise2 instanceof Promise ? await streamOrPromise2 : streamOrPromise2;
    const events = await collectEvents(stream);

    const errorEvent = events.find(e => e.type === 'error');
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === 'error') {
      expect(errorEvent.reason).toBe('aborted');
      expect(errorEvent.error.stopReason).toBe('aborted');
    }
  });

  it('error event → stream emits error with stopReason error', async () => {
    const streamFn = createStreamFn(TEST_CHAT_MODEL);
    const context: Context = {
      systemPrompt: 'Test',
      messages: [{ role: 'user', content: 'Hi', timestamp: Date.now() }],
    };

    const errorMsg = makeAssistantMessage({
      stopReason: 'error',
      errorMessage: 'API rate limit',
    });
    setTimeout(() => {
      mockStreamSimpleResult.push({ type: 'error', reason: 'error', error: errorMsg });
    }, 0);

    const streamOrPromise3 = streamFn(TEST_PI_MODEL, context, { apiKey: 'test-jwt' });
    const stream = streamOrPromise3 instanceof Promise ? await streamOrPromise3 : streamOrPromise3;
    const events = await collectEvents(stream);

    const errorEvent = events.find(e => e.type === 'error');
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === 'error') {
      expect(errorEvent.reason).toBe('error');
      expect(errorEvent.error.errorMessage).toContain('API rate limit');
    }
    await vi.waitFor(() =>
      expect(confirmSessionAfterModelError).toHaveBeenCalledWith(
        'https://api.openai.com/v1',
        'test-jwt',
      ),
    );
  });

  it('does not re-check the session after a successful call', async () => {
    vi.mocked(confirmSessionAfterModelError).mockClear();
    const streamFn = createStreamFn(TEST_CHAT_MODEL);
    const finalMsg = makeAssistantMessage();
    setTimeout(
      () => mockStreamSimpleResult.push({ type: 'done', reason: 'stop', message: finalMsg }),
      0,
    );

    const result = streamFn(TEST_PI_MODEL, { messages: [] });
    await collectEvents(result instanceof Promise ? await result : result);
    await Promise.resolve();

    expect(confirmSessionAfterModelError).not.toHaveBeenCalled();
  });
});

describe('completeText', () => {
  beforeEach(() => {
    mockCompleteSimpleResult = makeAssistantMessage({
      content: [{ type: 'text', text: 'Summary result' }],
    });
  });

  it('returns text from completeSimple result', async () => {
    const result = await completeText(TEST_CHAT_MODEL, 'System prompt', 'User content');
    expect(result).toBe('Summary result');
  });

  it('re-checks the session when the completion fails', async () => {
    vi.mocked(confirmSessionAfterModelError).mockClear();
    mockCompleteSimpleResult = makeAssistantMessage({ content: [], stopReason: 'error' });

    await completeText(TEST_CHAT_MODEL, 'System', 'User');

    expect(confirmSessionAfterModelError).toHaveBeenCalledWith(
      'https://api.openai.com/v1',
      'test-jwt',
    );
  });

  it('joins multiple text parts', async () => {
    mockCompleteSimpleResult = makeAssistantMessage({
      content: [
        { type: 'text', text: 'Part 1 ' },
        { type: 'text', text: 'Part 2' },
      ],
    });

    const result = await completeText(TEST_CHAT_MODEL, 'System', 'User');
    expect(result).toBe('Part 1 Part 2');
  });

  it('filters out non-text content', async () => {
    mockCompleteSimpleResult = makeAssistantMessage({
      content: [
        { type: 'thinking', thinking: 'internal thoughts' },
        { type: 'text', text: 'Visible result' },
      ],
    });

    const result = await completeText(TEST_CHAT_MODEL, 'System', 'User');
    expect(result).toBe('Visible result');
  });
});
