/**
 * Tests for media-understanding/providers/transformers.ts
 * Mocks the offscreen-bridge to avoid chrome.runtime calls.
 */
import { requestTranscription } from './offscreen-bridge';
import { transformersProvider } from './providers/transformers';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./offscreen-bridge', () => ({
  requestTranscription: vi.fn(),
}));

const mockRequestTranscription = vi.mocked(requestTranscription);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('transformers provider', () => {
  const audio = new ArrayBuffer(256);

  it('has id "transformers"', () => {
    expect(transformersProvider.id).toBe('transformers');
  });

  it('delegates to requestTranscription with provided model and language', async () => {
    mockRequestTranscription.mockResolvedValueOnce('hello world');

    const result = await transformersProvider.transcribe(audio, 'audio/ogg', {
      model: 'base',
      language: 'en',
    });

    expect(result).toBe('hello world');
    expect(mockRequestTranscription).toHaveBeenCalledWith(audio, 'audio/ogg', 'base', 'en');
  });

  it('uses DEFAULT_LOCAL_MODEL when model is not provided', async () => {
    mockRequestTranscription.mockResolvedValueOnce('默认模型');

    await transformersProvider.transcribe(audio, 'audio/webm', {});

    // DEFAULT_LOCAL_MODEL = 'tiny'
    expect(mockRequestTranscription).toHaveBeenCalledWith(audio, 'audio/webm', 'tiny', undefined);
  });

  it('passes undefined language when not specified', async () => {
    mockRequestTranscription.mockResolvedValueOnce('auto detected');

    await transformersProvider.transcribe(audio, 'audio/mp3', { model: 'small' });

    expect(mockRequestTranscription).toHaveBeenCalledWith(audio, 'audio/mp3', 'small', undefined);
  });

  it('propagates errors from requestTranscription', async () => {
    mockRequestTranscription.mockRejectedValueOnce(new Error('Offscreen timed out'));

    await expect(
      transformersProvider.transcribe(audio, 'audio/ogg', { model: 'tiny' }),
    ).rejects.toThrow('Offscreen timed out');
  });
});
