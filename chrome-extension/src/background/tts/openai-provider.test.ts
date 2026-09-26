import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestAuthorized = vi.hoisted(() => vi.fn());
const requireSession = vi.hoisted(() => vi.fn());
vi.mock('../ask-service/client', () => ({ requestAuthorized, requireSession }));
const { openaiTtsProvider } = await import('./providers/openai-tts');

beforeEach(() => {
  requestAuthorized.mockReset();
  requireSession.mockReset();
});
describe('server TTS provider', () => {
  it('sends text and voice to a public model route and preserves the audio content type', async () => {
    requestAuthorized.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/ogg' } }),
    );
    const result = await openaiTtsProvider.synthesize('Hello', {
      model: 'tts-public',
      voice: 'nova',
    });
    expect([...new Uint8Array(result.audio)]).toEqual([1, 2, 3]);
    expect(result.contentType).toBe('audio/ogg');
    const [path, init] = requestAuthorized.mock.calls[0];
    expect(path).toBe('/api/audio/tts-public/speech');
    expect(JSON.parse(init.body)).toEqual({ input: 'Hello', voice: 'nova' });
    expect(JSON.stringify(init)).not.toContain('sk-');
  });
  it('requires a published model ID', async () => {
    await expect(openaiTtsProvider.synthesize('Hi', {})).rejects.toThrow(
      'Server TTS model is not configured',
    );
    expect(requestAuthorized).not.toHaveBeenCalled();
  });
  it('drops audio if the account changes while the body is read', async () => {
    const session = {
      token: 'old',
      userId: 'old',
      email: 'old@b.co',
      expiresAt: Date.now() + 1000,
    };
    requestAuthorized.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    requireSession.mockRejectedValue(new Error('Account changed'));
    await expect(
      openaiTtsProvider.synthesize('Hi', { model: 'tts-public', session }),
    ).rejects.toThrow('Account changed');
  });
});
