import { formatReasoningValue } from '@extension/shared';
import type { MessageKeyType } from '@extension/i18n';
import type { ReasoningControl, ReasoningValue } from '@extension/storage';

type Translate = (key: MessageKeyType) => string;
type ControlKind = 'effort' | 'mode' | 'toggle' | 'display';

const effort = { label: 'reasoning_paramEffort', kind: 'effort' } as const;
const display = { label: 'reasoning_paramDisplay', kind: 'display' } as const;

/** Paths differ per provider; several name the same idea. */
const knownControls: Record<string, { label: MessageKeyType; kind: ControlKind }> = {
  reasoning_effort: effort,
  'output_config.effort': effort,
  'generationConfig.thinkingConfig.thinkingLevel': effort,
  'thinking.type': { label: 'reasoning_paramMode', kind: 'mode' },
  thinking: { label: 'reasoning_paramMode', kind: 'mode' },
  enable_thinking: { label: 'reasoning_paramEnabled', kind: 'toggle' },
  'thinking.display': display,
  'generationConfig.thinkingConfig.includeThoughts': display,
  preserve_thinking: { label: 'reasoning_paramPreserve', kind: 'toggle' },
  'thinking.clear_thinking': { label: 'reasoning_paramClear', kind: 'toggle' },
  reasoning_split: { label: 'reasoning_paramSplit', kind: 'toggle' },
};

const knownValues: Record<string, MessageKeyType> = {
  none: 'reasoning_valueNone',
  minimal: 'reasoning_valueMinimal',
  low: 'reasoning_valueLow',
  medium: 'reasoning_valueMedium',
  high: 'reasoning_valueHigh',
  xhigh: 'reasoning_valueXhigh',
  max: 'reasoning_valueMax',
  enabled: 'reasoning_valueOn',
  disabled: 'reasoning_valueOff',
  adaptive: 'reasoning_valueAdaptive',
  between_tools: 'reasoning_valueBetweenTools',
  omitted: 'reasoning_valueHidden',
  summarized: 'reasoning_valueSummarized',
};

/** Last resort for a parameter added to the catalog later: `clear_thinking` → `Clear thinking`. */
const humanize = (raw: string): string => {
  const words = raw.replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : raw;
};

/** Object values such as `{ type: 'enabled', keep: 'all' }` are named by their `type`. */
const valueName = (value: ReasoningValue): ReasoningValue => {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.type === 'string'
  ) {
    return value.type;
  }
  return value;
};

const isOnOffMode = (control: ReasoningControl): boolean =>
  control.values.every(value => {
    const name = valueName(value);
    return name === 'enabled' || name === 'disabled';
  });

const reasoningControlLabel = (t: Translate, control: ReasoningControl): string => {
  const known = knownControls[control.path];
  if (!known) return humanize(control.path.split('.').at(-1) ?? control.path);
  // `thinking.type` limited to enabled/disabled is a plain on/off switch.
  if (known.kind === 'mode' && isOnOffMode(control)) return t('reasoning_paramEnabled');
  return t(known.label);
};

const reasoningValueLabel = (
  t: Translate,
  control: ReasoningControl,
  raw: ReasoningValue,
): string => {
  const value = valueName(raw);
  if (typeof value === 'boolean') {
    if (knownControls[control.path]?.kind === 'display') {
      return t(value ? 'reasoning_valueShown' : 'reasoning_valueHidden');
    }
    return t(value ? 'reasoning_valueOn' : 'reasoning_valueOff');
  }
  if (typeof value === 'string') {
    const key = Object.hasOwn(knownValues, value) ? knownValues[value] : undefined;
    return key ? t(key) : humanize(value);
  }
  return formatReasoningValue(value);
};

/** The control whose value best summarizes the setting on the composer chip. */
const primaryReasoningControl = (
  controls: readonly ReasoningControl[],
): ReasoningControl | undefined =>
  controls.find(control => knownControls[control.path]?.kind === 'effort') ??
  controls.find(control => knownControls[control.path]?.kind === 'mode') ??
  controls[0];

export { primaryReasoningControl, reasoningControlLabel, reasoningValueLabel };
