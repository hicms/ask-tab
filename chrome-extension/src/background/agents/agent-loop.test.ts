/**
 * Tests for agent-loop.ts — Fix 1 (Critical)
 * Verifies try/catch in async IIFEs of agentLoop/agentLoopContinue
 * ensures streams terminate even when streamFn throws.
 */

import { agentLoop, agentLoopContinue } from './agent-loop';
import { createAssistantMessageEventStream } from '@mariozechner/pi-ai';
import { describe, it, expect, vi } from 'vitest';
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  StreamFn,
} from '@mariozechner/pi-agent-core';
import type { AssistantMessage, Model, Message } from '@mariozechner/pi-ai';

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  }),
}));

// ── Helpers ──────────────────────────────────────────────

const TEST_MODEL: Model<'openai-completions'> = {
  id: 'test-model',
  name: 'Test',
  api: 'openai-completions',
  provider: 'openai',
  baseUrl: 'http://localhost',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 4096,
  maxTokens: 1024,
};

const makeAssistantMessage = (
  stopReason: AssistantMessage['stopReason'] = 'stop',
): AssistantMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text: 'Hello' }],
  api: 'openai-completions',
  provider: 'openai',
  model: 'test-model',
  usage: {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason,
  timestamp: Date.now(),
});

/**
 * Creates a mock streamFn that returns a controllable AssistantMessageEventStream.
 * The stream emits start → text_delta → done for a simple completion.
 */
const createMockStreamFn = (message?: AssistantMessage): StreamFn => {
  const finalMsg = message ?? makeAssistantMessage();

  return () => {
    const stream = createAssistantMessageEventStream();

    // Push events asynchronously to simulate real streaming
    queueMicrotask(() => {
      stream.push({ type: 'start', partial: finalMsg });
      stream.push({
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Hello',
        partial: finalMsg,
      });
      stream.push({
        type: 'text_end',
        contentIndex: 0,
        content: 'Hello',
        partial: finalMsg,
      });
      stream.push({ type: 'done', reason: 'stop', message: finalMsg });
    });

    return stream;
  };
};

/** Creates a streamFn that throws immediately. */
const createThrowingStreamFn =
  (error: string): StreamFn =>
  () => {
    throw new Error(error);
  };

const makeConfig = (_streamFn?: StreamFn): AgentLoopConfig => ({
  model: TEST_MODEL,
  convertToLlm: (msgs: AgentMessage[]) =>
    msgs.filter(
      (m): m is Message => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult',
    ),
});

const makeContext = (messages: AgentMessage[] = []): AgentContext => ({
  systemPrompt: 'You are a test assistant.',
  messages,
});

