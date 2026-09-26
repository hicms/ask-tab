import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  config: { provider: 'openai-compatible', openaiCompatible: { modelId: '' } },
  models: [{ id: 'embed-public', kind: 'embedding', embeddingSpaceId: 'space-a', isDefault: true }],
  session: { token: 'jwt', userId: 'u', email: 'a@b.co', expiresAt: 9999999999999 },
  factory: vi.fn((opts: unknown) => opts),
}));
vi.mock('@extension/storage', () => ({
  embeddingConfigStorage: { get: async () => state.config },
  publicModelsStorage: { get: async () => state.models },
}));
vi.mock('../ask-service/client', () => ({ requireSession: async () => state.session }));
vi.mock('./embedding-remote', () => ({ createRemoteEmbeddingProvider: state.factory }));
vi.mock('../logging/logger-buffer', () => ({ createLogger: () => ({ warn: vi.fn() }) }));
const { resolveEmbeddingProvider } = await import('./embedding-provider');

beforeEach(() => {
  state.config = { provider: 'openai-compatible', openaiCompatible: { modelId: '' } };
  state.models = [
    { id: 'embed-public', kind: 'embedding', embeddingSpaceId: 'space-a', isDefault: true },
  ];
  state.factory.mockClear();
});
describe('embedding provider selection', () => {
  it('passes only public model, space and transient session to the relay adapter', async () => {
    await resolveEmbeddingProvider();
    expect(state.factory).toHaveBeenCalledWith({
      modelId: 'embed-public',
      spaceId: 'space-a',
      session: state.session,
    });
  });
  it('returns BM25-only when no embedding is published', async () => {
    state.models = [];
    expect(await resolveEmbeddingProvider()).toBeNull();
    expect(state.factory).not.toHaveBeenCalled();
  });
  it('does not reuse a provider after the space changes', async () => {
    await resolveEmbeddingProvider();
    state.models = [
      { id: 'embed-public', kind: 'embedding', embeddingSpaceId: 'space-b', isDefault: true },
    ];
    await resolveEmbeddingProvider();
    expect(state.factory.mock.calls[1][0]).toMatchObject({ spaceId: 'space-b' });
  });
});
