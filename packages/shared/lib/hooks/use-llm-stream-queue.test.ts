import { useLLMStream } from './use-llm-stream.js';
import { MAX_QUEUED_MESSAGES } from '../chat-queue.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedChatMessage } from '../chat-queue.js';
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

const model = { id: 'test-model', name: 'Test Model', provider: 'custom' as const };
const CHAT = 'current-chat';

const render = () => {
  stateIndex = refIndex = effectIndex = callbackIndex = 0;
  pendingEffects = [];
  // eslint-disable-next-line react-hooks/rules-of-hooks -- The test runner preserves hook state between renders.
  const result = useLLMStream({ chatId: CHAT, model });
  for (const effect of pendingEffects) {
    const cleanup = effect();
    if (typeof cleanup === 'function') cleanups.push(cleanup as () => void);
  }
  return result;
};

type MockPort = {
  postMessage: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  receive: (message: unknown) => void;
  dropConnection: () => void;
};

const ports: MockPort[] = [];
const lastPort = () => ports.at(-1)!;
const sent = (port: MockPort) => port.postMessage.mock.calls.map(([message]) => message);

const queued = (id: string, mode: QueuedChatMessage['mode'] = 'queue'): QueuedChatMessage => ({
  id,
  text: id,
  mode,
  model,
  createdAt: 1,
});

const userMessage: ChatMessage = {
  id: 'user',
  chatId: CHAT,
  role: 'user',
  parts: [{ type: 'text', text: 'Question' }],
  createdAt: 1,
};

/** Mounts the hook and answers its subscription with an idle chat. */
const mount = () => {
  render();
  lastPort().receive({ type: 'LLM_STREAM_SNAPSHOT', chatId: CHAT, messages: [], status: 'idle' });
  return render();
};

