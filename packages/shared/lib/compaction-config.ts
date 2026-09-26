/**
 * Configurable compaction settings — per-agent overrides for context compaction behavior.
 */

interface CompactionConfig {
  /** Share of context budget for historical (non-recent) messages. Range: 0.1-0.9. */
  maxHistoryShare: number;
  /** Number of recent turns to preserve verbatim across compaction. Range: 1-12. */
  recentTurnsPreserve: number;
  /** Safety margin multiplier for token estimates. Range: 1.1-2.0. */
  tokenSafetyMargin: number;
  /** Share of context window per single tool result. Range: 0.1-0.5. */
  toolResultContextShare: number;
  /** Whether the quality guard (audit) is enabled for summaries. */
  qualityGuardEnabled: boolean;
  /** Max retries on quality audit failure. Range: 1-3. */
  qualityGuardMaxRetries: number;
  /** Identifier overlap policy: 'strict' (50%), 'lenient' (20%), 'off' (skip). */
  identifierPolicy: 'strict' | 'lenient' | 'off';
}

const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  maxHistoryShare: 0.5,
  recentTurnsPreserve: 3,
  tokenSafetyMargin: 1.25,
  toolResultContextShare: 0.3,
  qualityGuardEnabled: true,
  qualityGuardMaxRetries: 2,
  identifierPolicy: 'lenient',
};

/**
 * Merge a partial config with defaults, filling in any missing fields.
 */
const mergeCompactionConfig = (partial?: Partial<CompactionConfig>): CompactionConfig => ({
  ...DEFAULT_COMPACTION_CONFIG,
  ...partial,
});

export { DEFAULT_COMPACTION_CONFIG, mergeCompactionConfig };
export type { CompactionConfig };
