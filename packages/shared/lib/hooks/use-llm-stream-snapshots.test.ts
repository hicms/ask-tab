import { useLLMStream } from './use-llm-stream.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../chat-types.js';

const states: unknown[] = [];
const refs: Array<{ current: unknown }> = [];
const effectDependencies: unknown[][] = [];
const callbacks: Array<{ callback: unknown; dependencies: unknown[] }> = [];
const cleanups: Array<() => void> = [];
let stateIndex = 0;
let refIndex = 0;
let effectIndex = 0;
let callbackIndex = 0;
let pendingEffects: Array<() => unknown> = [];
let delayInitialSnapshot = false;

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
  useCallback: (callback: unknown, dependencies: unknown[]) => {
    const index = callbackIndex++;
    const previous = callbacks[index];
    if (
      !previous ||
      dependencies.some((value, slot) => !Object.is(value, previous.dependencies[slot]))
    ) {
      callbacks[index] = { callback, dependencies };
    }
    return callbacks[index].callback;
  },
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
  stateIndex = refIndex = effectIndex = callbackIndex = 0;
  pendingEffects = [];
  // eslint-disable-next-line react-hooks/rules-of-hooks -- The test runner preserves hook state between renders.
  const result = useLLMStream({ chatId: 'current-chat', model, initialMessages });
  for (const effect of pendingEffects) {
    const cleanup = effect();
    if (typeof cleanup === 'function') cleanups.push(cleanup as () => void);
  }
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
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    delayInitialSnapshot = false;
    states.length = refs.length = effectDependencies.length = callbacks.length = 0;
    vi.stubGlobal('chrome', {
      runtime: {
        connect: vi.fn(() => {
          let receive: (message: unknown) => void;
          return {
            postMessage: vi.fn(message => {
              if (message.type === 'LLM_STREAM_SUBSCRIBE' && !delayInitialSnapshot)
                receive({
                  type: 'LLM_STREAM_SNAPSHOT',
                  chatId: 'current-chat',
                  messages: states[0],
                  status: 'idle',
                });
            }),
            disconnect: vi.fn(),
            onMessage: {
              addListener: vi.fn(listener => {
                receive = listener;
              }),
            },
            onDisconnect: { addListener: vi.fn() },
          };
        }),
      },
    });
  });

  it('acknowledges a shortcut during synchronization and sends it once when idle', () => {
    delayInitialSnapshot = true;
    const initial: ChatMessage[] = [];
    render(initial).sendMessage('Summarize this page');
    const pending = render(initial);
    expect(pending.input).toBe('Summarize this page');
    expect(pending.messages).toEqual([]);
    const subscription = vi.mocked(chrome.runtime.connect).mock.results[0].value;
    subscription.onMessage.addListener.mock.calls[0][0]({
      type: 'LLM_STREAM_SNAPSHOT',
      chatId: 'current-chat',
      messages: [],
      status: 'idle',
    });
    render(initial);
    const sent = render(initial);
    expect(
      sent.messages.filter(message => message.role === 'user').map(message => message.parts),
    ).toEqual([[{ type: 'text', text: 'Summarize this page' }]]);
    expect(sent.input).toBe('');
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(2);
    const request = vi.mocked(chrome.runtime.connect).mock.results[1].value;
    expect(request.postMessage).toHaveBeenCalledOnce();
    expect(request.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'LLM_REQUEST' }),
    );
  });

  it('does not send a pending shortcut after the user edits its draft', () => {
    delayInitialSnapshot = true;
    const initial: ChatMessage[] = [];
    const hook = render(initial);
    hook.sendMessage('Summarize this page');
    hook.setInput('I changed my mind');
    const subscription = vi.mocked(chrome.runtime.connect).mock.results[0].value;
    subscription.onMessage.addListener.mock.calls[0][0]({
      type: 'LLM_STREAM_SNAPSHOT',
      chatId: 'current-chat',
      messages: [],
      status: 'idle',
    });
    render(initial);
    const updated = render(initial);
    expect(updated.messages).toEqual([]);
    expect(updated.input).toBe('I changed my mind');
    expect(chrome.runtime.connect).toHaveBeenCalledOnce();
  });

  it('keeps the shortcut as a draft when synchronization restores a running turn', () => {
    delayInitialSnapshot = true;
    const initial: ChatMessage[] = [];
    render(initial).sendMessage('Summarize this page');
    const subscription = vi.mocked(chrome.runtime.connect).mock.results[0].value;
    const receive = subscription.onMessage.addListener.mock.calls[0][0];
    receive({
      type: 'LLM_STREAM_SNAPSHOT',
      chatId: 'current-chat',
      messages: [persistedMessage()],
      status: 'streaming',
    });
    render(initial);
    receive({ type: 'LLM_STREAM_END', finishReason: 'stop' });
    render(initial);
    const finished = render(initial);
    expect(finished.status).toBe('idle');
    expect(finished.messages).toEqual([persistedMessage()]);
    expect(finished.input).toBe('Summarize this page');
    expect(chrome.runtime.connect).toHaveBeenCalledOnce();
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
    const port = vi.mocked(chrome.runtime.connect).mock.results.at(-1)!.value;
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
    const port = vi.mocked(chrome.runtime.connect).mock.results.at(-1)!.value;
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

  it('detaches without Stop and restores an in-flight turn when the view mounts again', () => {
    const initial: ChatMessage[] = [];
    render(initial).sendMessage('Keep working');
    const original = vi.mocked(chrome.runtime.connect).mock.results.at(-1)!.value;
    const receiveOriginal = original.onMessage.addListener.mock.calls[0][0];
    receiveOriginal({ type: 'LLM_STREAM_CHUNK', reasoning: 'Before leaving.' });
    for (const cleanup of cleanups.splice(0)) cleanup();
    expect(original.disconnect).toHaveBeenCalledOnce();
    expect(
      original.postMessage.mock.calls.map(([message]: [{ type: string }]) => message.type),
    ).toEqual(['LLM_REQUEST']);

    const backgroundMessages = structuredClone(states[0]) as ChatMessage[];
    backgroundMessages.at(-1)!.parts = [
      { type: 'reasoning', text: 'Before leaving. Continued in background.' },
    ];
    states.length = refs.length = effectDependencies.length = callbacks.length = 0;
    render(initial);
    const returning = vi.mocked(chrome.runtime.connect).mock.results.at(-1)!.value;
    const receive = returning.onMessage.addListener.mock.calls[0][0];
    receive({
      type: 'LLM_STREAM_SNAPSHOT',
      chatId: 'current-chat',
      status: 'streaming',
      messages: backgroundMessages,
      assistantMessageId: backgroundMessages.at(-1)!.id,
    });
    let hook = render(initial);
    expect(hook.status).toBe('streaming');
    expect(hook.messages).toEqual(backgroundMessages);
    hook.sendMessage('Must not start another turn');
    expect(returning.postMessage).toHaveBeenCalledTimes(1);
    receiveOriginal({ type: 'LLM_STREAM_CHUNK', delta: 'Stale event from the old view' });
    receive({ type: 'LLM_STREAM_CHUNK', delta: 'Live after returning.' });
    hook = render(initial);
    expect(hook.messages.at(-1)!.parts).toEqual([
      { type: 'reasoning', text: 'Before leaving. Continued in background.' },
      { type: 'text', text: 'Live after returning.' },
    ]);
    hook.stop();
    expect(returning.postMessage).toHaveBeenLastCalledWith({
      type: 'LLM_STREAM_STOP',
      chatId: 'current-chat',
      assistantMessageId: backgroundMessages.at(-1)!.id,
    });
    expect(render(initial).status).toBe('idle');
  });
});
