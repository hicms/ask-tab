/**
 * Tool loop detection — detects and breaks infinite tool-call loops.
 *
 * Detection strategies (progress-aware, result-based):
 * 1. Global no-progress breaker: consecutive no-progress calls (any tool) → block
 * 2. Known poll tool no-progress: poll tools blocked at lower threshold
 * 3. Generic repeat breaker: same tool+args repeated AND no progress → block
 * 4. Ping-pong: alternating A-B-A-B pattern + no-progress evidence → block
 * 5. Generic repeat warning/critical: same-args repeat → warn (never blocks alone)
 *
 * Key principle: diverse tool calls with changing results are never blocked.
 */

interface ToolLoopConfig {
  enabled: boolean;
  /** Number of identical calls before warning. Default 5 */
  warningThreshold: number;
  /** Number of identical calls before critical. Default 10 */
  criticalThreshold: number;
  /** Number of same-args repeats before circuit breaker (requires no-progress). Default 15 */
  breakerThreshold: number;
  /** Ping-pong pattern length to detect. Default 6 */
  pingPongThreshold: number;
  /** Min no-progress entries for ping-pong to block. Default 4 */
  pingPongNoProgressMin: number;
  /** Consecutive no-progress calls (any tool) to block. Default 15 */
  globalNoProgressBreaker: number;
  /** Tools with lower blocking threshold (e.g. polling). Default [] */
  knownPollTools: string[];
  /** Poll tool no-progress block threshold. Default 10 */
  pollNoProgressThreshold: number;
  /** Sliding window size. Default 60 */
  windowSize: number;
  /** Emit warning every N calls per bucket. Default 5 */
  warningThrottleInterval: number;
  /** High-cost tools that get stricter thresholds for warnings. Default ['browser', 'debugger'] */
  highCostTools: string[];
  /** Warning threshold for high-cost tools. Default 3 */
  highCostWarningThreshold: number;
  /** Number of large-result calls (>50KB) before warning. Default 8 */
  largeResultWarningThreshold: number;
  /** Number of large-result calls (>50KB) before circuit breaker. Default 15 */
  largeResultBreakerThreshold: number;
  /** Byte threshold to consider a result "large". Default 50000 */
  largeResultSizeBytes: number;
}

const DEFAULT_TOOL_LOOP_CONFIG: ToolLoopConfig = {
  enabled: true,
  warningThreshold: 5,
  criticalThreshold: 10,
  breakerThreshold: 15,
  pingPongThreshold: 6,
  pingPongNoProgressMin: 4,
  globalNoProgressBreaker: 15,
  knownPollTools: [],
  pollNoProgressThreshold: 10,
  windowSize: 60,
  warningThrottleInterval: 5,
  highCostTools: ['browser', 'debugger'],
  highCostWarningThreshold: 3,
  largeResultWarningThreshold: 8,
  largeResultBreakerThreshold: 15,
  largeResultSizeBytes: 50000,
};

type LoopSeverity = 'none' | 'warning' | 'critical' | 'circuit_breaker';

interface LoopDetectionResult {
  severity: LoopSeverity;
  shouldBlock: boolean;
  reason?: string;
}

interface ToolCallRecord {
  toolName: string;
  argsHash: string;
  toolCallId?: string;
  resultHash?: string;
  resultSize?: number;
  timestamp: number;
}

interface ToolLoopState {
  entries: ToolCallRecord[];
  warningBuckets: Map<string, number>;
}

const createToolLoopState = (): ToolLoopState => ({
  entries: [],
  warningBuckets: new Map(),
});

/**
 * Produce a stable JSON string for hashing.
 * Sorts object keys recursively for deterministic output.
 */
const stableJsonSerialize = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableJsonSerialize).join(',') + ']';
  }
  const sorted = Object.keys(value as Record<string, unknown>).sort();
  const parts = sorted.map(
    k => JSON.stringify(k) + ':' + stableJsonSerialize((value as Record<string, unknown>)[k]),
  );
  return '{' + parts.join(',') + '}';
};

/**
 * Hash a string via SHA-256 (Web Crypto API).
 */
