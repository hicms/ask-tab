import { useLLMStream } from './use-llm-stream.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../chat-types.js';

const states: unknown[] = [];
const refs: Array<{ current: unknown }> = [];
const effectDependencies: unknown[][] = [];
let stateIndex = 0;
let refIndex = 0;
let effectIndex = 0;
let pendingEffects: Array<() => unknown> = [];

vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = initial;
    return [
      states[index],
      (next: unknown) => {
        states[index] = typeof next === 'function' ? next(states[index]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = refIndex++;
    refs[index] ??= { current: initial };
    return refs[index];
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown, dependencies: unknown[]) => {
    const index = effectIndex++;
    const previous = effectDependencies[index];
    if (!previous || dependencies.some((value, slot) => !Object.is(value, previous[slot]))) {
      pendingEffects.push(effect);
    }
    effectDependencies[index] = dependencies;
  },
}));

const model = {
  id: 'test-model',
  name: 'Test Model',
  provider: 'custom' as const,
  routingMode: 'direct' as const,
};

const render = (initialMessages?: ChatMessage[]) => {
  stateIndex = refIndex = effectIndex = 0;
  pendingEffects = [];
  // eslint-disable-next-line react-hooks/rules-of-hooks -- The test runner preserves hook state between renders.
  const result = useLLMStream({ chatId: 'current-chat', model, initialMessages });
  for (const effect of pendingEffects) effect();
  return result;
};

const persistedMessage = (chatId = 'current-chat'): ChatMessage => ({
  id: 'channel-message',
  chatId,
  role: 'user',
  parts: [{ type: 'text', text: 'Incoming channel question' }],
  createdAt: 1,
});

describe('useLLMStream persisted snapshots', () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    states.length = refs.length = effectDependencies.length = 0;
    vi.stubGlobal('chrome', {
      runtime: {
        connect: vi.fn(() => ({
          postMessage: vi.fn(),
          disconnect: vi.fn(),
          onMessage: { addListener: vi.fn() },
          onDisconnect: { addListener: vi.fn() },
        })),
      },
    });
  });

  it('refreshes the current idle transcript without changing the draft', () => {
    const initial: ChatMessage[] = [];
    render(initial).setInput('Unfinished draft');
    const snapshot = [persistedMessage()];
    render(snapshot);
    const updated = render(snapshot);
    expect(updated.messages).toEqual(snapshot);
    expect(updated.input).toBe('Unfinished draft');
  });

  it('discards a snapshot during a local stream instead of replaying it when the stream ends', () => {
    const initial: ChatMessage[] = [];
    render(initial).sendMessage('Local question');
    const port = vi.mocked(chrome.runtime.connect).mock.results[0].value;
    const receive = port.onMessage.addListener.mock.calls[0][0];
    const staleSnapshot = [persistedMessage()];
    render(staleSnapshot);
    receive({ type: 'LLM_STREAM_CHUNK', delta: 'Local answer' });
    receive({ type: 'LLM_STREAM_END', finishReason: 'stop' });
    render(staleSnapshot);
    const finished = render(staleSnapshot);
    expect(finished.status).toBe('idle');
    expect(finished.messages.map(message => message.parts)).toEqual([
      [{ type: 'text', text: 'Local question' }],
      [{ type: 'text', text: 'Local answer' }],
    ]);
  });

  it('rejects a delayed snapshot belonging to another chat', () => {
    const initial = [persistedMessage()];
    render(initial).setInput('Current draft');
    const otherChatSnapshot = [persistedMessage('previous-chat')];
    render(otherChatSnapshot);
    const current = render(otherChatSnapshot);
    expect(current.messages).toEqual(initial);
    expect(current.input).toBe('Current draft');
  });

  it('accepts a new channel snapshot after a local request fails', () => {
    const initial: ChatMessage[] = [];
    const hook = render(initial);
    hook.sendMessage('Local question');
    const port = vi.mocked(chrome.runtime.connect).mock.results[0].value;
    const receive = port.onMessage.addListener.mock.calls[0][0];
    receive({ type: 'LLM_STREAM_ERROR', error: 'Connection failed' });
    hook.setInput('Draft after the failure');
    const snapshot = [persistedMessage()];
    render(snapshot);
    const updated = render(snapshot);
    expect(updated.messages).toEqual(snapshot);
    expect(updated.input).toBe('Draft after the failure');
  });

  it('does not manufacture new empty snapshots when initialMessages is omitted', () => {
    const hook = render();
    hook.sendMessage('Local question');
    hook.stop();
    render();
    const updated = render();
    expect(updated.messages[0].parts).toEqual([{ type: 'text', text: 'Local question' }]);
  });
});
