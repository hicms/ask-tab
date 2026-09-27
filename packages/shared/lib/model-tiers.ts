import { modelTiers } from '@extension/storage';
import type { ModelTier } from '@extension/storage';

interface ModelTierGroup<T> {
  /** `null` holds models the catalog has not rated; they are listed last without a heading. */
  tier: ModelTier | null;
  models: T[];
}

const knownTier = (tier: ModelTier | undefined): ModelTier | null =>
  tier && modelTiers.includes(tier) ? tier : null;

const groupModelsByTier = <T extends { tier?: ModelTier }>(models: T[]): ModelTierGroup<T>[] =>
  [...modelTiers, null]
    .map(tier => ({ tier, models: models.filter(model => knownTier(model.tier) === tier) }))
    .filter(group => group.models.length > 0);

const formatPriceMultiplier = (multiplier: number): string => `${Number(multiplier.toFixed(2))}x`;

export type { ModelTierGroup };
export { formatPriceMultiplier, groupModelsByTier, knownTier };
