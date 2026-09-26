import {
  detectToolCallLoop,
  recordToolCall,
  recordToolCallOutcome,
  createToolLoopState,
  stableJsonSerialize,
  hashToolCall,
  hashResult,
  getNoProgressStreak,
} from './tool-loop-detection';
import { describe, it, expect, beforeEach } from 'vitest';
import type { ToolLoopConfig, ToolLoopState, ToolCallRecord } from './tool-loop-detection';

const smallConfig: ToolLoopConfig = {
  enabled: true,
  warningThreshold: 3,
  criticalThreshold: 5,
  breakerThreshold: 7,
  pingPongThreshold: 4,
  pingPongNoProgressMin: 4,
  globalNoProgressBreaker: 10,
  knownPollTools: ['check_status'],
  pollNoProgressThreshold: 5,
  windowSize: 20,
  warningThrottleInterval: 10,
  highCostTools: ['browser', 'debugger'],
  highCostWarningThreshold: 2,
  largeResultWarningThreshold: 4,
  largeResultBreakerThreshold: 8,
  largeResultSizeBytes: 50000,
};

/** Helper: record a call and set its result in one step. */
const recordWithResult = async (
  state: ToolLoopState,
  toolName: string,
  params: unknown,
  result: unknown,
  toolCallId: string,
  config: ToolLoopConfig = smallConfig,
) => {
  await recordToolCall(state, toolName, params, toolCallId, config);
  await recordToolCallOutcome(state, toolCallId, result);
};

