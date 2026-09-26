import { getDefaultSuggestedActions, isDefaultActions } from './suggested-actions-storage';
import { describe, expect, it } from 'vitest';

describe('suggested action defaults', () => {
  it.each(['en', 'zh_CN', 'zh_TW', 'ja', 'es', 'de', 'fr', 'nl', 'ru', 'pt'])(
    'recognizes untouched %s defaults after storage serialization',
    locale => {
      const stored = structuredClone(getDefaultSuggestedActions(locale));
      expect(isDefaultActions(stored)).toBe(true);
    },
  );

  it.each(['label', 'prompt'] as const)(
    'preserves a customized %s even when all four default IDs remain',
    field => {
      const stored = structuredClone(getDefaultSuggestedActions('zh_CN'));
      stored[2][field] = '成都今天天气怎么样？';
      expect(isDefaultActions(stored)).toBe(false);
    },
  );

  it('preserves reordered defaults', () => {
    const stored = [...getDefaultSuggestedActions('en')].reverse();
    expect(isDefaultActions(stored)).toBe(false);
  });

  it('preserves an empty or shortened action list', () => {
    expect(isDefaultActions([])).toBe(false);
    expect(isDefaultActions(getDefaultSuggestedActions('en').slice(1))).toBe(false);
  });

  it('preserves added actions', () => {
    expect(
      isDefaultActions([
        ...getDefaultSuggestedActions('en'),
        { id: 'custom', label: 'Translate', prompt: 'Translate this page' },
      ]),
    ).toBe(false);
  });

  it('does not recognize duplicate default IDs as an untouched list', () => {
    const stored = getDefaultSuggestedActions('en');
    expect(isDefaultActions([stored[0], stored[0], stored[2], stored[3]])).toBe(false);
  });
});
