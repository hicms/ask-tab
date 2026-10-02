import type { ReasoningControl, ReasoningValue } from '@extension/storage';

interface ReasoningSetting {
  path: string;
  value: ReasoningValue;
}

const sameReasoningValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(key => Object.hasOwn(right, key) && sameReasoningValue(left[key], right[key]))
  );
};

const isAllowedReasoningValue = (control: ReasoningControl, value: unknown): boolean =>
  control.values.some(allowed => sameReasoningValue(allowed, value));

/**
 * Every control is sent on every request: the relay never fills defaults. A stored
 * choice the catalog no longer offers falls back to the published default.
 */
const resolveReasoningSettings = (
  controls: readonly ReasoningControl[],
  chosen: Readonly<Record<string, ReasoningValue>> = {},
): ReasoningSetting[] =>
  controls.map(control => ({
    path: control.path,
    value:
      Object.hasOwn(chosen, control.path) && isAllowedReasoningValue(control, chosen[control.path])
        ? chosen[control.path]
        : control.default,
  }));

/** A control with a single value is always sent but offers nothing to choose. */
const isSelectableReasoningControl = (control: ReasoningControl): boolean =>
  control.values.length > 1;

const formatReasoningValue = (value: ReasoningValue): string =>
  typeof value === 'string' ? value : JSON.stringify(value);

export {
  formatReasoningValue,
  isAllowedReasoningValue,
  isSelectableReasoningControl,
  resolveReasoningSettings,
  sameReasoningValue,
};
export type { ReasoningSetting };
