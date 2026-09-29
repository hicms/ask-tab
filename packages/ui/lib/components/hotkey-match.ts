/**
 * Decide whether a raw keyboard event should start/stop mic recording. Kept
 * pure (no DOM, no React) so both `MicButton` and its unit test share the exact
 * same rules.
 *
 * Push-to-talk: recording runs only while the hotkey is held.
 * - `shouldHotkeyStart` fires on a fresh `keydown` (`repeat === false`) whose
 *   `KeyboardEvent.code` equals the configured hotkey, only when a click would
 *   also be honoured (not `disabled`, not mid-`processing`, not already
 *   `recording`).
 * - `shouldHotkeyStop` fires on the matching `keyup` while `recording`. Once
 *   armed, releasing the key must always stop, no matter where focus has moved.
 *
 * Editable-target guard: only a configured Alt key may start recording while
 * typing. Ctrl/Meta/Shift must stay available for paste, selection, and other
 * editing shortcuts. The default Right Alt can still dictate from chat input;
 * Left Alt remains supported when explicitly configured. Extra modifiers,
 * AltGraph, composition, and events already handled elsewhere never arm it.
 *
 * An empty or undefined `hotkey` disables the shortcut entirely.
 */
const MODIFIER_CODES = new Set([
  'AltLeft',
  'AltRight',
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'MetaLeft',
  'MetaRight',
]);

/** True when `code` is a lone modifier key that types nothing when held alone. */
export const isModifierCode = (code: string | undefined): boolean =>
  !!code && MODIFIER_CODES.has(code);

type HotkeyStartEvent = Pick<KeyboardEvent, 'code' | 'repeat'> &
  Partial<
    Pick<
      KeyboardEvent,
      | 'altKey'
      | 'ctrlKey'
      | 'metaKey'
      | 'shiftKey'
      | 'defaultPrevented'
      | 'isComposing'
      | 'getModifierState'
    >
  >;

export const shouldHotkeyStart = (
  hotkey: string | undefined,
  event: HotkeyStartEvent,
  guards: { disabled?: boolean; processing: boolean; recording: boolean; editableTarget?: boolean },
): boolean => {
  if (!hotkey || event.repeat || event.code !== hotkey) return false;
  if (event.defaultPrevented || event.isComposing || event.getModifierState?.('AltGraph'))
    return false;
  const isAlt = hotkey === 'AltLeft' || hotkey === 'AltRight';
  if (guards.editableTarget && !isAlt) return false;
  // The key being pressed reports its own modifier as active. Only reject
  // modifiers belonging to other keys, so a lone configured modifier works.
  if (
    (event.altKey && !isAlt) ||
    (event.ctrlKey && hotkey !== 'ControlLeft' && hotkey !== 'ControlRight') ||
    (event.metaKey && hotkey !== 'MetaLeft' && hotkey !== 'MetaRight') ||
    (event.shiftKey && hotkey !== 'ShiftLeft' && hotkey !== 'ShiftRight')
  )
    return false;
  if (guards.disabled || guards.processing || guards.recording) return false;
  return true;
};

export const shouldHotkeyStop = (
  hotkey: string | undefined,
  event: { code: string },
  guards: { recording: boolean },
): boolean => {
  if (!hotkey || event.code !== hotkey) return false;
  return guards.recording;
};