describe('tool-loop-detection', () => {
  let state: ToolLoopState;

  beforeEach(() => {
    state = createToolLoopState();
  });

  it('returns none for empty state', async () => {
    const result = await detectToolCallLoop(state, 'web_search', { query: 'hello' });
    expect(result.severity).toBe('none');
    expect(result.shouldBlock).toBe(false);
  });

  it('passes through when disabled', async () => {
    for (let i = 0; i < 40; i++) {
      await recordWithResult(state, 'test', { a: 1 }, 'same', `id-${i}`, smallConfig);
    }
    const result = await detectToolCallLoop(
      state,
      'test',
      { a: 1 },
      {
        ...smallConfig,
        enabled: false,
      },
    );
    expect(result.severity).toBe('none');
    expect(result.shouldBlock).toBe(false);
  });

  it('triggers warning at warningThreshold', async () => {
    for (let i = 0; i < smallConfig.warningThreshold; i++) {
      await recordWithResult(state, 'web_search', { query: 'test' }, 'same', `id-${i}`);
    }
    const result = await detectToolCallLoop(state, 'web_search', { query: 'test' }, smallConfig);
    expect(result.severity).toBe('warning');
    expect(result.shouldBlock).toBe(false);
  });

  it('triggers critical at criticalThreshold', async () => {
    for (let i = 0; i < smallConfig.criticalThreshold; i++) {
      await recordWithResult(state, 'web_search', { query: 'test' }, 'same', `id-${i}`);
    }
    const result = await detectToolCallLoop(state, 'web_search', { query: 'test' }, smallConfig);
    expect(result.severity).toBe('critical');
    expect(result.shouldBlock).toBe(false);
  });

  it('triggers circuit breaker at breakerThreshold with no progress', async () => {
    for (let i = 0; i < smallConfig.breakerThreshold; i++) {
      await recordWithResult(state, 'web_search', { query: 'test' }, 'same-result', `id-${i}`);
    }
    const result = await detectToolCallLoop(state, 'web_search', { query: 'test' }, smallConfig);
    expect(result.severity).toBe('circuit_breaker');
    expect(result.shouldBlock).toBe(true);
    expect(result.reason).toContain('no progress');
  });

  it('does NOT trigger circuit breaker when results change (progress)', async () => {
    for (let i = 0; i < smallConfig.breakerThreshold; i++) {
      await recordWithResult(state, 'web_search', { query: 'test' }, `result-${i}`, `id-${i}`);
    }
    const result = await detectToolCallLoop(state, 'web_search', { query: 'test' }, smallConfig);
    // Should not block because results are changing (progress)
    expect(result.shouldBlock).toBe(false);
  });

  it('no-progress streak blocks after threshold', async () => {
    // 5 calls with progress, then enough no-progress to trigger breaker
    for (let i = 0; i < 5; i++) {
      await recordWithResult(state, 'tool_x', { q: 1 }, `result-${i}`, `prog-${i}`);
    }
    for (let i = 0; i < smallConfig.breakerThreshold; i++) {
      await recordWithResult(state, 'tool_x', { q: 1 }, 'stuck', `stuck-${i}`);
    }
    const result = await detectToolCallLoop(state, 'tool_x', { q: 1 }, smallConfig);
    expect(result.shouldBlock).toBe(true);
  });

  it('progress resets streak — no block', async () => {
    // Repeat calls but with changing results interspersed
    for (let i = 0; i < smallConfig.breakerThreshold + 5; i++) {
      // Every 3rd call returns different result → breaks streak
      const res = i % 3 === 0 ? `unique-${i}` : 'common';
      await recordWithResult(state, 'tool_x', { q: 1 }, res, `id-${i}`);
    }
    const result = await detectToolCallLoop(state, 'tool_x', { q: 1 }, smallConfig);
    // The no-progress streak is at most 2 (between unique results)
    expect(result.shouldBlock).toBe(false);
  });

  it('diverse tool calls never blocked', async () => {
    // 100+ unique tool calls — should never trigger any breaker
    const config = { ...smallConfig, windowSize: 120, globalNoProgressBreaker: 100 };
    for (let i = 0; i < 100; i++) {
      await recordWithResult(state, `tool_${i}`, { unique: i }, `result_${i}`, `id-${i}`, config);
    }
    const result = await detectToolCallLoop(state, 'new_tool', { unique: 999 }, config);
    expect(result.shouldBlock).toBe(false);
    expect(result.severity).toBe('none');
  });

  it('triggers global no-progress breaker', async () => {
    // All same tool+args+result → global no-progress
    // Need globalNoProgressBreaker+1 calls: first is "first-seen" (not counted as repeat)
    for (let i = 0; i < smallConfig.globalNoProgressBreaker + 1; i++) {
      await recordWithResult(state, 'stuck_tool', { a: 1 }, 'same', `id-${i}`);
    }
    const result = await detectToolCallLoop(state, 'stuck_tool', { a: 1 }, smallConfig);
    expect(result.severity).toBe('circuit_breaker');
    expect(result.shouldBlock).toBe(true);
    expect(result.reason).toContain('Global no-progress');
  });

  it('known poll tools block at lower threshold', async () => {
    for (let i = 0; i < smallConfig.pollNoProgressThreshold; i++) {
      await recordWithResult(state, 'check_status', { id: 42 }, 'pending', `id-${i}`);
    }
    const result = await detectToolCallLoop(state, 'check_status', { id: 42 }, smallConfig);
    expect(result.severity).toBe('circuit_breaker');
    expect(result.shouldBlock).toBe(true);
    expect(result.reason).toContain('Poll tool');
  });

  it('poll tool with progress does not block', async () => {
    for (let i = 0; i < smallConfig.pollNoProgressThreshold; i++) {
      await recordWithResult(state, 'check_status', { id: 42 }, `status-${i}`, `id-${i}`);
    }
    const result = await detectToolCallLoop(state, 'check_status', { id: 42 }, smallConfig);
    expect(result.shouldBlock).toBe(false);
  });

  it('detects ping-pong pattern', async () => {
    const config = { ...smallConfig, pingPongThreshold: 4 };
    await recordWithResult(state, 'tool_a', { x: 1 }, 'res_a', 'id-1', config);
    await recordWithResult(state, 'tool_b', { y: 2 }, 'res_b', 'id-2', config);
    await recordWithResult(state, 'tool_a', { x: 1 }, 'res_a', 'id-3', config);
    await recordWithResult(state, 'tool_b', { y: 2 }, 'res_b', 'id-4', config);

    const result = await detectToolCallLoop(state, 'tool_a', { x: 1 }, config);
    // Both sides have stable results → blocks
    expect(result.severity).toBe('circuit_breaker');
    expect(result.shouldBlock).toBe(true);
    expect(result.reason).toContain('Ping-pong');
  });

  it('ping-pong with progress does not block', async () => {
    const config = { ...smallConfig, pingPongThreshold: 4 };
    await recordWithResult(state, 'tool_a', { x: 1 }, 'res_a_1', 'id-1', config);
    await recordWithResult(state, 'tool_b', { y: 2 }, 'res_b_1', 'id-2', config);
    await recordWithResult(state, 'tool_a', { x: 1 }, 'res_a_2', 'id-3', config);
    await recordWithResult(state, 'tool_b', { y: 2 }, 'res_b_2', 'id-4', config);

    const result = await detectToolCallLoop(state, 'tool_a', { x: 1 }, config);
    // Results are changing → not blocked
    expect(result.shouldBlock).toBe(false);
  });

  it('warning throttling emits every N calls', async () => {
    const config = { ...smallConfig, warningThreshold: 1, warningThrottleInterval: 3 };
    // First call → warning emitted (count=1)
    await recordWithResult(state, 'tool', { a: 1 }, 'r1', 'id-0', config);
    const r1 = await detectToolCallLoop(state, 'tool', { a: 1 }, config);
    expect(r1.severity).toBe('warning');

    // Second call → throttled
    await recordWithResult(state, 'tool', { a: 1 }, 'r1', 'id-1', config);
    const r2 = await detectToolCallLoop(state, 'tool', { a: 1 }, config);
    expect(r2.severity).toBe('none');

    // Third call → emitted (count=3, 3%3==0)
    await recordWithResult(state, 'tool', { a: 1 }, 'r1', 'id-2', config);
    const r3 = await detectToolCallLoop(state, 'tool', { a: 1 }, config);
    expect(r3.severity).toBe('warning');
  });

  it('recordToolCallOutcome sets resultHash', async () => {
    await recordToolCall(state, 'test', { a: 1 }, 'call-1');
    expect(state.entries[0]!.resultHash).toBeUndefined();

    await recordToolCallOutcome(state, 'call-1', { data: 'hello' });
    expect(state.entries[0]!.resultHash).toBeDefined();
    expect(typeof state.entries[0]!.resultHash).toBe('string');
    expect(state.entries[0]!.resultHash!.length).toBe(64); // SHA-256 hex
  });

  it('different args produce different hashes', async () => {
    const hash1 = await hashToolCall('web_search', { query: 'hello' });
    const hash2 = await hashToolCall('web_search', { query: 'world' });
    expect(hash1).not.toBe(hash2);
  });

  it('same args with different key order produce same hash', async () => {
    const hash1 = await hashToolCall('test', { a: 1, b: 2 });
    const hash2 = await hashToolCall('test', { b: 2, a: 1 });
    expect(hash1).toBe(hash2);
  });

  it('trims entries to windowSize', async () => {
    const config = { ...smallConfig, windowSize: 5 };
    for (let i = 0; i < 10; i++) {
      await recordToolCall(state, 'tool', { i }, `id-${i}`, config);
    }
    expect(state.entries.length).toBe(5);
  });

  it('does not count calls outside the sliding window', async () => {
    const config = { ...smallConfig, windowSize: 5, warningThreshold: 3 };
    for (let i = 0; i < 3; i++) {
      await recordWithResult(state, 'old_tool', { q: 'old' }, 'same', `old-${i}`, config);
    }
    for (let i = 0; i < 5; i++) {
      await recordWithResult(state, 'new_tool', { q: i }, `res-${i}`, `new-${i}`, config);
    }
    const result = await detectToolCallLoop(state, 'old_tool', { q: 'old' }, config);
    expect(result.severity).toBe('none');
  });

  it('high-cost tools warn at lower threshold', async () => {
    const config = { ...smallConfig, highCostWarningThreshold: 2 };
    // Record 2 identical browser calls (below normal warningThreshold of 3)
    for (let i = 0; i < 2; i++) {
      await recordWithResult(
        state,
        'browser',
        { action: 'snapshot', tabId: 1 },
        'same',
        `id-${i}`,
        config,
      );
    }
    const result = await detectToolCallLoop(
      state,
      'browser',
      { action: 'snapshot', tabId: 1 },
      config,
    );
    expect(result.severity).toBe('warning');
    expect(result.shouldBlock).toBe(false);
  });

  it('non-high-cost tools use normal warning threshold', async () => {
    const config = { ...smallConfig, highCostWarningThreshold: 2 };
    // Record 2 identical calls for a non-high-cost tool — should NOT warn
    for (let i = 0; i < 2; i++) {
      await recordWithResult(state, 'web_search', { q: 'test' }, 'same', `id-${i}`, config);
    }
    const result = await detectToolCallLoop(state, 'web_search', { q: 'test' }, config);
    expect(result.severity).toBe('none');
  });

  it('large-result stagnation emits warning at threshold', async () => {
    const config = { ...smallConfig, largeResultWarningThreshold: 4, largeResultSizeBytes: 100 };
    // Record 4 calls with large results (different results each time, so no no-progress breaker)
    for (let i = 0; i < 4; i++) {
      await recordToolCall(state, 'browser', { action: 'snapshot', tabId: 1 }, `id-${i}`, config);
      // Manually set resultSize to simulate large results
      state.entries[state.entries.length - 1]!.resultSize = 200;
      state.entries[state.entries.length - 1]!.resultHash = `hash-${i}`;
    }
    const result = await detectToolCallLoop(
      state,
      'browser',
      { action: 'snapshot', tabId: 1 },
      config,
    );
    expect(result.severity).toBe('warning');
    expect(result.shouldBlock).toBe(false);
    expect(result.reason).toContain('large page snapshots');
  });

  it('large-result stagnation triggers circuit breaker at high threshold', async () => {
    const config = {
      ...smallConfig,
      largeResultBreakerThreshold: 6,
      largeResultSizeBytes: 100,
      windowSize: 30,
    };
    for (let i = 0; i < 6; i++) {
      await recordToolCall(state, 'browser', { action: 'snapshot', tabId: 1 }, `id-${i}`, config);
      state.entries[state.entries.length - 1]!.resultSize = 200;
      state.entries[state.entries.length - 1]!.resultHash = `hash-${i}`;
    }
    const result = await detectToolCallLoop(
      state,
      'browser',
      { action: 'snapshot', tabId: 1 },
      config,
    );
    expect(result.severity).toBe('circuit_breaker');
    expect(result.shouldBlock).toBe(true);
    expect(result.reason).toContain('large results');
  });

  it('small results do not trigger large-result stagnation', async () => {
    const config = { ...smallConfig, largeResultWarningThreshold: 4, largeResultSizeBytes: 100 };
    for (let i = 0; i < 6; i++) {
      await recordToolCall(state, 'browser', { action: 'snapshot', tabId: 1 }, `id-${i}`, config);
      state.entries[state.entries.length - 1]!.resultSize = 50; // below threshold
      state.entries[state.entries.length - 1]!.resultHash = `hash-${i}`;
    }
    const result = await detectToolCallLoop(
      state,
      'browser',
      { action: 'snapshot', tabId: 1 },
      config,
    );
    // Should not trigger large-result warning since sizes are small
    expect(result.reason ?? '').not.toContain('large page snapshots');
  });
});

