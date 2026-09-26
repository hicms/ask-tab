import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestAuthorized = vi.hoisted(() => vi.fn());
const requireSession = vi.hoisted(() => vi.fn());
vi.mock('../ask-service/client', () => ({ requestAuthorized, requireSession }));
const { openaiProvider } = await import('./providers/openai');

beforeEach(() => {
  requestAuthorized.mockReset();
  requireSession.mockReset();
});
describe('server STT provider', () => {
  it('sends audio and language to a public model route without an upstream model or key', async () => {
    requestAuthorized.mockResolvedValue(new Response(JSON.stringify({ text: 'hello' })));
    expect(
      await openaiProvider.transcribe(new ArrayBuffer(4), 'audio/webm', {
        model: 'stt-public',
        language: 'zh',
      }),
    ).toBe('hello');
    const [path, init] = requestAuthorized.mock.calls[0];
    expect(path).toBe('/api/audio/stt-public/transcriptions');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get('file')).toBeInstanceOf(Blob);
    expect(init.body.get('language')).toBe('zh');
    expect(init.body.has('model')).toBe(false);
    expect(JSON.stringify(init)).not.toContain('sk-');
  });
  it('refuses to call the server without a public STT model', async () => {
    await expect(openaiProvider.transcribe(new ArrayBuffer(1), 'audio/webm', {})).rejects.toThrow(
      'Server STT model is not configured',
    );
    expect(requestAuthorized).not.toHaveBeenCalled();
  });
  it('drops a transcript if the account changes while the body is read', async () => {
    const session = {
      token: 'old',
      userId: 'old',
      email: 'old@b.co',
      expiresAt: Date.now() + 1000,
    };
    requestAuthorized.mockResolvedValue(new Response(JSON.stringify({ text: 'old transcript' })));
    requireSession.mockRejectedValue(new Error('Account changed'));
    await expect(
      openaiProvider.transcribe(new ArrayBuffer(1), 'audio/webm', { model: 'stt-public', session }),
    ).rejects.toThrow('Account changed');
  });
});
