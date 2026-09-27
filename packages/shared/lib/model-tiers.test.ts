import { formatPriceMultiplier, groupModelsByTier } from './model-tiers';
import { describe, expect, it } from 'vitest';
import type { ModelTier } from '@extension/storage';

const model = (id: string, tier?: ModelTier) => ({ id, tier });

describe('groupModelsByTier', () => {
  it('orders groups by tier and keeps the catalog order inside each group', () => {
    const groups = groupModelsByTier([
      model('fast-1', 'fast'),
      model('flag-1', 'flagship'),
      model('plain'),
      model('bal-1', 'balanced'),
      model('flag-2', 'flagship'),
    ]);
    expect(groups).toEqual([
      { tier: 'flagship', models: [model('flag-1', 'flagship'), model('flag-2', 'flagship')] },
      { tier: 'balanced', models: [model('bal-1', 'balanced')] },
      { tier: 'fast', models: [model('fast-1', 'fast')] },
      { tier: null, models: [model('plain')] },
    ]);
  });

  it('lists a model with an unknown stored tier as unrated instead of hiding it', () => {
    const odd = { id: 'odd', tier: 'ultra' as ModelTier };
    expect(groupModelsByTier([odd])).toEqual([{ tier: null, models: [odd] }]);
  });

  it('leaves out tiers without models', () => {
    expect(groupModelsByTier([model('a', 'fast')])).toEqual([
      { tier: 'fast', models: [model('a', 'fast')] },
    ]);
  });

  it('keeps a catalog cached before tiers existed as one untitled group', () => {
    expect(groupModelsByTier([model('a'), model('b')])).toEqual([
      { tier: null, models: [model('a'), model('b')] },
    ]);
    expect(groupModelsByTier([])).toEqual([]);
  });
});

describe('formatPriceMultiplier', () => {
  it('shows at most two decimals without trailing zeros', () => {
    expect(formatPriceMultiplier(1)).toBe('1x');
    expect(formatPriceMultiplier(2.5)).toBe('2.5x');
    expect(formatPriceMultiplier(0.35)).toBe('0.35x');
    expect(formatPriceMultiplier(0.05)).toBe('0.05x');
    expect(formatPriceMultiplier(0.1 + 0.2)).toBe('0.3x');
  });
});
