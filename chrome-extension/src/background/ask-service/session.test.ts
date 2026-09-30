import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  const values: Record<string, unknown> = {};
  const make = (key: string, initial: unknown) => {
    const listeners = new Set<() => void>();
    return {
      get: vi.fn(async () => (key in values ? values[key] : initial)),
      set: vi.fn(async (value: unknown) => {
        values[key] = value;
        listeners.forEach(listener => listener());
      }),
      subscribe: vi.fn((listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
    };
  };
  return {
    values,
    askSessionStorage: make('session', null),
    serverModelsStorage: make('models', []),
    publicModelsStorage: make('publicModels', []),
    selectedModelStorage: make('selected', ''),
  };
});

vi.mock('./endpoint', () => ({
  getServiceUrl: () => 'http://ask.test',
  serviceUrlReady: async () => {},
}));
vi.mock('@extension/env', () => ({ ASK_SERVICE_URL: 'http://ask.test' }));
vi.mock('@extension/storage', async () => ({
  modelTiers: (await vi.importActual<typeof import('@extension/storage')>('@extension/storage'))
    .modelTiers,
  askSessionStorage: store.askSessionStorage,
  serverModelsStorage: store.serverModelsStorage,
  publicModelsStorage: store.publicModelsStorage,
  selectedModelStorage: store.selectedModelStorage,
}));

const { handleAskMessage, refreshSessionOnStartup } = await import('./session');
const { confirmSessionAfterModelError, requestAuthorized, watchSession } = await import('./client');

const models = [
  {
    id: 'grok-4-7-fast',
    name: 'Grok-4.7-Fast',
    protocol: 'openai-completions',
    kind: 'chat',
    embeddingSpaceId: null,
    isDefault: false,
    supportsTools: true,
    supportsReasoning: false,
    supportsImages: true,
    contextWindow: null,
    vendor: null,
    tier: null,
    priceMultiplier: null,
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude-Sonnet-5',
    protocol: 'anthropic-messages',
    kind: 'chat',
    embeddingSpaceId: null,
    isDefault: true,
    supportsTools: true,
    supportsReasoning: true,
    supportsImages: true,
    contextWindow: 200000,
    vendor: null,
    tier: null,
    priceMultiplier: null,
  },
];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  for (const key of Object.keys(store.values)) delete store.values[key];
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('ASK_LOGIN', () => {
  it('stores the session and writes relay-backed models', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(200, { token: 'tok-1', expiresAt: 9999999999999, user: { id: 'u', email: 'a@b.co' } }),
      )
      .mockResolvedValueOnce(json(200, models));

    const result = await handleAskMessage({
      type: 'ASK_LOGIN',
      email: 'a@b.co',
      password: 'secret-pass',
    });

    expect(result).toEqual({ email: 'a@b.co', models: 2 });
    expect(fetchMock.mock.calls[0][0]).toBe('http://ask.test/api/auth/login');
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      email: 'a@b.co',
      password: 'secret-pass',
    });
    const modelsRequest = fetchMock.mock.calls[1];
    expect(modelsRequest[0]).toBe('http://ask.test/api/models');
    expect(new Headers(modelsRequest[1]?.headers).get('Authorization')).toBe('Bearer tok-1');

    expect(store.values.session).toEqual({
      token: 'tok-1',
      userId: 'u',
      email: 'a@b.co',
      expiresAt: 9999999999999,
    });
    expect(store.values.models).toEqual([
      {
        id: 'ask:grok-4-7-fast',
        modelId: 'grok-4-7-fast',
        name: 'Grok-4.7-Fast',
        provider: 'custom',
        supportsTools: true,
        supportsReasoning: false,
        supportsImages: true,
      },
      {
        id: 'ask:claude-sonnet-5',
        modelId: 'claude-sonnet-5',
        name: 'Claude-Sonnet-5',
        provider: 'anthropic',
        supportsTools: true,
        supportsReasoning: true,
        supportsImages: true,
        contextWindow: 200000,
      },
    ]);
    expect(store.values.selected).toBe('ask:claude-sonnet-5');
  });

  it('returns the server status for rejected credentials without storing a session', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: 'Not signed in or session expired' }));
    const result = await handleAskMessage({ type: 'ASK_LOGIN', email: 'a@b.co', password: 'x' });
    expect(result).toEqual({ error: 'Not signed in or session expired', status: 401 });
    expect(store.values.session).toBeUndefined();
  });

  it('reports an unreachable server with status 0', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await handleAskMessage({
      type: 'ASK_REGISTER',
      email: 'a@b.co',
      password: 'x',
      inviteCode: 'Invite-1',
    });
    expect(result).toMatchObject({ status: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://ask.test/api/auth/register');
  });

  it('ignores an invitation code on sign-in', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: 'Not signed in or session expired' }));
    await handleAskMessage({
      type: 'ASK_LOGIN',
      email: 'a@b.co',
      password: 'secret-pass',
      inviteCode: 'Invite-1',
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      email: 'a@b.co',
      password: 'secret-pass',
    });
  });
});

