import { DEFAULT_COMPACTION_CONFIG, mergeCompactionConfig } from './compaction-config';
import { describe, it, expect } from 'vitest';

describe('CompactionConfig defaults', () => {
  it('DEFAULT_COMPACTION_CONFIG has expected values', () => {
    expect(DEFAULT_COMPACTION_CONFIG.maxHistoryShare).toBe(0.5);
    expect(DEFAULT_COMPACTION_CONFIG.recentTurnsPreserve).toBe(3);
    expect(DEFAULT_COMPACTION_CONFIG.tokenSafetyMargin).toBe(1.25);
    expect(DEFAULT_COMPACTION_CONFIG.toolResultContextShare).toBe(0.3);
    expect(DEFAULT_COMPACTION_CONFIG.qualityGuardEnabled).toBe(true);
    expect(DEFAULT_COMPACTION_CONFIG.qualityGuardMaxRetries).toBe(2);
    expect(DEFAULT_COMPACTION_CONFIG.identifierPolicy).toBe('lenient');
  });

  it('merges partial config with defaults', () => {
    const partial = { maxHistoryShare: 0.3 };
    const config = mergeCompactionConfig(partial);
    expect(config.maxHistoryShare).toBe(0.3);
    expect(config.recentTurnsPreserve).toBe(3); // default
    expect(config.tokenSafetyMargin).toBe(1.25); // default
    expect(config.qualityGuardEnabled).toBe(true); // default
  });

  it('returns defaults when no partial provided', () => {
    const config = mergeCompactionConfig();
    expect(config).toEqual(DEFAULT_COMPACTION_CONFIG);
  });

  it('returns defaults when undefined provided', () => {
    const config = mergeCompactionConfig(undefined);
    expect(config).toEqual(DEFAULT_COMPACTION_CONFIG);
  });
});
