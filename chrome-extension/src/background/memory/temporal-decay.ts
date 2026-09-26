/**
 * Temporal decay for memory search results.
 *
 * Newer memories score higher. Dated files (memory/YYYY-MM-DD.md, transcript/YYYY-MM-DD/*)
 * decay exponentially; evergreen files (MEMORY.md, undated memory/* files) don't decay.
 *
 * Decay formula: score * exp(-ln(2) / halfLifeDays * ageDays)
 */

interface TemporalDecayConfig {
  enabled: boolean;
  /** Half-life in days — after this many days, score is halved. Default 30 */
  halfLifeDays: number;
}

const DEFAULT_TEMPORAL_DECAY_CONFIG: TemporalDecayConfig = {
  enabled: true,
  halfLifeDays: 30,
};

/** Date pattern: memory/YYYY-MM-DD.md or transcript/YYYY-MM-DD/* */
const DATE_PATTERN = /(?:memory|transcript)\/(\d{4}-\d{2}-\d{2})/;

/**
 * Extract a date from a file path that follows naming conventions:
 * - memory/2025-01-15.md → Date(2025-01-15)
 * - transcript/2025-01-15/chat-title.md → Date(2025-01-15)
 */
const extractDateFromPath = (filePath: string): Date | null => {
  const match = filePath.match(DATE_PATTERN);
  if (!match) return null;

  const date = new Date(match[1]! + 'T00:00:00Z');
  // Validate the parsed date is real
  if (isNaN(date.getTime())) return null;
  return date;
};

/**
 * Determine if a file path is "evergreen" — should not decay.
 * MEMORY.md and non-dated memory/* files are evergreen.
 */
const isEvergreenPath = (filePath: string): boolean => {
  // MEMORY.md at root level
  if (filePath === 'MEMORY.md') return true;

  // memory/* files that don't have a date in their name
  if (filePath.startsWith('memory/') && !DATE_PATTERN.test(filePath)) return true;

  return false;
};

/**
 * Compute the decay factor for a given age in days.
 * Returns a value in (0, 1] where 1.0 means no decay.
 */
const computeDecayFactor = (ageDays: number, halfLifeDays: number): number => {
  if (ageDays <= 0) return 1.0;
  if (halfLifeDays <= 0) return 1.0;
  return Math.exp((-Math.LN2 / halfLifeDays) * ageDays);
};

/**
 * Apply temporal decay to search results.
 *
 * @param results - Search results with score and path
 * @param config - Decay configuration
 * @param fileUpdatedAtMap - Optional map from filePath to updatedAt timestamp (ms).
 *   Used as fallback when date can't be extracted from path.
 */
const applyTemporalDecay = <T extends { score: number; path: string }>(
  results: T[],
  config: TemporalDecayConfig = DEFAULT_TEMPORAL_DECAY_CONFIG,
  fileUpdatedAtMap?: Map<string, number>,
): T[] => {
  if (!config.enabled || results.length === 0) return results;

  const now = Date.now();

  return results.map(result => {
    // Evergreen files don't decay
    if (isEvergreenPath(result.path)) return result;

    // Try extracting date from path first
    let fileDate = extractDateFromPath(result.path);

    // Fallback to fileUpdatedAt map
    if (!fileDate && fileUpdatedAtMap) {
      const updatedAt = fileUpdatedAtMap.get(result.path);
      if (updatedAt) {
        fileDate = new Date(updatedAt);
      }
    }

    // If we still can't determine age, don't decay
    if (!fileDate) return result;

    const ageDays = (now - fileDate.getTime()) / (1000 * 60 * 60 * 24);
    const factor = computeDecayFactor(ageDays, config.halfLifeDays);

    return { ...result, score: result.score * factor };
  });
};

export {
  applyTemporalDecay,
  extractDateFromPath,
  isEvergreenPath,
  computeDecayFactor,
  DEFAULT_TEMPORAL_DECAY_CONFIG,
};
export type { TemporalDecayConfig };
