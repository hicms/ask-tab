import { locked } from './service/locked';
import { describe, expect, it } from 'vitest';
import type { CronState } from './service/state';

const makeState = (): CronState => ({
  deps: {
    nowMs: () => Date.now(),
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    executeTask: async () => ({ status: 'ok' }),
  },
  store: null,
  started: false,
  running: false,
  op: Promise.resolve(),
});

describe('locked', () => {
  it('returns the result of the function', async () => {
    const state = makeState();
    const result = await locked(state, async () => 42);
    expect(result).toBe(42);
  });

  it('serializes concurrent operations', async () => {
    const state = makeState();
    const order: number[] = [];

    const op1 = locked(state, async () => {
      await new Promise(r => setTimeout(r, 50));
      order.push(1);
    });

    const op2 = locked(state, async () => {
      order.push(2);
    });

    await Promise.all([op1, op2]);
    expect(order).toEqual([1, 2]);
  });

  it('continues chain after error', async () => {
    const state = makeState();

    await locked(state, async () => {
      throw new Error('boom');
    }).catch(() => {});

    const result = await locked(state, async () => 'recovered');
    expect(result).toBe('recovered');
  });

  it('propagates errors to the caller', async () => {
    const state = makeState();
    await expect(
      locked(state, async () => {
        throw new Error('test error');
      }),
    ).rejects.toThrow('test error');
  });
});