describe('ASK_REGISTER', () => {
  it('sends the invitation code and signs in with the returned session', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(201, {
          token: 'tok-new',
          expiresAt: 9999999999999,
          user: { id: 'n', email: 'n@b.co' },
        }),
      )
      .mockResolvedValueOnce(json(200, models));

    const result = await handleAskMessage({
      type: 'ASK_REGISTER',
      email: 'n@b.co',
      password: 'secret-pass',
      inviteCode: 'AbC-12 x9',
    });

    expect(result).toEqual({ email: 'n@b.co', models: 2 });
    expect(fetchMock.mock.calls[0][0]).toBe('http://ask.test/api/auth/register');
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      email: 'n@b.co',
      password: 'secret-pass',
      inviteCode: 'AbC-12 x9',
    });
    expect(store.values.session).toEqual({
      token: 'tok-new',
      userId: 'n',
      email: 'n@b.co',
      expiresAt: 9999999999999,
    });
  });

  it('returns a rejected invitation code without storing a session', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, { error: 'Invitation code is required, invalid, or already used' }),
    );
    const result = await handleAskMessage({
      type: 'ASK_REGISTER',
      email: 'n@b.co',
      password: 'secret-pass',
      inviteCode: 'used-code',
    });
    expect(result).toEqual({
      error: 'Invitation code is required, invalid, or already used',
      status: 400,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.values.session).toBeUndefined();
  });
});

