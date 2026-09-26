/**
 * Tests for media-understanding/providers/index.ts — provider registry.
 * We mock the individual provider modules to avoid chrome.* dependency chains.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('./providers/openai', () => ({
  openaiProvider: { id: 'openai', transcribe: vi.fn() },
}));

const { getProvider, PROVIDERS } = await import('./providers');

describe('STT provider registry', () => {
  it('registers only the server provider', () => {
    expect(PROVIDERS.map(p => p.id)).toEqual(['openai']);
  });

  it('getProvider("openai") returns the openai provider', () => {
    const provider = getProvider('openai');
    expect(provider).toBeDefined();
    expect(provider!.id).toBe('openai');
    expect(typeof provider!.transcribe).toBe('function');
  });

  it('getProvider returns undefined for unknown engine', () => {
    expect(getProvider('transformers')).toBeUndefined();
    expect(getProvider('')).toBeUndefined();
    expect(getProvider('google')).toBeUndefined();
  });
});
