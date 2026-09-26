/**
 * Tests for the chrome-extension context-limits re-export shim.
 * The actual logic lives in @extension/shared — these tests verify
 * that the re-export file is exercised (bringing coverage from 0%).
 */
import {
  getEffectiveContextLimit,
  getModelContextLimit,
  MODEL_CONTEXT_LIMITS,
  DEFAULT_CONTEXT_LIMIT,
  CONTEXT_RATIO,
} from './limits';
import { describe, it, expect } from 'vitest';

describe('context-limits (re-export shim)', () => {
  it('re-exports MODEL_CONTEXT_LIMITS as a non-empty record', () => {
    expect(typeof MODEL_CONTEXT_LIMITS).toBe('object');
    expect(Object.keys(MODEL_CONTEXT_LIMITS).length).toBeGreaterThan(0);
  });

  it('re-exports DEFAULT_CONTEXT_LIMIT as 128_000', () => {
    expect(DEFAULT_CONTEXT_LIMIT).toBe(128_000);
  });

  it('re-exports CONTEXT_RATIO as 0.75', () => {
    expect(CONTEXT_RATIO).toBe(0.75);
  });

  it('getEffectiveContextLimit returns floor(limit * 0.75) for known model', () => {
    // gpt-4o has 128_000 → effective = 96_000
    expect(getEffectiveContextLimit('gpt-4o')).toBe(96_000);
  });

  it('getEffectiveContextLimit uses default for unknown model', () => {
    expect(getEffectiveContextLimit('unknown-model-xyz')).toBe(
      Math.floor(DEFAULT_CONTEXT_LIMIT * CONTEXT_RATIO),
    );
  });

  it('getModelContextLimit returns raw limit for known model', () => {
    expect(getModelContextLimit('gpt-4o')).toBe(128_000);
  });

  it('getModelContextLimit returns default for unknown model', () => {
    expect(getModelContextLimit('unknown-model-xyz')).toBe(DEFAULT_CONTEXT_LIMIT);
  });

  it('Anthropic models have 200k context', () => {
    expect(getModelContextLimit('claude-opus-4-6')).toBe(200_000);
    expect(getModelContextLimit('claude-sonnet-4-5')).toBe(200_000);
  });

  it('Gemini models have 1M+ context', () => {
    expect(getModelContextLimit('gemini-2.0-flash')).toBe(1_000_000);
    expect(getModelContextLimit('gemini-1.5-pro')).toBe(2_000_000);
  });

  // ── contextWindowOverride ──

  it('getModelContextLimit returns override when positive', () => {
    expect(getModelContextLimit('gpt-4o', 64_000)).toBe(64_000);
  });

  it('getModelContextLimit ignores override when zero', () => {
    expect(getModelContextLimit('gpt-4o', 0)).toBe(128_000);
  });

  it('getModelContextLimit ignores override when undefined', () => {
    expect(getModelContextLimit('gpt-4o', undefined)).toBe(128_000);
  });

  it('getEffectiveContextLimit uses override when positive', () => {
    expect(getEffectiveContextLimit('gpt-4o', 64_000)).toBe(Math.floor(64_000 * CONTEXT_RATIO));
  });

  it('getEffectiveContextLimit ignores override when zero', () => {
    expect(getEffectiveContextLimit('gpt-4o', 0)).toBe(Math.floor(128_000 * CONTEXT_RATIO));
  });

  it('getEffectiveContextLimit ignores override when undefined', () => {
    expect(getEffectiveContextLimit('gpt-4o', undefined)).toBe(Math.floor(128_000 * CONTEXT_RATIO));
  });
});
