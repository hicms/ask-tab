import { requestLocalGeneration } from './local-llm-bridge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────

vi.mock('./channels/offscreen-manager', () => ({
  ensureOffscreenDocument: vi.fn(async () => {}),
}));

vi.mock('./agents', () => ({
  createAssistantMessageEventStream: vi.fn(() => {
    const events: unknown[] = [];
    return {
      push: vi.fn((e: unknown) => events.push(e)),
      events,
    };
  }),
}));

vi.mock('./logging/logger-buffer', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  }),
}));

// Mock chrome.runtime
type MessageListener = (msg: Record<string, unknown>) => void;
const listeners: MessageListener[] = [];

vi.stubGlobal('chrome', {
  runtime: {
    onMessage: {
      addListener: vi.fn((fn: MessageListener) => listeners.push(fn)),
      removeListener: vi.fn((fn: MessageListener) => {
        const idx = listeners.indexOf(fn);
        if (idx >= 0) listeners.splice(idx, 1);
      }),
    },
    sendMessage: vi.fn(async () => ({ ok: true })),
  },
});

vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-123' });

// Helper to fire messages to all listeners
const fireMessage = (msg: Record<string, unknown>) => {
  for (const fn of [...listeners]) fn(msg);
};

const defaultOpts = {
  modelId: 'test-model',
  messages: [{ role: 'user', content: 'Hello' }],
  systemPrompt: 'You are a helpful assistant.',
};

// ── Tests ──────────────────────────────────────

describe('requestLocalGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.length = 0;
  });

  it('returns a stream object with push method', () => {
    const stream = requestLocalGeneration(defaultOpts);
    expect(stream).toBeDefined();
    expect(stream.push).toBeDefined();
    expect(typeof stream.push).toBe('function');
  });

  it('sends start and text_start events after offscreen document is ready', async () => {
    const stream = requestLocalGeneration(defaultOpts);

    // Allow microtasks to flush (ensureOffscreenDocument resolves, then .then fires)
    await vi.waitFor(() => {
      const events = (stream as unknown as { events: Array<{ type: string }> }).events;
      expect(events.some(e => e.type === 'start')).toBe(true);
      expect(events.some(e => e.type === 'text_start')).toBe(true);
    });
  });

  it('emits text_delta on LOCAL_LLM_TOKEN messages', async () => {
    const stream = requestLocalGeneration(defaultOpts);

    // Wait for start events to fire
    await vi.waitFor(() => {
      const events = (stream as unknown as { events: Array<{ type: string }> }).events;
      expect(events.some(e => e.type === 'start')).toBe(true);
    });

    fireMessage({
      type: 'LOCAL_LLM_TOKEN',
      requestId: 'test-uuid-123',
      token: 'Hello',
    });

    const events = (stream as unknown as { events: Array<{ type: string; delta?: string }> })
      .events;
    const textDelta = events.find(e => e.type === 'text_delta');
    expect(textDelta).toBeDefined();
    expect(textDelta!.delta).toBe('Hello');
  });

  it('emits done on LOCAL_LLM_END messages', async () => {
    const stream = requestLocalGeneration(defaultOpts);

    // Wait for start events
    await vi.waitFor(() => {
      const events = (stream as unknown as { events: Array<{ type: string }> }).events;
      expect(events.some(e => e.type === 'start')).toBe(true);
    });

    fireMessage({
      type: 'LOCAL_LLM_END',
      requestId: 'test-uuid-123',
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const events = (stream as unknown as { events: Array<{ type: string }> }).events;
    const textEnd = events.find(e => e.type === 'text_end');
    const done = events.find(e => e.type === 'done');
    expect(textEnd).toBeDefined();
    expect(done).toBeDefined();
  });

  it('emits error on LOCAL_LLM_ERROR messages', async () => {
    const stream = requestLocalGeneration(defaultOpts);

    // Wait for start events
    await vi.waitFor(() => {
      const events = (stream as unknown as { events: Array<{ type: string }> }).events;
      expect(events.some(e => e.type === 'start')).toBe(true);
    });

    fireMessage({
      type: 'LOCAL_LLM_ERROR',
      requestId: 'test-uuid-123',
      error: 'Model failed to load',
    });

    const events = (stream as unknown as { events: Array<{ type: string }> }).events;
    const errorEvent = events.find(e => e.type === 'error');
    expect(errorEvent).toBeDefined();
  });

  it('ignores messages with wrong requestId', async () => {
    const stream = requestLocalGeneration(defaultOpts);

    // Wait for start events
    await vi.waitFor(() => {
      const events = (stream as unknown as { events: Array<{ type: string }> }).events;
      expect(events.some(e => e.type === 'start')).toBe(true);
    });

    const eventsBefore = (stream as unknown as { events: Array<{ type: string }> }).events.length;

    fireMessage({
      type: 'LOCAL_LLM_TOKEN',
      requestId: 'wrong-uuid',
      token: 'Should be ignored',
    });

    const eventsAfter = (stream as unknown as { events: Array<{ type: string }> }).events.length;
    // No new events should have been pushed
    expect(eventsAfter).toBe(eventsBefore);
  });
});
