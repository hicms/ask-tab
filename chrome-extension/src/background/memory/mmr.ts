/**
 * Maximal Marginal Relevance (MMR) re-ranking.
 *
 * Prevents redundant search results by penalizing chunks that are
 * similar to already-selected ones.
 *
 * MMR formula: λ * relevance - (1-λ) * max_jaccard_similarity_to_selected
 */

interface MMRConfig {
  enabled: boolean;
  /** Trade-off between relevance (1.0) and diversity (0.0). Default 0.7 */
  lambda: number;
}

const DEFAULT_MMR_CONFIG: MMRConfig = { enabled: true, lambda: 0.7 };

/** Tokenize text into lowercase alphanumeric tokens for Jaccard similarity */
const tokenizeForJaccard = (text: string): Set<string> => {
  const matches = text.toLowerCase().match(/[a-z0-9_]+/g);
  return new Set(matches ?? []);
};

/** Jaccard similarity between two token sets: |A ∩ B| / |A ∪ B| */
const jaccardSimilarity = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  for (const token of smaller) {
    if (larger.has(token)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
};

/**
 * Re-rank items using MMR. Iterative greedy selection.
 *
 * Expects items to have `score` (relevance, already in [0,1]) and `text` (for Jaccard).
 * Returns a new array with at most `items.length` entries, re-ordered by MMR score.
 */
const mmrRerank = <T extends { score: number; text: string }>(
  items: T[],
  config: MMRConfig = DEFAULT_MMR_CONFIG,
): T[] => {
  if (!config.enabled || items.length <= 1) return items;

  const { lambda } = config;

  // Normalize relevance scores to [0,1]
  const maxScore = items.reduce((max, item) => Math.max(max, item.score), 0);
  const normalizedScores = items.map(item => (maxScore > 0 ? item.score / maxScore : 0));

  // Pre-tokenize all items
  const tokenSets = items.map(item => tokenizeForJaccard(item.text));

  const selected: number[] = [];
  const remaining = new Set(items.map((_, i) => i));
  const result: T[] = [];

  while (remaining.size > 0) {
    let bestIdx = -1;
    let bestMmrScore = -Infinity;

    for (const idx of remaining) {
      const relevance = normalizedScores[idx]!;

      // Max similarity to any already-selected item
      let maxSim = 0;
      for (const selIdx of selected) {
        const sim = jaccardSimilarity(tokenSets[idx]!, tokenSets[selIdx]!);
        if (sim > maxSim) maxSim = sim;
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;

      if (mmrScore > bestMmrScore) {
        bestMmrScore = mmrScore;
        bestIdx = idx;
      }
    }

    if (bestIdx < 0) break;

    selected.push(bestIdx);
    remaining.delete(bestIdx);
    result.push(items[bestIdx]!);
  }

  return result;
};

export { mmrRerank, jaccardSimilarity, tokenizeForJaccard };
export type { MMRConfig };
export { DEFAULT_MMR_CONFIG };