describe('stableJsonSerialize', () => {
  it('sorts object keys', () => {
    const a = stableJsonSerialize({ b: 2, a: 1 });
    const b = stableJsonSerialize({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('handles nested objects', () => {
    const result = stableJsonSerialize({ b: { d: 4, c: 3 }, a: 1 });
    expect(result).toBe('{"a":1,"b":{"c":3,"d":4}}');
  });

  it('handles arrays', () => {
    expect(stableJsonSerialize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles null and undefined', () => {
    expect(stableJsonSerialize(null)).toBe('null');
    expect(stableJsonSerialize(undefined)).toBe('null');
  });

  it('handles primitives', () => {
    expect(stableJsonSerialize('hello')).toBe('"hello"');
    expect(stableJsonSerialize(42)).toBe('42');
    expect(stableJsonSerialize(true)).toBe('true');
  });
});

describe('getNoProgressStreak', () => {
  it('returns 0 for empty entries', () => {
    expect(getNoProgressStreak([], 'tool', 'hash')).toBe(0);
  });

  it('counts consecutive same-result entries from tail', () => {
    const entries: ToolCallRecord[] = [
      { toolName: 'tool', argsHash: 'h1', resultHash: 'r1', timestamp: 1 },
      { toolName: 'tool', argsHash: 'h1', resultHash: 'r2', timestamp: 2 },
      { toolName: 'tool', argsHash: 'h1', resultHash: 'r2', timestamp: 3 },
      { toolName: 'tool', argsHash: 'h1', resultHash: 'r2', timestamp: 4 },
    ];
    expect(getNoProgressStreak(entries, 'tool', 'h1')).toBe(3);
  });

  it('treats undefined resultHash as no-progress', () => {
    const entries: ToolCallRecord[] = [
      { toolName: 'tool', argsHash: 'h1', timestamp: 1 },
      { toolName: 'tool', argsHash: 'h1', timestamp: 2 },
    ];
    expect(getNoProgressStreak(entries, 'tool', 'h1')).toBe(2);
  });

  it('skips interleaved calls from other tools', () => {
    const entries: ToolCallRecord[] = [
      { toolName: 'tool', argsHash: 'h1', resultHash: 'r1', timestamp: 1 },
      { toolName: 'other', argsHash: 'h2', resultHash: 'rx', timestamp: 2 },
      { toolName: 'tool', argsHash: 'h1', resultHash: 'r1', timestamp: 3 },
      { toolName: 'other', argsHash: 'h2', resultHash: 'ry', timestamp: 4 },
      { toolName: 'tool', argsHash: 'h1', resultHash: 'r1', timestamp: 5 },
    ];
    expect(getNoProgressStreak(entries, 'tool', 'h1')).toBe(3);
  });
});

describe('hashResult', () => {
  it('produces consistent hashes', async () => {
    const h1 = await hashResult({ a: 1, b: 2 });
    const h2 = await hashResult({ b: 2, a: 1 });
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different values', async () => {
    const h1 = await hashResult('hello');
    const h2 = await hashResult('world');
    expect(h1).not.toBe(h2);
  });
});
