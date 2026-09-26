import { formatKeyCode } from './format-key-code.js';
import { defaultSttConfig } from '@extension/storage';
import { describe, expect, it } from 'vitest';

describe('SpeechToTextConfig — SttConfig defaults', () => {
  it('defaultSttConfig has expected shape', () => {
    expect(defaultSttConfig.engine).toBe('off');
    expect(defaultSttConfig.openai).toEqual({ modelId: '' });
    expect(defaultSttConfig.language).toBe('en');
    expect(defaultSttConfig.localModel).toBe('tiny');
    expect(defaultSttConfig.hotkey).toBe('AltRight');
  });
});

describe('formatKeyCode', () => {
  it('formats sided modifier codes as "<Side> <Name>"', () => {
    expect(formatKeyCode('AltRight')).toBe('Right Alt');
    expect(formatKeyCode('AltLeft')).toBe('Left Alt');
    expect(formatKeyCode('ControlLeft')).toBe('Left Ctrl');
    expect(formatKeyCode('ShiftRight')).toBe('Right Shift');
    expect(formatKeyCode('MetaLeft')).toBe('Left Meta');
  });

  it('formats letter and digit codes to the bare character', () => {
    expect(formatKeyCode('KeyK')).toBe('K');
    expect(formatKeyCode('KeyZ')).toBe('Z');
    expect(formatKeyCode('Digit1')).toBe('1');
    expect(formatKeyCode('Digit0')).toBe('0');
  });

  it('formats named keys via the friendly map', () => {
    expect(formatKeyCode('Space')).toBe('Space');
    expect(formatKeyCode('Enter')).toBe('Enter');
    expect(formatKeyCode('Escape')).toBe('Esc');
    expect(formatKeyCode('Backquote')).toBe('`');
    expect(formatKeyCode('CapsLock')).toBe('Caps Lock');
  });

  it('returns empty string for empty input', () => {
    expect(formatKeyCode('')).toBe('');
  });

  it('returns unknown codes unchanged', () => {
    expect(formatKeyCode('F13')).toBe('F13');
    expect(formatKeyCode('NumpadEnter')).toBe('NumpadEnter');
  });
});
