import { runAgent } from './agent-setup';
import {
  handleLLMStream,
  isLLMStreamRunning,
  setStreamQueueHooks,
  stopLLMStream,
  subscribeLLMStream,
} from './stream-handler';
import { addMessage, finishModelTurn } from '@extension/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunAgentOpts, RunAgentResult } from './agent-setup';
import type { SettledRun } from './stream-handler';
import type {
  ChatMessage,
  ChatModel,
  LLMRequestMessage,
  LLMStreamSnapshot,
  QueuedChatMessage,
} from '@extension/shared';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

vi.mock('./agent-setup', () => ({
  runAgent: vi.fn(),
  buildHeadlessSystemPrompt: vi.fn(async () => 'System prompt'),
}));

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('./message-adapter', () => ({
  chatMessagesToPiMessages: vi.fn((msgs: ChatMessage[]) =>
    msgs.map(m => ({
      role: m.role,
      content: (m.parts[0] as { type: 'text'; text: string }).text,
      timestamp: m.createdAt,
    })),
  ),
  makeConvertToLlm: vi.fn(() => (msgs: unknown[]) => msgs),
}));

vi.mock('../context/transform', () => ({
  createTransformContext: vi.fn(() => ({
    transformContext: vi.fn(async (msgs: unknown[]) => msgs),
    getResult: () => ({ wasCompacted: false }),
  })),
}));

vi.mock('../memory/memory-flush', () => ({ runMemoryFlushIfNeeded: vi.fn(async () => {}) }));

vi.mock('../ask-service/endpoint', () => ({
  getServiceUrl: () => 'http://ask.test',
  serviceUrlReady: async () => {},
}));
vi.mock('@extension/storage', () => ({
  activeAgentStorage: { get: vi.fn(async () => 'main') },
  saveArtifact: vi.fn(async () => {}),
  addMessage: vi.fn(async () => {}),
  touchChat: vi.fn(async () => {}),
  getModelTranscript: vi.fn(async () => undefined),
  saveModelTranscript: vi.fn(async () => {}),
  finishModelTurn: vi.fn(async () => {}),
  updateSessionTokens: vi.fn(async () => {}),
  getMessagesByChatId: vi.fn(async () => []),
}));

const model: ChatModel = { id: 'gpt-4o', name: 'GPT-4o', provider: 'custom' };

const prompt: ChatMessage = {
  id: 'prompt',
  chatId: 'chat-1',
  role: 'user',
  parts: [{ type: 'text', text: 'Research this' }],
  createdAt: 1_000,
};

const request = (overrides: Partial<LLMRequestMessage> = {}): LLMRequestMessage => ({
  type: 'LLM_REQUEST',
  chatId: 'chat-1',
  messages: [prompt],
  model,
  assistantMessageId: 'segment-1',
  ...overrides,
});

const queued = (id: string, text: string): QueuedChatMessage => ({
  id,
  text,
  mode: 'steer',
  model,
  createdAt: 2_000,
});

const createPort = () => ({
  postMessage: vi.fn(),
  onMessage: { addListener: vi.fn() },
  onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
});

const agentResult = (overrides: Partial<RunAgentResult> = {}): RunAgentResult => ({
  responseText: '',
  parts: [],
  usage: { inputTokens: 0, outputTokens: 0 },
  agent: { state: { messages: [] } } as never,
  stepCount: 1,
  timedOut: false,
  retryAttempts: 0,
  ...overrides,
});

const endAgent = (opts: RunAgentOpts) =>
  opts.onAgentEnd?.({ agent: { state: {} } as never, messages: [], stepCount: 1, timedOut: false });

/** Runs the scripted agent body against the options handleLLMStream passes to runAgent. */
const scriptAgent = (body: (opts: RunAgentOpts) => Promise<Partial<RunAgentResult> | void>) => {
  vi.mocked(runAgent).mockImplementationOnce(async opts => agentResult((await body(opts)) ?? {}));
};

const snapshots = (port: ReturnType<typeof createPort>): LLMStreamSnapshot[] =>
  port.postMessage.mock.calls
    .map(([message]) => message as LLMStreamSnapshot)
    .filter(message => message.type === 'LLM_STREAM_SNAPSHOT');