describe('ASK_SYNC_MODELS', () => {
  it('does not overwrite the new account catalog when an old sync finishes late', async () => {
    store.values.session = {
      token: 'old-jwt',
      userId: 'old',
      email: 'old@b.co',
      expiresAt: 9999999999999,
    };
    let finishOld!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>(resolve => {
          finishOld = resolve;
        }),
    );
    const oldSync = handleAskMessage({ type: 'ASK_SYNC_MODELS' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const nextModels = [{ ...models[0], id: 'new-account-model', isDefault: true }];
    fetchMock
      .mockResolvedValueOnce(
        json(200, {
          token: 'new-jwt',
          expiresAt: 9999999999999,
          user: { id: 'new', email: 'new@b.co' },
        }),
      )
      .mockResolvedValueOnce(json(200, nextModels));
    expect(
      await handleAskMessage({ type: 'ASK_LOGIN', email: 'new@b.co', password: 'password' }),
    ).toEqual({ email: 'new@b.co', models: 1 });
    finishOld(json(200, models));
    await expect(oldSync).rejects.toThrow('Account changed');
    expect(store.values.models).toEqual([
      expect.objectContaining({ modelId: 'new-account-model' }),
    ]);
    expect(store.values.publicModels).toEqual(nextModels);
    expect((store.values.session as { token: string }).token).toBe('new-jwt');
  });

  it('does not clear a new login when an old request returns 401', async () => {
    store.values.session = {
      token: 'old-jwt',
      userId: 'old',
      email: 'old@b.co',
      expiresAt: 9999999999999,
    };
    let rejectOld!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>(resolve => {
          rejectOld = resolve;
        }),
    );
    const oldRequest = requestAuthorized('/api/search', { method: 'POST' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fetchMock
      .mockResolvedValueOnce(
        json(200, {
          token: 'new-jwt',
          expiresAt: 9999999999999,
          user: { id: 'new', email: 'new@b.co' },
        }),
      )
      .mockResolvedValueOnce(json(200, models));
    await handleAskMessage({ type: 'ASK_LOGIN', email: 'new@b.co', password: 'password' });
    rejectOld(json(401, { error: 'expired' }));
    await expect(oldRequest).rejects.toThrow('Account changed during request');
    expect((store.values.session as { token: string }).token).toBe('new-jwt');
    expect(store.values.models).toHaveLength(2);
  });

  it('keeps a still-valid model selection', async () => {
    store.values.session = { token: 'tok', userId: 'u', email: 'a@b.co', expiresAt: 9999999999999 };
    store.values.selected = 'ask:grok-4-7-fast';
    fetchMock.mockResolvedValueOnce(json(200, models));
    expect(await handleAskMessage({ type: 'ASK_SYNC_MODELS' })).toEqual({ models: 2 });
    expect(store.values.selected).toBe('ask:grok-4-7-fast');
  });

  it('persists only published model fields when the response has extra data', async () => {
    store.values.session = { token: 'tok', userId: 'u', email: 'a@b.co', expiresAt: 9999999999999 };
    fetchMock.mockResolvedValueOnce(
      json(200, [
        { ...models[0], apiKey: 'sk-should-not-store', baseUrl: 'https://upstream.test' },
      ]),
    );
    await handleAskMessage({ type: 'ASK_SYNC_MODELS' });
    expect(store.values.publicModels).toEqual([models[0]]);
    expect(JSON.stringify(store.values.models)).not.toContain('sk-should-not-store');
  });

  it('maps every native Gemini chat model in the catalog to the Google SDK', async () => {
    store.values.session = { token: 'tok', userId: 'u', email: 'a@b.co', expiresAt: 9999999999999 };
    const gemini = {
      ...models[0],
      protocol: 'gemini-generate-content',
      supportsReasoning: true,
    };
    fetchMock.mockResolvedValueOnce(
      json(200, [
        { ...gemini, id: 'gemini-3-8-flash', name: 'Gemini-3.8-Flash', isDefault: true },
        { ...gemini, id: 'gemini-next-pro', name: 'Gemini-Next-Pro', contextWindow: 1048576 },
      ]),
    );
    expect(await handleAskMessage({ type: 'ASK_SYNC_MODELS' })).toEqual({ models: 2 });
    expect(store.values.models).toEqual([
      {
        id: 'ask:gemini-3-8-flash',
        modelId: 'gemini-3-8-flash',
        name: 'Gemini-3.8-Flash',
        provider: 'google',
        supportsTools: true,
        supportsReasoning: true,
        supportsImages: true,
      },
      {
        id: 'ask:gemini-next-pro',
        modelId: 'gemini-next-pro',
        name: 'Gemini-Next-Pro',
        provider: 'google',
        supportsTools: true,
        supportsReasoning: true,
        supportsImages: true,
        contextWindow: 1048576,
      },
    ]);
    expect(store.values.selected).toBe('ask:gemini-3-8-flash');
  });

  it('keeps a text-only model marked as not accepting images', async () => {
    store.values.session = { token: 'tok', userId: 'u', email: 'a@b.co', expiresAt: 9999999999999 };
    const textOnly = { ...models[0], id: 'text-only', supportsImages: false };
    fetchMock.mockResolvedValueOnce(json(200, [textOnly]));
    await handleAskMessage({ type: 'ASK_SYNC_MODELS' });
    expect(store.values.publicModels).toEqual([textOnly]);
    expect(store.values.models).toEqual([expect.objectContaining({ supportsImages: false })]);
  });

  it('rejects a catalog that does not publish image input support', async () => {
    store.values.session = { token: 'tok', userId: 'u', email: 'a@b.co', expiresAt: 9999999999999 };
    const { supportsImages: _omitted, ...withoutImages } = models[0];
    fetchMock.mockResolvedValueOnce(json(200, [withoutImages]));
    await expect(handleAskMessage({ type: 'ASK_SYNC_MODELS' })).rejects.toThrow(
      'Invalid server model catalog',
    );
    expect(store.values.models).toBeUndefined();
  });

  it('copies picker metadata into the chat catalog', async () => {
    store.values.session = { token: 'tok', userId: 'u', email: 'a@b.co', expiresAt: 9999999999999 };
    const rated = { ...models[0], vendor: 'xai', tier: 'flagship', priceMultiplier: 3.5 };
    fetchMock.mockResolvedValueOnce(json(200, [rated, models[1]]));
    await handleAskMessage({ type: 'ASK_SYNC_MODELS' });
    expect(store.values.publicModels).toEqual([rated, models[1]]);
    const [first, second] = store.values.models as Record<string, unknown>[];
    expect(first).toMatchObject({ vendor: 'xai', tier: 'flagship', priceMultiplier: 3.5 });
    for (const key of ['vendor', 'tier', 'priceMultiplier']) expect(second).not.toHaveProperty(key);
  });

  it.each([
    ['vendor is missing', { vendor: undefined }],
    ['tier is missing', { tier: undefined }],
    ['priceMultiplier is missing', { priceMultiplier: undefined }],
    ['vendor is empty', { vendor: '' }],
    ['vendor is not a string', { vendor: 7 }],
    ['tier is unknown', { tier: 'ultra' }],
    ['priceMultiplier is zero', { priceMultiplier: 0 }],
    ['priceMultiplier is negative', { priceMultiplier: -1 }],
    ['priceMultiplier is a string', { priceMultiplier: '2' }],
  ])('rejects a catalog whose %s', async (_case, change) => {
    store.values.session = { token: 'tok', userId: 'u', email: 'a@b.co', expiresAt: 9999999999999 };
    const broken: Record<string, unknown> = { ...models[0], ...change };
    for (const [key, value] of Object.entries(change)) if (value === undefined) delete broken[key];
    fetchMock.mockResolvedValueOnce(json(200, [broken]));
    await expect(handleAskMessage({ type: 'ASK_SYNC_MODELS' })).rejects.toThrow(
      'Invalid server model catalog',
    );
    expect(store.values.models).toBeUndefined();
  });

  it('rejects a chat protocol the extension has no SDK for', async () => {
    store.values.session = { token: 'tok', userId: 'u', email: 'a@b.co', expiresAt: 9999999999999 };
    fetchMock.mockResolvedValueOnce(json(200, [{ ...models[0], protocol: 'openai-responses' }]));
    await expect(handleAskMessage({ type: 'ASK_SYNC_MODELS' })).rejects.toThrow(
      'Invalid server model catalog',
    );
    expect(store.values.models).toBeUndefined();
  });

  it('rejects a model whose kind disagrees with its protocol', async () => {
    store.values.session = { token: 'tok', userId: 'u', email: 'a@b.co', expiresAt: 9999999999999 };
    fetchMock.mockResolvedValueOnce(json(200, [{ ...models[0], kind: 'embedding' }]));
    await expect(handleAskMessage({ type: 'ASK_SYNC_MODELS' })).rejects.toThrow(
      'Invalid server model catalog',
    );
    expect(store.values.publicModels).toBeUndefined();
  });

  it('clears the session and models when the server rejects the token', async () => {
    store.values.session = { token: 'tok', userId: 'u', email: 'a@b.co', expiresAt: 9999999999999 };
    store.values.models = [{ id: 'ask:old' }];
    fetchMock.mockResolvedValueOnce(json(401, { error: 'expired' }));
    await expect(handleAskMessage({ type: 'ASK_SYNC_MODELS' })).rejects.toThrow('expired');
    expect(store.values.session).toBeNull();
    expect(store.values.models).toEqual([]);
  });
});

describe('refreshSessionOnStartup', () => {
  it('keeps cached models when the server is offline', async () => {
    store.values.session = { token: 'tok', userId: 'u', email: 'a@b.co', expiresAt: 9999999999999 };
    store.values.models = [{ id: 'ask:cached' }];
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await refreshSessionOnStartup();
    expect(store.values.session).toEqual({
      token: 'tok',
      userId: 'u',
      email: 'a@b.co',
      expiresAt: 9999999999999,
    });
    expect(store.values.models).toEqual([{ id: 'ask:cached' }]);
  });

  it('removes models configured before server accounts when signed out', async () => {
    store.values.models = [{ id: 'ask:stale', provider: 'custom' }];
    await refreshSessionOnStartup();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.values.models).toEqual([]);
  });
});

describe('confirmSessionAfterModelError', () => {
  const relayUrl = 'http://ask.test/api/llm/grok-4-7-fast';

  it('ends the session when the server no longer accepts the token', async () => {
    store.values.session = { token: 'tok', userId: 'u', email: 'a@b.co', expiresAt: 9999999999999 };
    store.values.models = [{ id: 'ask:x' }];
    fetchMock.mockResolvedValueOnce(json(401, { error: 'expired' }));

    await confirmSessionAfterModelError(relayUrl, 'tok');

    expect(fetchMock.mock.calls[0][0]).toBe('http://ask.test/api/auth/me');
    expect(store.values.session).toBeNull();
    expect(store.values.models).toEqual([]);
  });

  it('re-checks the session after a failed native Gemini relay call', async () => {
    store.values.session = { token: 'tok', userId: 'u', email: 'a@b.co', expiresAt: 9999999999999 };
    fetchMock.mockResolvedValueOnce(json(401, { error: 'expired' }));

    await confirmSessionAfterModelError('http://ask.test/api/llm/gemini-3-8-flash/v1beta', 'tok');

    expect(fetchMock.mock.calls[0][0]).toBe('http://ask.test/api/auth/me');
    expect(store.values.session).toBeNull();
  });

  it('keeps the session when the token is still valid', async () => {
    store.values.session = { token: 'tok', userId: 'u', email: 'a@b.co', expiresAt: 9999999999999 };
    fetchMock.mockResolvedValueOnce(json(200, { id: 'u', email: 'a@b.co' }));

    await confirmSessionAfterModelError(relayUrl, 'tok');

    expect(store.values.session).toEqual({
      token: 'tok',
      userId: 'u',
      email: 'a@b.co',
      expiresAt: 9999999999999,
    });
  });

  it('ignores other providers and tokens from an earlier session', async () => {
    store.values.session = { token: 'tok', userId: 'u', email: 'a@b.co', expiresAt: 9999999999999 };

    await confirmSessionAfterModelError('https://api.openai.com/v1', 'tok');
    await confirmSessionAfterModelError(relayUrl, 'old-token');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('requestAuthorized', () => {
  it('rejects an upload bound to an earlier session before sending it', async () => {
    store.values.session = {
      token: 'new-token',
      userId: 'new',
      email: 'b@b.co',
      expiresAt: 9999999999999,
    };
    await expect(
      requestAuthorized(
        '/api/backups',
        { method: 'POST' },
        { token: 'old-token', userId: 'old', email: 'old@b.co', expiresAt: 9999999999999 },
      ),
    ).rejects.toThrow('Account changed during request');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.values.session).toEqual({
      token: 'new-token',
      userId: 'new',
      email: 'b@b.co',
      expiresAt: 9999999999999,
    });
  });

  it('rejects an old successful response after another account signs in', async () => {
    store.values.session = {
      token: 'old-token',
      userId: 'old',
      email: 'old@b.co',
      expiresAt: 9999999999999,
    };
    let finishOld!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>(resolve => {
          finishOld = resolve;
        }),
    );
    const oldRequest = requestAuthorized('/api/search', { method: 'POST' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    store.values.session = {
      token: 'new-token',
      userId: 'new',
      email: 'new@b.co',
      expiresAt: 9999999999999,
    };
    finishOld(json(200, { results: [] }));
    await expect(oldRequest).rejects.toThrow('Account changed during request');
  });

  it('aborts an in-flight request when the account changes', async () => {
    const old = { token: 'old', userId: 'old', email: 'old@b.co', expiresAt: 9999999999999 };
    await store.askSessionStorage.set(old);
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const request = requestAuthorized('/api/search', { method: 'POST' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await store.askSessionStorage.set({ ...old, token: 'new', userId: 'new' });
    await expect(request).rejects.toThrow('Account changed during request');
  });
});

describe('watchSession', () => {
  it('signals an in-flight operation when the account changes', async () => {
    const old = { token: 'old', userId: 'old', email: 'old@b.co', expiresAt: 9999999999999 };
    await store.askSessionStorage.set(old);
    const onChange = vi.fn();
    const stop = watchSession(old, onChange);
    await store.askSessionStorage.set({ ...old, token: 'new' });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    stop();
  });

  it('signals an in-flight operation when its JWT expires', async () => {
    const session = {
      token: 'short-lived',
      userId: 'u',
      email: 'u@b.co',
      expiresAt: Date.now() + 20,
    };
    await store.askSessionStorage.set(session);
    const onChange = vi.fn();
    const stop = watchSession(session, onChange);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 1000 });
    stop();
  });
});

describe('ASK_LOGOUT', () => {
  it('ends the local session even when the server is unreachable', async () => {
    store.values.session = { token: 'tok', userId: 'u', email: 'a@b.co', expiresAt: 9999999999999 };
    store.values.models = [{ id: 'ask:x' }];
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await handleAskMessage({ type: 'ASK_LOGOUT' })).toEqual({ success: true });
    expect(store.values.session).toBeNull();
    expect(store.values.models).toEqual([]);
  });
});