describe('useLLMStream queue', () => {
  beforeEach(() => {
    states.length = refs.length = effectDependencies.length = callbacks.length = 0;
    ports.length = 0;
    vi.stubGlobal('chrome', {
      runtime: {
        connect: vi.fn(() => {
          const listeners: Array<(message: unknown) => void> = [];
          const disconnectListeners: Array<() => void> = [];
          const port: MockPort = {
            postMessage: vi.fn(),
            disconnect: vi.fn(),
            receive: message => listeners.forEach(listener => listener(message)),
            dropConnection: () => disconnectListeners.forEach(listener => listener()),
          };
          ports.push(port);
          return {
            ...port,
            onMessage: {
              addListener: (listener: (message: unknown) => void) => listeners.push(listener),
            },
            onDisconnect: {
              addListener: (listener: () => void) => disconnectListeners.push(listener),
            },
          };
        }),
      },
    });
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the queue snapshot of the current chat only', () => {
    mount();
    lastPort().receive({
      type: 'LLM_QUEUE_SNAPSHOT',
      chatId: CHAT,
      items: [queued('a')],
      pauseReason: 'stopped',
    });
    lastPort().receive({ type: 'LLM_QUEUE_SNAPSHOT', chatId: 'other', items: [queued('x')] });

    expect(render().queue).toEqual({ items: [queued('a')], pauseReason: 'stopped' });
  });

  it('sends queue commands on the subscribed port', () => {
    const hook = mount();
    expect(hook.enqueue('Next question', 'steer')).toBe(true);
    hook.removeQueued('a');
    hook.steerQueued('b');
    hook.resumeQueue();
    hook.editQueued('c');

    const [add, remove, steer, resume, edit] = sent(lastPort()).slice(1);
    expect(add).toEqual({
      type: 'LLM_QUEUE_ADD',
      chatId: CHAT,
      item: {
        id: expect.any(String),
        text: 'Next question',
        mode: 'steer',
        model,
        createdAt: expect.any(Number),
      },
    });
    expect(remove).toEqual({ type: 'LLM_QUEUE_REMOVE', chatId: CHAT, itemId: 'a' });
    expect(steer).toEqual({ type: 'LLM_QUEUE_STEER', chatId: CHAT, itemId: 'b' });
    expect(resume).toEqual({ type: 'LLM_QUEUE_RESUME', chatId: CHAT });
    expect(edit).toEqual({ type: 'LLM_QUEUE_EDIT', chatId: CHAT, itemId: 'c' });
    expect(ports).toHaveLength(1);
  });

  it('puts a message taken back to edit into the composer after any draft', () => {
    mount();
    const port = lastPort();
    port.receive({ type: 'LLM_QUEUE_EDIT_TEXT', chatId: CHAT, text: 'First' });
    expect(render().input).toBe('First');

    render().setInput('Draft  ');
    port.receive({ type: 'LLM_QUEUE_EDIT_TEXT', chatId: CHAT, text: 'Second' });
    expect(render().input).toBe('Draft\nSecond');

    port.receive({ type: 'LLM_QUEUE_EDIT_TEXT', chatId: 'other', text: 'Elsewhere' });
    port.dropConnection();
    port.receive({ type: 'LLM_QUEUE_EDIT_TEXT', chatId: CHAT, text: 'Stale' });
    expect(render().input).toBe('Draft\nSecond');
  });

  it('refuses to queue past the limit', () => {
    mount();
    const items = Array.from({ length: MAX_QUEUED_MESSAGES }, (_, i) => queued(`m${i}`));
    lastPort().receive({ type: 'LLM_QUEUE_SNAPSHOT', chatId: CHAT, items });

    expect(render().enqueue('One too many', 'queue')).toBe(false);
    expect(sent(lastPort()).some(m => (m as { type: string }).type === 'LLM_QUEUE_ADD')).toBe(
      false,
    );
  });

  it('returns the cleared queue so it can be restored with its pause', () => {
    mount();
    lastPort().receive({
      type: 'LLM_QUEUE_SNAPSHOT',
      chatId: CHAT,
      items: [queued('a')],
      pauseReason: 'error',
    });
    const hook = render();

    const cleared = hook.clearQueue();
    hook.restoreQueue(cleared);

    expect(sent(lastPort()).slice(-2)).toEqual([
      { type: 'LLM_QUEUE_CLEAR', chatId: CHAT },
      { type: 'LLM_QUEUE_RESTORE', chatId: CHAT, items: [queued('a')], pauseReason: 'error' },
    ]);
  });

  it('stays subscribed after a turn ends and follows the next queued turn', () => {
    mount().sendMessage('Question');
    const port = lastPort();
    port.receive({ type: 'LLM_STREAM_CHUNK', chatId: CHAT, delta: 'Answer' });
    port.receive({ type: 'LLM_STREAM_END', chatId: CHAT, finishReason: 'stop' });
    expect(render().status).toBe('idle');
    expect(port.disconnect).not.toHaveBeenCalled();

    const next: ChatMessage = { ...userMessage, id: 'queued-user' };
    const placeholder: ChatMessage = {
      id: 'queued-reply',
      chatId: CHAT,
      role: 'assistant',
      parts: [],
      createdAt: 2,
    };
    port.receive({
      type: 'LLM_STREAM_SNAPSHOT',
      chatId: CHAT,
      messages: [...render().messages, next, placeholder],
      status: 'connecting',
      assistantMessageId: 'queued-reply',
    });
    port.receive({ type: 'LLM_STREAM_CHUNK', chatId: CHAT, delta: 'Queued answer' });

    const hook = render();
    expect(hook.status).toBe('streaming');
    expect(hook.messages.map(m => m.id).slice(-2)).toEqual(['queued-user', 'queued-reply']);
    expect(hook.messages.at(-1)!.parts).toEqual([{ type: 'text', text: 'Queued answer' }]);
    expect(hook.messages.at(-3)!.parts).toEqual([{ type: 'text', text: 'Answer' }]);
  });

  it('accepts output again when a new turn starts after Stop', () => {
    const hook = mount();
    hook.sendMessage('Question');
    const port = lastPort();
    hook.stop();
    port.receive({ type: 'LLM_STREAM_CHUNK', chatId: CHAT, delta: 'Late output' });
    expect(render().messages.at(-1)!.parts).toEqual([]);

    port.receive({
      type: 'LLM_STREAM_SNAPSHOT',
      chatId: CHAT,
      messages: [userMessage, { ...userMessage, id: 'reply', role: 'assistant', parts: [] }],
      status: 'connecting',
      assistantMessageId: 'reply',
    });
    port.receive({ type: 'LLM_STREAM_CHUNK', chatId: CHAT, delta: 'Fresh output' });

    expect(render().messages.at(-1)!.parts).toEqual([{ type: 'text', text: 'Fresh output' }]);
  });

  it('sends Stop without a turn ID when no turn is running here', () => {
    const hook = mount();
    hook.stop();

    expect(sent(lastPort()).at(-1)).toEqual({
      type: 'LLM_STREAM_STOP',
      chatId: CHAT,
      assistantMessageId: undefined,
    });
  });

  it('streams into the new segment after a steering split', () => {
    const hook = mount();
    hook.sendMessage('Question');
    const port = lastPort();
    port.receive({ type: 'LLM_STREAM_CHUNK', chatId: CHAT, delta: 'First part' });
    const [prompt, first] = render().messages;
    const steer: ChatMessage = { ...userMessage, id: 'steer', createdAt: 3 };
    const second: ChatMessage = { ...first!, id: 'second', parts: [], createdAt: 4 };
    port.receive({
      type: 'LLM_STREAM_SNAPSHOT',
      chatId: CHAT,
      messages: [prompt, first, steer, second],
      status: 'streaming',
      assistantMessageId: 'second',
    });
    port.receive({ type: 'LLM_STREAM_CHUNK', chatId: CHAT, delta: 'Second part' });
    render().stop();

    const messages = render().messages;
    expect(messages.map(m => m.parts)).toEqual([
      prompt!.parts,
      [{ type: 'text', text: 'First part' }],
      steer.parts,
      [{ type: 'text', text: 'Second part' }],
    ]);
    expect(sent(port).at(-1)).toMatchObject({ assistantMessageId: 'second' });
  });

  it('pauses the shown queue when the worker restarts and reconnects on the next command', () => {
    mount();
    const port = lastPort();
    port.receive({
      type: 'LLM_QUEUE_SNAPSHOT',
      chatId: CHAT,
      items: [queued('a', 'steer'), queued('b')],
    });
    port.dropConnection();

    const hook = render();
    expect(hook.queue).toEqual({
      items: [queued('a'), queued('b')],
      pauseReason: 'restarted',
    });

    hook.resumeQueue();
    expect(ports).toHaveLength(2);
    expect(sent(lastPort())).toEqual([
      { type: 'LLM_STREAM_SUBSCRIBE', chatId: CHAT },
      { type: 'LLM_QUEUE_RESUME', chatId: CHAT },
    ]);
  });
});