const sha256 = async (input: string): Promise<string> => {
  const encoded = new TextEncoder().encode(input);
  const buffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Hash a tool call's arguments for identity comparison.
 */
const hashToolCall = async (toolName: string, params: unknown): Promise<string> => {
  const input = `${toolName}:${stableJsonSerialize(params)}`;
  return sha256(input);
};

/** Max bytes of serialized result to hash (performance guard). */
const RESULT_HASH_MAX_BYTES = 8192;

/**
 * Hash a tool result for progress comparison.
 * Truncates serialized result to RESULT_HASH_MAX_BYTES before hashing.
 */
const hashResult = async (result: unknown): Promise<string> => {
  let serialized = stableJsonSerialize(result);
  if (serialized.length > RESULT_HASH_MAX_BYTES) {
    serialized = serialized.slice(0, RESULT_HASH_MAX_BYTES);
  }
  return sha256(serialized);
};

/**
 * Count no-progress calls for a specific tool+args combo,
 * scanning backwards from the tail of entries.
 * Skips entries for other tools (they may be interleaved).
 *
 * "No progress" means same resultHash across matching entries (or undefined resultHash).
 * Breaks when a matching entry has a different resultHash (i.e., progress).
 */
const getNoProgressStreak = (
  entries: ToolCallRecord[],
  toolName: string,
  argsHash: string,
): number => {
  let streak = 0;
  let referenceResultHash: string | undefined;

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.toolName !== toolName || entry.argsHash !== argsHash) continue;

    if (streak === 0) {
      // First matching entry sets the reference
      referenceResultHash = entry.resultHash;
      streak = 1;
    } else if (entry.resultHash === undefined || entry.resultHash === referenceResultHash) {
      // Undefined resultHash counts conservatively as no-progress
      streak++;
    } else {
      // Different resultHash → progress detected
      break;
    }
  }

  return streak;
};

/**
 * Count consecutive no-progress calls across ALL tools (global streak).
 * Walks backwards from tail. A call is "no-progress" if it repeats a
 * tool+args+result we've already seen (from the tail). First-time tool+args
 * keys are NOT counted — they represent exploration, not stagnation.
 * Breaks on any progress (same tool+args with different resultHash).
 */
const getGlobalNoProgressStreak = (entries: ToolCallRecord[]): number => {
  let noProgressCount = 0;
  const seen = new Map<string, string | undefined>(); // key → resultHash

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    const key = `${entry.toolName}:${entry.argsHash}`;

    if (!seen.has(key)) {
      // First time seeing this key — exploration, not no-progress
      seen.set(key, entry.resultHash);
    } else {
      const prevResult = seen.get(key);
      if (entry.resultHash === undefined || entry.resultHash === prevResult) {
        // Same result or unknown → no progress
        noProgressCount++;
      } else {
        // Different result → progress
        break;
      }
    }
  }

  return noProgressCount;
};

/**
 * Detect ping-pong alternation and check if it shows progress.
 */
const getPingPongNoProgress = (
  entries: ToolCallRecord[],
  threshold: number,
): { detected: boolean; noProgress: boolean; toolA?: string; toolB?: string } => {
  if (entries.length < threshold) return { detected: false, noProgress: false };

  const recent = entries.slice(-threshold);
  const isAlternating = recent.every((entry, i) => {
    const ref = recent[i % 2]!;
    return entry.toolName === ref.toolName && entry.argsHash === ref.argsHash;
  });
  const hasTwoDistinct =
    recent[0]!.toolName !== recent[1]!.toolName || recent[0]!.argsHash !== recent[1]!.argsHash;

  if (!isAlternating || !hasTwoDistinct) return { detected: false, noProgress: false };

  // Check progress on both sides
  const sideA = recent.filter((_, i) => i % 2 === 0);
  const sideB = recent.filter((_, i) => i % 2 === 1);

  const sideAStable =
    sideA.every(e => e.resultHash === undefined) ||
    sideA.every(e => e.resultHash === sideA[0]!.resultHash);
  const sideBStable =
    sideB.every(e => e.resultHash === undefined) ||
    sideB.every(e => e.resultHash === sideB[0]!.resultHash);

  return {
    detected: true,
    noProgress: sideAStable && sideBStable,
    toolA: recent[0]!.toolName,
    toolB: recent[1]!.toolName,
  };
};

/** Max warning bucket keys to track (FIFO eviction). */
const MAX_WARNING_BUCKETS = 256;