const persisted = () => vi.mocked(addMessage).mock.calls.map(([message]) => message);

let steerQueue: QueuedChatMessage[];
let settled: SettledRun[];

describe('stream-handler steering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    steerQueue = [];
    settled = [];
    setStreamQueueHooks({
      takeSteering: () => steerQueue.splice(0, 1),
      onSettled: run => settled.push(run),
    });
  });

  afterEach(() => setStreamQueueHooks(undefined));

  it('splits the reply around a steering message injected after a tool', async () => {
    scriptAgent(async opts => {
      opts.onTextDelta?.('Looking it up.');
      opts.onToolCallEnd?.({ id: 'tool-1', name: 'search', args: {} });
      opts.onToolResult?.({
        toolCallId: 'tool-1',
        toolName: 'search',
        result: 'hits',
        isError: false,
      });
      steerQueue.push(queued('steer-1', 'Only official sources'));
      const [message] = await opts.getSteeringMessages!();
      opts.onUserMessage?.(message!);
      opts.onTextDelta?.('Using official sources.');
      endAgent(opts);
    });
    const port = createPort();

    await handleLLMStream(port as never, request());

    const [first, user] = persisted();
    expect(first).toMatchObject({
      id: 'segment-1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Looking it up.' },
        expect.objectContaining({ toolCallId: 'tool-1', state: 'output-available' }),
      ],
    });
    expect(user).toMatchObject({
      id: 'steer-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Only official sources' }],
    });
    expect(user!.createdAt).toBeGreaterThan(first!.createdAt);
    const final = vi.mocked(finishModelTurn).mock.calls[0]![0];
    expect(final).toMatchObject({
      role: 'assistant',
      parts: [{ type: 'text', text: 'Using official sources.' }],
    });
    expect(final.id).not.toBe('segment-1');
    expect(final.createdAt).toBe(user!.createdAt + 1);

    const split = snapshots(port).at(-1)!;
    expect(split.assistantMessageId).toBe(final.id);
    expect(split.messages.map(m => m.id)).toEqual(['prompt', 'segment-1', 'steer-1', final.id]);
    expect(settled).toEqual([{ chatId: 'chat-1', outcome: 'completed', unsentSteering: [] }]);
  });

  it('streams output after the split into the new segment only', async () => {
    let continueRun!: () => void;
    const gate = new Promise<void>(resolve => {
      continueRun = resolve;
    });
    scriptAgent(async opts => {
      opts.onTextDelta?.('Before.');
      steerQueue.push(queued('steer-1', 'Shorter please'));
      const [message] = await opts.getSteeringMessages!();
      opts.onUserMessage?.(message!);
      await gate;
      opts.onTextDelta?.('After.');
      endAgent(opts);
    });
    const port = createPort();
    const run = handleLLMStream(port as never, request());
    await vi.waitFor(() => expect(persisted()).toHaveLength(2));

    const returning = createPort();
    await subscribeLLMStream(returning as never, 'chat-1');
    const restored = snapshots(returning)[0]!;
    expect(restored.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(restored.messages[1]!.parts).toEqual([{ type: 'text', text: 'Before.' }]);
    expect(restored.messages[3]!.parts).toEqual([]);

    continueRun();
    await run;
    expect(vi.mocked(finishModelTurn).mock.calls[0]![0].parts).toEqual([
      { type: 'text', text: 'After.' },
    ]);
  });

  it('places a steering message injected before any output ahead of the empty reply', async () => {
    steerQueue.push(queued('steer-1', 'Also check the date'));
    scriptAgent(async opts => {
      const [message] = await opts.getSteeringMessages!();
      opts.onUserMessage?.(message!);
      opts.onTextDelta?.('Answer.');
      endAgent(opts);
    });
    const port = createPort();

    await handleLLMStream(port as never, request());

    expect(persisted().map(m => m.id)).toEqual(['steer-1']);
    const final = vi.mocked(finishModelTurn).mock.calls[0]![0];
    expect(final.id).toBe('segment-1');
    expect(final.createdAt).toBe(persisted()[0]!.createdAt + 1);
    expect(
      snapshots(port)
        .at(-1)!
        .messages.map(m => m.id),
    ).toEqual(['prompt', 'steer-1', 'segment-1']);
  });

  it('hands back steering messages that were taken but never injected', async () => {
    const item = queued('steer-1', 'Too late');
    scriptAgent(async opts => {
      opts.onTextDelta?.('Final answer.');
      steerQueue.push(item);
      await opts.getSteeringMessages!();
      endAgent(opts);
    });

    await handleLLMStream(createPort() as never, request());

    expect(settled).toEqual([{ chatId: 'chat-1', outcome: 'completed', unsentSteering: [item] }]);
    expect(persisted()).toEqual([]);
  });

  it('replays injected steering after a context-overflow retry without duplicating it', async () => {
    let replayed: AgentMessage[] = [];
    scriptAgent(async opts => {
      opts.onTextDelta?.('Partial.');
      steerQueue.push(queued('steer-1', 'Keep going'));
      const [message] = await opts.getSteeringMessages!();
      opts.onUserMessage?.(message!);
      opts.onRetry?.({ attempt: 1, maxAttempts: 3, reason: 'overflow', strategy: 'compaction' });
      replayed = await opts.getSteeringMessages!();
      opts.onUserMessage?.(replayed[0]!);
      opts.onTextDelta?.('Retried answer.');
      endAgent(opts);
    });
    const port = createPort();

    await handleLLMStream(port as never, request());

    expect(replayed).toHaveLength(1);
    const ids = snapshots(port)
      .at(-1)!
      .messages.map(m => m.id);
    expect(ids.filter(id => id === 'steer-1')).toHaveLength(1);
    expect(ids.at(-2)).toBe('steer-1');
    expect(vi.mocked(finishModelTurn).mock.calls[0]![0].parts).toEqual([
      { type: 'text', text: 'Retried answer.' },
    ]);
    expect(settled[0]!.unsentSteering).toEqual([]);
  });

  it('stops the run from a view that still shows an earlier segment', async () => {
    let signal: AbortSignal | undefined;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    scriptAgent(async opts => {
      signal = opts.signal;
      opts.onTextDelta?.('Before.');
      steerQueue.push(queued('steer-1', 'Change'));
      const [message] = await opts.getSteeringMessages!();
      opts.onUserMessage?.(message!);
      await gate;
      return { error: 'Request was aborted' };
    });
    const run = handleLLMStream(createPort() as never, request());
    await vi.waitFor(() => expect(persisted()).toHaveLength(2));

    expect(stopLLMStream('chat-1', 'unknown-segment')).toBe(false);
    expect(stopLLMStream('chat-1', 'segment-1')).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(isLLMStreamRunning('chat-1')).toBe(false);
    release();
    await run;
    expect(settled[0]).toMatchObject({ outcome: 'stopped' });
  });

  it('reports a failed run as an error outcome', async () => {
    scriptAgent(async opts => {
      opts.onAgentEnd?.({
        agent: { state: { error: 'Provider down' } } as never,
        messages: [],
        stepCount: 1,
        timedOut: false,
      });
      return { error: 'Provider down' };
    });

    await handleLLMStream(createPort() as never, request());

    expect(settled[0]).toMatchObject({ outcome: 'error', unsentSteering: [] });
  });

  it('runs without a port and still reaches subscribed views', async () => {
    const view = createPort();
    await subscribeLLMStream(view as never, 'chat-1');
    scriptAgent(async opts => {
      opts.onTextDelta?.('Queued answer.');
      endAgent(opts);
    });

    await handleLLMStream(undefined, request());

    const types = view.postMessage.mock.calls.map(
      ([message]) => (message as { type: string }).type,
    );
    expect(types).toContain('LLM_STREAM_CHUNK');
    expect(types.at(-1)).toBe('LLM_STREAM_END');
  });

  it('polls nothing and reports nothing when no queue is connected', async () => {
    setStreamQueueHooks(undefined);
    let polled: AgentMessage[] | undefined;
    scriptAgent(async opts => {
      polled = await opts.getSteeringMessages!();
      endAgent(opts);
    });

    await handleLLMStream(createPort() as never, request());

    expect(polled).toEqual([]);
    expect(settled).toEqual([]);
  });
});
