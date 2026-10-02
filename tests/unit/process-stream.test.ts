import { useLLMStream } from '../../packages/shared/lib/hooks/use-llm-stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@extension/shared';

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  stateIndex: 0,
  refIndex: 0,
}));
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [
      hooks.states[index],
      (next: unknown) => {
        hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++;
    hooks.refs[index] ??= { current: initial };
    return hooks.refs[index];
  },
  useCallback: (callback: unknown) => callback,
  useEffect: vi.fn(),
}));

const model = { id: 'test', name: 'Test', provider: 'custom' as const };
const complete = vi.fn();
const render = () => {
  hooks.stateIndex = hooks.refIndex = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Test-only stateful hook runner; DOM behavior is covered in Playwright.
  return useLLMStream({ chatId: 'chat', model, onStreamComplete: complete });
};
let receive: (message: Record<string, unknown>) => void;
const system: ChatMessage = {
  id: 'system-result',
  chatId: 'chat',
  role: 'system',
  createdAt: 10,
  parts: [{ type: 'text', text: 'A subagent finished.' }],
};
const toolCall = {
  type: 'LLM_STREAM_CHUNK',
  toolCall: { id: 'read-1', name: 'read', args: {} },
  state: 'input-available',
};

describe('process stream ownership', () => {
  beforeEach(() => {
    hooks.states.length = hooks.refs.length = 0;
    complete.mockClear();
    vi.stubGlobal('chrome', {
      runtime: {
        connect: vi.fn(() => ({
          postMessage: vi.fn(),
          disconnect: vi.fn(),
          onMessage: {
            addListener: (callback: typeof receive) => {
              receive = callback;
            },
          },
          onDisconnect: { addListener: vi.fn() },
        })),
      },
    });
  });

  it('updates and completes the owning assistant after a system result is appended', async () => {
    render().sendMessage('Start');
    const id = render().activeAssistantId;
    receive(toolCall);
    render().setMessages(previous => [...previous, system]);
    receive({
      type: 'LLM_STREAM_CHUNK',
      toolResult: { id: 'read-1', result: 'Read result' },
      state: 'output-available',
    });
    receive({ type: 'LLM_STREAM_CHUNK', delta: 'Final answer' });
    const hook = render();
    expect(hook.activeAssistantId).toBe(id);
    expect(hook.messages.at(-1)).toEqual(system);
    expect(hook.messages.find(message => message.id === id)?.parts).toMatchObject([
      { type: 'tool-call', result: 'Read result', state: 'output-available' },
      { type: 'text', text: 'Final answer' },
    ]);
    receive({ type: 'LLM_STREAM_END', finishReason: 'stop' });
    await Promise.resolve();
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ id }), undefined);
    expect(render().activeAssistantId).toBeUndefined();
  });

  it('resets only the retried message even when clear and append arrive before a render', () => {
    render().sendMessage('First');
    const firstId = render().activeAssistantId!;
    receive({ type: 'LLM_STREAM_CHUNK', reasoning: 'Old attempt' });
    receive({ type: 'LLM_STREAM_RETRY', attempt: 1 });
    receive({ type: 'LLM_STREAM_CHUNK', reasoning: 'New attempt' });
    const first = render();
    expect(first.messages.at(-1)?.parts).toEqual([{ type: 'reasoning', text: 'New attempt' }]);
    expect(first.processResetGenerations[firstId]).toBe(1);
    receive({ type: 'LLM_STREAM_END', finishReason: 'stop' });
    render().sendMessage('Next');
    const secondId = render().activeAssistantId!;
    receive({ type: 'LLM_STREAM_RETRY', attempt: 1 });
    expect(render().processResetGenerations).toEqual({ [firstId]: 1, [secondId]: 1 });
  });

  it('preserves reset identity on snapshots and follows a steered segment', () => {
    render().sendMessage('First');
    receive({ type: 'LLM_STREAM_RETRY', attempt: 1 });
    const before = render();
    const oldId = before.activeAssistantId!;
    receive({
      type: 'LLM_STREAM_SNAPSHOT',
      chatId: 'chat',
      messages: structuredClone(before.messages),
      assistantMessageId: oldId,
      status: 'streaming',
    });
    expect(render().processResetGenerations).toEqual(before.processResetGenerations);
    const next: ChatMessage = {
      id: 'steered',
      chatId: 'chat',
      role: 'assistant',
      parts: [],
      createdAt: 15,
    };
    receive({
      type: 'LLM_STREAM_SNAPSHOT',
      chatId: 'chat',
      messages: [...before.messages, { ...system, role: 'user' }, next],
      assistantMessageId: next.id,
      status: 'streaming',
    });
    receive({ type: 'LLM_STREAM_CHUNK', reasoning: 'After steering' });
    expect(render().activeAssistantId).toBe(next.id);
    expect(render().messages.at(-1)?.parts).toEqual([
      { type: 'reasoning', text: 'After steering' },
    ]);
    expect(render().messages.find(message => message.id === oldId)?.parts).toEqual([]);
  });

  it('stops the pending tool rather than changing the trailing system card', () => {
    render().sendMessage('First');
    receive(toolCall);
    render().setMessages(previous => [...previous, system]);
    render().stop();
    const stopped = render();
    expect(stopped.activeAssistantId).toBeUndefined();
    expect(stopped.messages.at(-1)).toEqual(system);
    expect(stopped.messages.at(-2)?.parts[0]).toMatchObject({ state: 'output-error' });
  });
});