/**
 * Check if a warning should be emitted (bucket-based throttling).
 * Emits on first occurrence, then every `interval` calls for the bucket.
 */
const shouldEmitWarning = (state: ToolLoopState, bucketKey: string, interval: number): boolean => {
  const count = (state.warningBuckets.get(bucketKey) ?? 0) + 1;

  // FIFO eviction if at capacity and this is a new key
  if (!state.warningBuckets.has(bucketKey) && state.warningBuckets.size >= MAX_WARNING_BUCKETS) {
    const firstKey = state.warningBuckets.keys().next().value as string;
    state.warningBuckets.delete(firstKey);
  }

  state.warningBuckets.set(bucketKey, count);
  return count === 1 || count % interval === 0;
};

/**
 * Record a tool call BEFORE execution.
 * Sets toolName, argsHash, toolCallId, timestamp. resultHash added later via recordToolCallOutcome().
 */
const recordToolCall = async (
  state: ToolLoopState,
  toolName: string,
  params: unknown,
  toolCallId?: string,
  config: ToolLoopConfig = DEFAULT_TOOL_LOOP_CONFIG,
): Promise<void> => {
  const argsHash = await hashToolCall(toolName, params);
  state.entries.push({
    toolName,
    argsHash,
    toolCallId,
    timestamp: Date.now(),
  });

  // Trim to window size
  if (state.entries.length > config.windowSize) {
    state.entries = state.entries.slice(-config.windowSize);
  }
};

/**
 * Record the outcome of a tool call AFTER execution.
 * Finds the entry by toolCallId and sets resultHash.
 */
const recordToolCallOutcome = async (
  state: ToolLoopState,
  toolCallId: string,
  result: unknown,
): Promise<void> => {
  // Search from tail (most recent) for the matching entry
  for (let i = state.entries.length - 1; i >= 0; i--) {
    if (state.entries[i]!.toolCallId === toolCallId) {
      state.entries[i]!.resultHash = await hashResult(result);
      // Track result size for large-result stagnation detection
      const serialized = stableJsonSerialize(result);
      state.entries[i]!.resultSize = serialized.length;
      return;
    }
  }
};

/**
 * Detect if tool calls indicate a loop. Called AFTER recordToolCall() but BEFORE execution.
 *
 * Detection order (first blocking match wins):
 * 1. Global no-progress breaker
 * 2. Known poll no-progress
 * 3. Generic repeat breaker (same-args + no-progress)
 * 4. Ping-pong (alternation + no-progress evidence)
 * 5. Generic repeat warning/critical (never blocks alone)
 */
