import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  request: vi.fn(),
  requireSession: vi.fn(async () => ({ token: 'jwt', userId: 'u' })),
  models: [{ id: 'embed-public', kind: 'embedding', embeddingSpaceId: 'space-a', isDefault: true }],
  config: { provider: 'openai-compatible', openaiCompatible: { modelId: 'embed-public' } },
}));
vi.mock('../ask-service/client', () => ({
  requestAuthorized: state.request,
  requireSession: state.requireSession,
}));
vi.mock('@extension/storage', () => ({
  publicModelsStorage: { get: async () => state.models },
  embeddingConfigStorage: { get: async () => state.config },
}));
const { createRemoteEmbeddingProvider } = await import('./embedding-remote');
const session = { token: 'jwt', userId: 'u', email: 'a@b.co', expiresAt: 9999999999999 };
const make = () =>
  createRemoteEmbeddingProvider({ modelId: 'embed-public', spaceId: 'space-a', session });
beforeEach(() => {
  state.request.mockReset();
  state.models = [
    { id: 'embed-public', kind: 'embedding', embeddingSpaceId: 'space-a', isDefault: true },
  ];
});
describe('remote embedding relay', () => {
  it('posts input to the Rust public route with a session snapshot, then normalizes', async () => {
    state.request.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ index: 0, embedding: [3, 4] }] })),
    );
    expect(await make().embedQuery('hello')).toEqual([0.6, 0.8]);
    const [path, init, expected] = state.request.mock.calls[0];
    expect(path).toBe('/api/embeddings/embed-public');
    expect(JSON.parse(init.body)).toEqual({ input: ['hello'] });
    expect(expected).toEqual(session);
  });
  it('discards an in-flight response when the space changes', async () => {
    state.request.mockImplementation(async () => {
      state.models = [
        { id: 'embed-public', kind: 'embedding', embeddingSpaceId: 'space-b', isDefault: true },
      ];
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }] }));
    });
    await expect(make().embedQuery('hello')).rejects.toThrow('Embedding model changed');
  });
  it('rejects malformed vector response', async () => {
    state.request.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ index: 0, embedding: [] }] })),
    );
    await expect(make().embedQuery('hello')).rejects.toThrow('Invalid embedding vector');
  });
});
