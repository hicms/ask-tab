import { Agent } from './agent';
import { SKIPPED_TOOL_RESULT } from '@extension/shared';
import { createAssistantMessageEventStream } from '@mariozechner/pi-ai';
import { Type } from '@sinclair/typebox';
import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, AgentMessage, AgentTool, StreamFn } from '@mariozechner/pi-agent-core';
import type { AssistantMessage, Message, Model } from '@mariozechner/pi-ai';

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('../tools/tool-lifecycle', () => ({ releaseToolResources: vi.fn() }));

const MODEL: Model<'openai-completions'> = {
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

const reply = (content: AssistantMessage['content']): AssistantMessage => ({
  role: 'assistant',
  content,
  api: 'openai-completions',
  provider: 'openai',
  model: 'test-model',
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: content.some(c => c.type === 'toolCall') ? 'toolUse' : 'stop',
  timestamp: Date.now(),
});

const toolCall = (id: string) => ({ type: 'toolCall' as const, id, name: 'work', arguments: {} });
const text = (value: string) => ({ type: 'text' as const, text: value });
const user = (content: string): AgentMessage => ({ role: 'user', content, timestamp: Date.now() });

/** Replies with the scripted messages in order and records each request's context. */
const scriptedStream = (replies: AssistantMessage[]) => {
  const requests: Message[][] = [];
  const streamFn: StreamFn = (_model, context) => {
    requests.push(context.messages.slice());
    const message = replies[requests.length - 1] ?? reply([text('done')]);
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      stream.push({ type: 'start', partial: message });
      stream.push({ type: 'done', reason: message.stopReason as 'stop', message });
    });
    return stream;
  };
  return { streamFn, requests };
};

const workTool = (execute: AgentTool['execute']): AgentTool => ({
  name: 'work',
  label: 'Work',
  description: 'Work',
  parameters: Type.Object({}),
  execute,
});

const okResult = { content: [text('ok')], details: {} };

const contentText = (message: AgentMessage | Message) => {
  if (message.role !== 'user') return '';
  if (typeof message.content === 'string') return message.content;
  return message.content.map(c => (c.type === 'text' ? c.text : '')).join('');
};

const userTexts = (messages: Message[]) => messages.filter(m => m.role === 'user').map(contentText);

describe('Agent external steering', () => {
  it('injects a steering message after the running tool and skips the remaining tools', async () => {
    const pending: AgentMessage[] = [];
    const execute = vi.fn(async () => {
      pending.push(user('change course'));
      return okResult;
    });
    const { streamFn, requests } = scriptedStream([
      reply([toolCall('a'), toolCall('b')]),
      reply([text('ok, changing course')]),
    ]);
    const agent = new Agent({
      initialState: { model: MODEL, tools: [workTool(execute)] },
      streamFn,
      getSteeringMessages: async () => pending.splice(0),
    });

    await agent.prompt('start');

    expect(execute).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(2);
    expect(userTexts(requests[1]!)).toEqual(['start', 'change course']);
    const skipped = requests[1]!.find(m => m.role === 'toolResult' && m.toolCallId === 'b');
    expect(skipped).toMatchObject({ isError: true, content: [text(SKIPPED_TOOL_RESULT)] });
    expect(requests[1]!.at(-1)).toMatchObject({ role: 'user', content: 'change course' });
  });

  it('starts another turn when a steering message arrives during a final text reply', async () => {
    const pending: AgentMessage[] = [];
    const { streamFn, requests } = scriptedStream([
      reply([text('first')]),
      reply([text('second')]),
    ]);
    const agent = new Agent({
      initialState: { model: MODEL },
      streamFn,
      getSteeringMessages: async () => pending.splice(0),
    });
    agent.subscribe(event => {
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        if (requests.length === 1) pending.push(user('also this'));
      }
    });

    await agent.prompt('start');

    expect(requests).toHaveLength(2);
    expect(userTexts(requests[1]!)).toEqual(['start', 'also this']);
  });

  it('emits injected steering messages as user message events', async () => {
    const pending: AgentMessage[] = [];
    const { streamFn } = scriptedStream([reply([toolCall('a')]), reply([text('done')])]);
    const agent = new Agent({
      initialState: {
        model: MODEL,
        tools: [
          workTool(async () => {
            pending.push(user('steer'));
            return okResult;
          }),
        ],
      },
      streamFn,
      getSteeringMessages: async () => pending.splice(0),
    });
    const users: AgentMessage[] = [];
    agent.subscribe((event: AgentEvent) => {
      if (event.type === 'message_end' && event.message.role === 'user') users.push(event.message);
    });

    await agent.prompt('start');

    expect(users.map(contentText)).toEqual(['start', 'steer']);
  });

  it('drains the internal steer() queue before polling the external source', async () => {
    let toolRan = false;
    let externalGiven = false;
    const { streamFn, requests } = scriptedStream([
      reply([toolCall('a')]),
      reply([text('one')]),
      reply([text('two')]),
    ]);
    const agent: Agent = new Agent({
      initialState: {
        model: MODEL,
        tools: [
          workTool(async () => {
            toolRan = true;
            agent.steer(user('internal'));
            return okResult;
          }),
        ],
      },
      streamFn,
      getSteeringMessages: async () => {
        if (!toolRan || externalGiven) return [];
        externalGiven = true;
        return [user('external')];
      },
    });

    await agent.prompt('start');

    expect(userTexts(requests[1]!)).toEqual(['start', 'internal']);
    expect(userTexts(requests[2]!)).toEqual(['start', 'internal', 'external']);
  });

  it('does not inject anything when the external source stays empty', async () => {
    const source = vi.fn(async () => [] as AgentMessage[]);
    const { streamFn, requests } = scriptedStream([reply([toolCall('a')]), reply([text('done')])]);
    const agent = new Agent({
      initialState: { model: MODEL, tools: [workTool(async () => okResult)] },
      streamFn,
      getSteeringMessages: source,
    });

    await agent.prompt('start');

    expect(requests).toHaveLength(2);
    expect(userTexts(requests[1]!)).toEqual(['start']);
    expect(source).toHaveBeenCalled();
  });
});