const detectToolCallLoop = async (
  state: ToolLoopState,
  toolName: string,
  params: unknown,
  config: ToolLoopConfig = DEFAULT_TOOL_LOOP_CONFIG,
): Promise<LoopDetectionResult> => {
  if (!config.enabled) return { severity: 'none', shouldBlock: false };

  const window = state.entries.slice(-config.windowSize);

  // Reuse argsHash from the most recent recorded entry if it matches,
  // otherwise compute (e.g. when called without prior recordToolCall)
  const lastEntry = window.at(-1);
  const argsHash =
    lastEntry?.toolName === toolName ? lastEntry.argsHash : await hashToolCall(toolName, params);

  // 1. Global no-progress breaker
  const globalStreak = getGlobalNoProgressStreak(window);
  if (globalStreak >= config.globalNoProgressBreaker) {
    return {
      severity: 'circuit_breaker',
      shouldBlock: true,
      reason: `Global no-progress breaker: ${globalStreak} consecutive calls with no progress`,
    };
  }

  // Count same-args occurrences in window
  const sameArgsCount = window.filter(
    e => e.toolName === toolName && e.argsHash === argsHash,
  ).length;
  const noProgressStreak = getNoProgressStreak(window, toolName, argsHash);

  // 2. Known poll tool no-progress
  if (
    config.knownPollTools.includes(toolName) &&
    noProgressStreak >= config.pollNoProgressThreshold
  ) {
    return {
      severity: 'circuit_breaker',
      shouldBlock: true,
      reason: `Poll tool ${toolName}: ${noProgressStreak} calls with no progress (threshold: ${config.pollNoProgressThreshold})`,
    };
  }

  // 3. Generic repeat breaker — only blocks when no-progress streak hits threshold
  if (sameArgsCount >= config.breakerThreshold && noProgressStreak >= config.breakerThreshold) {
    return {
      severity: 'circuit_breaker',
      shouldBlock: true,
      reason: `Tool ${toolName} called ${sameArgsCount} times with same arguments and no progress — circuit breaker triggered`,
    };
  }

  // 4. Ping-pong detection
  const pingPong = getPingPongNoProgress(window, config.pingPongThreshold);
  if (pingPong.detected) {
    if (pingPong.noProgress && config.pingPongThreshold >= config.pingPongNoProgressMin) {
      return {
        severity: 'circuit_breaker',
        shouldBlock: true,
        reason: `Ping-pong loop with no progress: ${pingPong.toolA} ↔ ${pingPong.toolB}`,
      };
    }
    const bucketKey = `pingpong:${[pingPong.toolA, pingPong.toolB].sort().join(':')}`;
    if (shouldEmitWarning(state, bucketKey, config.warningThrottleInterval)) {
      return {
        severity: 'warning',
        shouldBlock: false,
        reason: `Ping-pong pattern detected: ${pingPong.toolA} ↔ ${pingPong.toolB}`,
      };
    }
    return { severity: 'none', shouldBlock: false };
  }

  // 5. Large-result stagnation detection (catches "different results but no progress" loops)
  if (config.largeResultSizeBytes > 0) {
    const recentToolCalls = window.filter(e => e.toolName === toolName);
    const recentLargeResults = recentToolCalls.filter(
      e => e.resultSize != null && e.resultSize >= config.largeResultSizeBytes,
    );

    if (recentLargeResults.length >= config.largeResultBreakerThreshold) {
      return {
        severity: 'circuit_breaker',
        shouldBlock: true,
        reason: `Tool ${toolName}: ${recentLargeResults.length} calls returned large results (>${Math.round(config.largeResultSizeBytes / 1000)}KB each) without synthesizing data — circuit breaker triggered`,
      };
    }

    if (recentLargeResults.length >= config.largeResultWarningThreshold) {
      const bucketKey = `large-result:${toolName}`;
      if (shouldEmitWarning(state, bucketKey, config.warningThrottleInterval)) {
        return {
          severity: 'warning',
          shouldBlock: false,
          reason: `Warning: You've captured ${recentLargeResults.length}+ large page snapshots without synthesizing the data. Consider stopping to analyze what you have before making more ${toolName} calls.`,
        };
      }
    }
  }

  // 6. High-cost tool early warning
  const effectiveWarningThreshold = config.highCostTools.includes(toolName)
    ? config.highCostWarningThreshold
    : config.warningThreshold;

  // 7. Generic repeat warning/critical (never blocks)
  if (sameArgsCount >= config.criticalThreshold) {
    const bucketKey = `generic:${toolName}:${argsHash}`;
    if (shouldEmitWarning(state, bucketKey, config.warningThrottleInterval)) {
      return {
        severity: 'critical',
        shouldBlock: false,
        reason: `Tool ${toolName} called with same arguments ${sameArgsCount} times — critical warning`,
      };
    }
    return { severity: 'none', shouldBlock: false };
  }

  if (sameArgsCount >= effectiveWarningThreshold) {
    const bucketKey = `generic:${toolName}:${argsHash}`;
    if (shouldEmitWarning(state, bucketKey, config.warningThrottleInterval)) {
      return {
        severity: 'warning',
        shouldBlock: false,
        reason: `Tool ${toolName} called with same arguments ${sameArgsCount} times — warning`,
      };
    }
    return { severity: 'none', shouldBlock: false };
  }

  return { severity: 'none', shouldBlock: false };
};

export {
  detectToolCallLoop,
  recordToolCall,
  recordToolCallOutcome,
  createToolLoopState,
  stableJsonSerialize,
  hashToolCall,
  hashResult,
  getNoProgressStreak,
  getGlobalNoProgressStreak,
  getPingPongNoProgress,
  shouldEmitWarning,
  DEFAULT_TOOL_LOOP_CONFIG,
};
export type { ToolLoopConfig, ToolLoopState, ToolCallRecord, LoopDetectionResult, LoopSeverity };
