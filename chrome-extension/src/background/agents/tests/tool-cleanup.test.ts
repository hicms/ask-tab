import { registerToolCleanup } from '../../tools/tool-lifecycle';
import { Agent } from '../agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';

const { loop } = vi.hoisted(() => ({ loop: vi.fn() }));
vi.mock('../agent-loop', () => ({ agentLoop: loop, agentLoopContinue: loop }));
vi.mock('../../logging/logger-buffer', () => ({ createLogger: () => ({ warn: vi.fn() }) }));

const model = {
  id: 'test',
  api: 'openai-completions',
  provider: 'openai',
} as Model<'openai-completions'>;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { promise, resolve };
};

beforeEach(() => loop.mockReset());

describe('Agent tool cleanup', () => {
  it.each(['success', 'error', 'abort'])(
    'releases resources before completion on %s',
    async outcome => {
      const released = vi.fn(async () => {});
      const started = deferred();
      const agent = new Agent({ initialState: { model } });
      loop.mockImplementation(async function* (_messages, _context, _config, signal: AbortSignal) {
        registerToolCleanup(signal, 'page', released);
        started.resolve();
        if (outcome === 'abort') {
          await new Promise<void>(resolve =>
            signal.addEventListener('abort', () => resolve(), { once: true }),
          );
        }
        if (outcome === 'error') throw new Error('model failed');
        yield { type: 'agent_end', messages: [] } as AgentEvent;
      });
      const observed = vi.fn(() => {
        expect(released).toHaveBeenCalledOnce();
        expect(agent.state.isStreaming).toBe(false);
      });
      agent.subscribe(event => {
        if (event.type === 'agent_end') observed();
      });
      const running = agent.prompt('test');
      await started.promise;
      if (outcome === 'abort') agent.abort();
      await running;
      expect(observed).toHaveBeenCalledOnce();
      if (outcome === 'error') expect(agent.state.error).toBe('model failed');
    },
  );

  it('stays busy during cleanup and allows a new prompt from the completion observer', async () => {
    const cleaning = deferred();
    const finish = deferred();
    const agent = new Agent({ initialState: { model } });
    let runs = 0;
    loop.mockImplementation(async function* (_messages, _context, _config, signal: AbortSignal) {
      if (++runs === 1)
        registerToolCleanup(signal, 'page', async () => {
          cleaning.resolve();
          await finish.promise;
        });
      yield { type: 'agent_end', messages: [] } as AgentEvent;
    });
    let second: Promise<void> | undefined;
    agent.subscribe(event => {
      if (event.type === 'agent_end' && runs === 1) second = agent.prompt('next');
    });
    const first = agent.prompt('first');
    await cleaning.promise;
    await expect(agent.prompt('too soon')).rejects.toThrow('already processing');
    finish.resolve();
    await first;
    await second;
    expect(runs).toBe(2);
    expect(agent.state.isStreaming).toBe(false);
  });

  it('preserves the run result if a cleanup callback fails', async () => {
    loop.mockImplementation(async function* (_messages, _context, _config, signal: AbortSignal) {
      registerToolCleanup(signal, 'closed-tab', async () => {
        throw new Error('tab closed');
      });
      yield { type: 'agent_end', messages: [] } as AgentEvent;
    });
    const agent = new Agent({ initialState: { model } });
    await agent.prompt('test');
    expect(agent.state.error).toBeUndefined();
  });
});
