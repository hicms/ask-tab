import {
  formatReasoningValue,
  isSelectableReasoningControl,
  resolveReasoningSettings,
  sameReasoningValue,
} from './reasoning-controls';
import { describe, expect, it } from 'vitest';
import type { ReasoningControl } from '@extension/storage';

const sonnet: ReasoningControl[] = [
  { path: 'thinking.type', values: ['adaptive', 'between_tools'], default: 'adaptive' },
  { path: 'output_config.effort', values: ['low', 'medium', 'high'], default: 'high' },
];

describe('resolveReasoningSettings', () => {
  it('sends every published default when nothing was chosen', () => {
    expect(resolveReasoningSettings(sonnet)).toEqual([
      { path: 'thinking.type', value: 'adaptive' },
      { path: 'output_config.effort', value: 'high' },
    ]);
  });

  it('uses a choice the catalog still offers and drops one it withdrew', () => {
    expect(
      resolveReasoningSettings(sonnet, {
        'thinking.type': 'enabled',
        'output_config.effort': 'low',
      }),
    ).toEqual([
      { path: 'thinking.type', value: 'adaptive' },
      { path: 'output_config.effort', value: 'low' },
    ]);
  });

  it('matches object values by content', () => {
    const kimi: ReasoningControl = {
      path: 'thinking',
      values: [{ keep: 'all', type: 'enabled' }],
      default: { keep: 'all', type: 'enabled' },
    };
    expect(
      resolveReasoningSettings([kimi], { thinking: { type: 'enabled', keep: 'all' } }),
    ).toEqual([{ path: 'thinking', value: { type: 'enabled', keep: 'all' } }]);
  });

  it('ignores inherited keys on the stored choices', () => {
    const chosen = Object.create({ 'output_config.effort': 'low' }) as Record<string, string>;
    expect(resolveReasoningSettings(sonnet, chosen)[1]).toEqual({
      path: 'output_config.effort',
      value: 'high',
    });
  });
});

describe('sameReasoningValue', () => {
  it('compares booleans, arrays, and objects structurally', () => {
    expect(sameReasoningValue(false, false)).toBe(true);
    expect(sameReasoningValue(false, 'false')).toBe(false);
    expect(sameReasoningValue([1, 2], [1, 2])).toBe(true);
    expect(sameReasoningValue([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(sameReasoningValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe('isSelectableReasoningControl', () => {
  it('hides a control that has only one value', () => {
    expect(isSelectableReasoningControl({ path: 'x', values: ['on'], default: 'on' })).toBe(false);
    expect(isSelectableReasoningControl(sonnet[0])).toBe(true);
  });
});

describe('formatReasoningValue', () => {
  it('shows strings as-is and other values as JSON', () => {
    expect(formatReasoningValue('high')).toBe('high');
    expect(formatReasoningValue(true)).toBe('true');
    expect(formatReasoningValue({ keep: 'all' })).toBe('{"keep":"all"}');
  });
});
