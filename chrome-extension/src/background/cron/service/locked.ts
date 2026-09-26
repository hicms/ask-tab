// ── Promise-chain mutex ─────────────────────

import type { CronState } from './state';

const resolveChain = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    () => undefined,
  );

export const locked = async <T>(state: CronState, fn: () => Promise<T>): Promise<T> => {
  const next = resolveChain(state.op).then(fn);
  const keepAlive = resolveChain(next);
  state.op = keepAlive;
  return (await next) as T;
};
