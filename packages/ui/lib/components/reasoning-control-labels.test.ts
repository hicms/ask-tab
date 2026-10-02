import {
  primaryReasoningControl,
  reasoningControlLabel,
  reasoningValueLabel,
} from './reasoning-control-labels';
import en from '../../../i18n/locales/en/messages.json';
import zh from '../../../i18n/locales/zh_CN/messages.json';
import { describe, expect, it } from 'vitest';
import type { MessageKeyType } from '@extension/i18n';
import type { ReasoningControl } from '@extension/storage';

const translator =
  (messages: Record<string, { message: string }>) =>
  (key: MessageKeyType): string =>
    messages[key]?.message ?? `missing:${key}`;
const tEn = translator(en);
const tZh = translator(zh);

const control = (path: string, values: ReasoningControl['values']): ReasoningControl => ({
  path,
  values,
  default: values[0],
});

describe('reasoning control labels', () => {
  it('names provider-specific effort paths the same way', () => {
    for (const path of [
      'reasoning_effort',
      'output_config.effort',
      'generationConfig.thinkingConfig.thinkingLevel',
    ]) {
      expect(reasoningControlLabel(tZh, control(path, ['low', 'high']))).toBe('思考强度');
      expect(reasoningControlLabel(tEn, control(path, ['low', 'high']))).toBe('Thinking effort');
    }
  });

  it('translates every value the live catalog publishes', () => {
    const effort = control('reasoning_effort', [
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(effort.values.map(value => reasoningValueLabel(tZh, effort, value))).toEqual([
      '无',
      '最低',
      '低',
      '中',
      '高',
      '超高',
      '最高',
    ]);
    const mode = control('thinking.type', ['adaptive', 'enabled', 'disabled', 'between_tools']);
    expect(reasoningControlLabel(tZh, mode)).toBe('思考模式');
    expect(mode.values.map(value => reasoningValueLabel(tZh, mode, value))).toEqual([
      '自适应',
      '开启',
      '关闭',
      '工具调用间思考',
    ]);
    const display = control('thinking.display', ['omitted', 'summarized']);
    expect(reasoningControlLabel(tZh, display)).toBe('显示思考过程');
    expect(display.values.map(value => reasoningValueLabel(tZh, display, value))).toEqual([
      '隐藏',
      '摘要',
    ]);
  });

  it('reads booleans as shown/hidden for display flags and on/off otherwise', () => {
    const include = control('generationConfig.thinkingConfig.includeThoughts', [false, true]);
    expect(reasoningControlLabel(tZh, include)).toBe('显示思考过程');
    expect(include.values.map(value => reasoningValueLabel(tZh, include, value))).toEqual([
      '隐藏',
      '显示',
    ]);
    const enable = control('enable_thinking', [true, false]);
    expect(reasoningControlLabel(tZh, enable)).toBe('深度思考');
    expect(enable.values.map(value => reasoningValueLabel(tZh, enable, value))).toEqual([
      '开启',
      '关闭',
    ]);
  });

  it('treats an enabled/disabled-only mode, including object values, as a switch', () => {
    const plain = control('thinking.type', ['enabled', 'disabled']);
    expect(reasoningControlLabel(tZh, plain)).toBe('深度思考');
    const object = control('thinking', [{ keep: 'all', type: 'enabled' }, { type: 'disabled' }]);
    expect(reasoningControlLabel(tZh, object)).toBe('深度思考');
    expect(object.values.map(value => reasoningValueLabel(tZh, object, value))).toEqual([
      '开启',
      '关闭',
    ]);
  });

  it('humanizes parameters and values it does not know', () => {
    const unknown = control('extra.budget_mode', ['very_fast', 3]);
    expect(reasoningControlLabel(tZh, unknown)).toBe('Budget mode');
    expect(reasoningValueLabel(tZh, unknown, 'very_fast')).toBe('Very fast');
    expect(reasoningValueLabel(tZh, unknown, 3)).toBe('3');
  });

  it('summarizes with effort first, then mode, then the first control', () => {
    const display = control('thinking.display', ['omitted', 'summarized']);
    const mode = control('thinking.type', ['adaptive', 'disabled']);
    const effort = control('output_config.effort', ['low', 'high']);
    expect(primaryReasoningControl([display, mode, effort])).toBe(effort);
    expect(primaryReasoningControl([display, mode])).toBe(mode);
    expect(primaryReasoningControl([display])).toBe(display);
    expect(primaryReasoningControl([])).toBeUndefined();
  });

  it('has every label key in each locale that translates the menu', () => {
    const keys = Object.keys(en).filter(key => key.startsWith('reasoning_'));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(zh).toHaveProperty(key);
  });
});