/** Collects all events from an EventStream. */
const collectEvents = async (stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> => {
  const events: AgentEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

// ── Tests ────────────────────────────────────────────────

describe('agentLoop', () => {
  it('checkpoints each model response before tool execution and each result before the next request', async () => {
    const prompt: AgentMessage = { role: 'user', content: 'Use the tool', timestamp: 1 };
    const toolResponse: AssistantMessage = {
      ...makeAssistantMessage('toolUse'),
      content: [
        { type: 'thinking', thinking: 'Find the value', thinkingSignature: 'reasoning_content' },
        { type: 'toolCall', id: 'call-1', name: 'lookup', arguments: { key: 'x' } },
        { type: 'toolCall', id: 'call-2', name: 'lookup', arguments: { key: 'y' } },
      ],
    };
    const finalResponse = makeAssistantMessage();
    const checkpoints: AgentMessage[][] = [];
    const wireInputs: AgentMessage[][] = [];
    let callCount = 0;
    const streamFn: StreamFn = (_model, context) => {
      wireInputs.push(context.messages.slice());
      const response = callCount++ === 0 ? toolResponse : finalResponse;
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: 'start', partial: response });
        stream.push({ type: 'done', reason: response.stopReason, message: response });
      });
      return stream;
    };
    const config = {
      ...makeConfig(),
      onCheckpoint: async (messages: AgentMessage[]) => {
        checkpoints.push(structuredClone(messages));
      },
    };

    await collectEvents(agentLoop([prompt], makeContext(), config, undefined, streamFn));

    expect(wireInputs).toHaveLength(2);
    expect(checkpoints.map(snapshot => snapshot.map(message => message.role))).toEqual([
      ['user', 'assistant'],
      ['user', 'assistant', 'toolResult'],
      ['user', 'assistant', 'toolResult', 'toolResult'],
      ['user', 'assistant', 'toolResult', 'toolResult', 'assistant'],
    ]);
    expect(wireInputs[1]?.[1]).toEqual(toolResponse);
    expect(wireInputs[1]?.[2]?.role).toBe('toolResult');
    expect(wireInputs[1]?.[3]?.role).toBe('toolResult');
    expect(checkpoints[0]?.[1]).toEqual(toolResponse);
  });

  it('normal completion — emits agent_end with new messages', async () => {
    const prompt: AgentMessage = {
      role: 'user',
      content: 'Hi',
      timestamp: Date.now(),
    };
    const context = makeContext();
    const streamFn = createMockStreamFn();
    const config = makeConfig();

    const stream = agentLoop([prompt], context, config, undefined, streamFn);
    const events = await collectEvents(stream);

    const agentEnd = events.find(e => e.type === 'agent_end');
    expect(agentEnd).toBeDefined();
    expect(agentEnd!.type).toBe('agent_end');

    // Should contain the prompt + assistant response
    if (agentEnd!.type === 'agent_end') {
      expect(agentEnd!.messages.length).toBeGreaterThanOrEqual(2);
    }

    // Stream should have resolved its result
    const result = await stream.result();
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('when streamFn throws — stream still emits agent_end and terminates', async () => {
    const prompt: AgentMessage = {
      role: 'user',
      content: 'Hi',
      timestamp: Date.now(),
    };
    const context = makeContext();
    const streamFn = createThrowingStreamFn('Network failure');
    const config = makeConfig();

    const stream = agentLoop([prompt], context, config, undefined, streamFn);
    const events = await collectEvents(stream);

    // The stream must NOT hang — it should terminate with agent_end
    const agentEnd = events.find(e => e.type === 'agent_end');
    expect(agentEnd).toBeDefined();

    // The result promise should resolve (not hang forever)
    const result = await stream.result();
    expect(result).toBeDefined();
  });

  it('when no streamFn provided — stream terminates with agent_end', async () => {
    const prompt: AgentMessage = {
      role: 'user',
      content: 'Hi',
      timestamp: Date.now(),
    };
    const context = makeContext();
    const config = makeConfig();

    // No streamFn → runLoop will throw "No streamFn provided"
    const stream = agentLoop([prompt], context, config, undefined, undefined);
    const events = await collectEvents(stream);

    const agentEnd = events.find(e => e.type === 'agent_end');
    expect(agentEnd).toBeDefined();
  });
});

describe('agentLoopContinue', () => {
  it('normal completion — emits agent_end', async () => {
    const userMsg: AgentMessage = {
      role: 'user',
      content: 'Hi',
      timestamp: Date.now(),
    };
    const toolResultMsg: AgentMessage = {
      role: 'toolResult',
      toolCallId: 'tc1',
      toolName: 'test',
      content: [{ type: 'text', text: 'result' }],
      isError: false,
      timestamp: Date.now(),
    };
    const context = makeContext([userMsg, makeAssistantMessage('toolUse'), toolResultMsg]);
    const streamFn = createMockStreamFn();
    const config = makeConfig();

    const stream = agentLoopContinue(context, config, undefined, streamFn);
    const events = await collectEvents(stream);

    const agentEnd = events.find(e => e.type === 'agent_end');
    expect(agentEnd).toBeDefined();
  });

  it('when streamFn throws — stream still terminates', async () => {
    const userMsg: AgentMessage = {
      role: 'user',
      content: 'Hi',
      timestamp: Date.now(),
    };
    const toolResultMsg: AgentMessage = {
      role: 'toolResult',
      toolCallId: 'tc1',
      toolName: 'test',
      content: [{ type: 'text', text: 'result' }],
      isError: false,
      timestamp: Date.now(),
    };
    const context = makeContext([userMsg, makeAssistantMessage('toolUse'), toolResultMsg]);
    const streamFn = createThrowingStreamFn('API error');
    const config = makeConfig();

    const stream = agentLoopContinue(context, config, undefined, streamFn);
    const events = await collectEvents(stream);

    const agentEnd = events.find(e => e.type === 'agent_end');
    expect(agentEnd).toBeDefined();

    const result = await stream.result();
    expect(result).toBeDefined();
  });

  it('with empty messages — throws synchronously', () => {
    const context = makeContext([]);
    const config = makeConfig();

    expect(() => agentLoopContinue(context, config)).toThrow(
      'Cannot continue: no messages in context',
    );
  });

  it('with last message role assistant — throws synchronously', () => {
    const context = makeContext([makeAssistantMessage()]);
    const config = makeConfig();

    expect(() => agentLoopContinue(context, config)).toThrow(
      'Cannot continue from message role: assistant',
    );
  });
});
