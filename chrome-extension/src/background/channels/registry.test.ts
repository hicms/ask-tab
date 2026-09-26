import { getChannelAdapter } from './registry';
import { telegramAdapter } from './telegram/adapter';
import { whatsappAdapter } from './whatsapp/adapter';
import { describe, expect, it } from 'vitest';

describe('channel registry', () => {
  it('returns the built-in adapters', () => {
    expect(getChannelAdapter('telegram')).toBe(telegramAdapter);
    expect(getChannelAdapter('whatsapp')).toBe(whatsappAdapter);
  });

  it('returns undefined for an unknown channel', () => {
    expect(getChannelAdapter('signal')).toBeUndefined();
  });
});
