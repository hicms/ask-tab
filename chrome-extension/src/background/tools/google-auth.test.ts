/**
 * Tests for google-auth.ts — getGoogleToken, removeCachedToken, googleFetch, getGoogleUserEmail.
 * Tests both the getAuthToken path (default) and launchWebAuthFlow path (custom client ID).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Chrome API mocks ──

const mockGetAuthToken = vi.fn();
const mockRemoveCachedAuthToken = vi.fn();
const mockLaunchWebAuthFlow = vi.fn();
const mockGetRedirectURL = vi.fn(() => 'https://abcdefg.chromiumapp.org/');

Object.defineProperty(globalThis, 'chrome', {
  value: {
    identity: {
      getAuthToken: mockGetAuthToken,
      removeCachedAuthToken: mockRemoveCachedAuthToken,
      launchWebAuthFlow: mockLaunchWebAuthFlow,
      getRedirectURL: mockGetRedirectURL,
    },
    runtime: { lastError: undefined as { message: string } | undefined },
  },
  writable: true,
  configurable: true,
});

// ── Logger mock ──
vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Storage mock ──
let mockGoogleClientId: string | undefined;
vi.mock('@extension/storage', () => ({
  toolConfigStorage: {
    get: vi.fn(() =>
      Promise.resolve({
        enabledTools: {},
        webSearchConfig: {
          provider: 'server',
          browser: { engine: 'google' },
        },
        googleClientId: mockGoogleClientId,
      }),
    ),
    set: vi.fn(),
    subscribe: vi.fn(),
  },
  logConfigStorage: {
    get: vi.fn(() => Promise.resolve({ enabled: false, level: 'info' })),
    subscribe: vi.fn(),
  },
}));

// ── Import after mocks ──
const {
  getGoogleToken,
  removeCachedToken,
  googleFetch,
  getGoogleUserEmail,
  webAuthTokenCache,
  _resetForTesting,
} = await import('./google-auth');

// ── Tests ──

describe('getGoogleToken — default path (getAuthToken)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGoogleClientId = undefined;
    _resetForTesting();
  });

  it('returns token on success', async () => {
    mockGetAuthToken.mockResolvedValue({ token: 'test-token-123' });

    const token = await getGoogleToken(['https://www.googleapis.com/auth/gmail.readonly']);
    expect(token).toBe('test-token-123');
    expect(mockGetAuthToken).toHaveBeenCalledWith({
      interactive: true,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    });
  });

  it('throws when token is empty', async () => {
    mockGetAuthToken.mockResolvedValue({ token: '' });

    await expect(getGoogleToken(['scope'])).rejects.toThrow('Failed to get Google auth token');
  });

  it('throws when getAuthToken rejects', async () => {
    mockGetAuthToken.mockRejectedValue(new Error('User denied'));

    await expect(getGoogleToken(['scope'])).rejects.toThrow('User denied');
  });
});

describe('getGoogleToken — custom path (launchWebAuthFlow)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGoogleClientId = 'custom-client-id-123.apps.googleusercontent.com';
    _resetForTesting();
  });

  it('returns token from launchWebAuthFlow redirect URL', async () => {
    mockLaunchWebAuthFlow.mockResolvedValue(
      'https://abcdefg.chromiumapp.org/#access_token=web-auth-token&token_type=Bearer&expires_in=3600',
    );

    const token = await getGoogleToken(['https://www.googleapis.com/auth/gmail.readonly']);
    expect(token).toBe('web-auth-token');
    expect(mockLaunchWebAuthFlow).toHaveBeenCalledOnce();
    expect(mockGetAuthToken).not.toHaveBeenCalled();

    // Verify the auth URL
    const callArgs = mockLaunchWebAuthFlow.mock.calls[0][0];
    expect(callArgs.url).toContain('client_id=custom-client-id-123');
    expect(callArgs.url).toContain('response_type=token');
    expect(callArgs.interactive).toBe(true);
  });

  it('caches token and reuses on subsequent calls', async () => {
    mockLaunchWebAuthFlow.mockResolvedValue(
      'https://abcdefg.chromiumapp.org/#access_token=cached-token&token_type=Bearer',
    );

    const token1 = await getGoogleToken(['scope1']);
    const token2 = await getGoogleToken(['scope1']);

    expect(token1).toBe('cached-token');
    expect(token2).toBe('cached-token');
    expect(mockLaunchWebAuthFlow).toHaveBeenCalledOnce(); // Only one call — second was cached
  });

  it('throws when flow is cancelled (no URL returned)', async () => {
    mockLaunchWebAuthFlow.mockResolvedValue(undefined);

    await expect(getGoogleToken(['scope'])).rejects.toThrow('cancelled');
  });

  it('throws when response has no fragment', async () => {
    mockLaunchWebAuthFlow.mockResolvedValue('https://abcdefg.chromiumapp.org/');

    await expect(getGoogleToken(['scope'])).rejects.toThrow('missing token fragment');
  });

  it('throws with error message from response', async () => {
    mockLaunchWebAuthFlow.mockResolvedValue('https://abcdefg.chromiumapp.org/#error=access_denied');

    await expect(getGoogleToken(['scope'])).rejects.toThrow('access_denied');
  });
});

describe('removeCachedToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
  });

  it('removes from Chrome cache for default path', async () => {
    mockRemoveCachedAuthToken.mockResolvedValue(undefined);

    await removeCachedToken('old-token');
    expect(mockRemoveCachedAuthToken).toHaveBeenCalledWith({ token: 'old-token' });
  });

  it('removes from webAuthFlow cache when token matches', async () => {
    webAuthTokenCache.set('scope1', { token: 'web-token', expiresAt: Date.now() + 60000 });

    await removeCachedToken('web-token');
    expect(webAuthTokenCache.has('scope1')).toBe(false);
    expect(mockRemoveCachedAuthToken).not.toHaveBeenCalled();
  });
});

describe('googleFetch', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGoogleClientId = undefined;
    _resetForTesting();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    mockGetAuthToken.mockResolvedValue({ token: 'mock-token' });
    mockRemoveCachedAuthToken.mockResolvedValue(undefined);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('fetches with Bearer token and parses JSON', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: 'hello' }), { status: 200 }),
    );

    const result = await googleFetch<{ data: string }>('https://api.example.com/test', ['scope1']);

    expect(result).toEqual({ data: 'hello' });
    const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer mock-token');
  });

  it('retries once on 401', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await googleFetch<{ ok: boolean }>('https://api.example.com/test', ['scope1']);

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws on non-401 error', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('Forbidden', { status: 403, statusText: 'Forbidden' }),
    );

    await expect(googleFetch('https://api.example.com/test', ['scope1'])).rejects.toThrow(
      'Google API error 403',
    );
  });

  it('does not retry 401 more than once', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
    fetchSpy.mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
    );

    await expect(googleFetch('https://api.example.com/test', ['scope1'])).rejects.toThrow(
      'Google API error 401',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('getGoogleUserEmail', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGoogleClientId = undefined;
    _resetForTesting();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    mockGetAuthToken.mockResolvedValue({ token: 'email-token' });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns the connected email', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ email: 'user@gmail.com' }), { status: 200 }),
    );

    const email = await getGoogleUserEmail();
    expect(email).toBe('user@gmail.com');
  });
});

describe('googleFetch — additional coverage', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGoogleClientId = undefined;
    _resetForTesting();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    mockGetAuthToken.mockResolvedValue({ token: 'mock-token' });
    mockRemoveCachedAuthToken.mockResolvedValue(undefined);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('includes error body text in thrown error message', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{"error": {"message": "Insufficient permissions"}}', {
        status: 403,
        statusText: 'Forbidden',
      }),
    );

    await expect(googleFetch('https://api.example.com/test', ['scope'])).rejects.toThrow(
      'Google API error 403',
    );
  });

  it('passes extra fetch options through', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await googleFetch('https://api.example.com/test', ['scope'], {
      method: 'POST',
      body: JSON.stringify({ data: 'test' }),
    });

    const fetchOpts = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(fetchOpts.method).toBe('POST');
    expect(fetchOpts.body).toBe(JSON.stringify({ data: 'test' }));
  });
});

describe('webAuthFlow token cache expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGoogleClientId = 'custom-client-id.apps.googleusercontent.com';
    _resetForTesting();
  });

  it('re-fetches token when cached token has expired', async () => {
    // First call — gets token
    mockLaunchWebAuthFlow.mockResolvedValueOnce(
      'https://abcdefg.chromiumapp.org/#access_token=first-token&token_type=Bearer&expires_in=1',
    );

    const token1 = await getGoogleToken(['scope-expire']);
    expect(token1).toBe('first-token');

    // Manually expire the cached token
    const cached = webAuthTokenCache.get('scope-expire');
    if (cached) {
      cached.expiresAt = Date.now() - 1000; // expired
    }

    // Second call — should re-fetch due to expiry
    mockLaunchWebAuthFlow.mockResolvedValueOnce(
      'https://abcdefg.chromiumapp.org/#access_token=second-token&token_type=Bearer&expires_in=3600',
    );

    const token2 = await getGoogleToken(['scope-expire']);
    expect(token2).toBe('second-token');
    expect(mockLaunchWebAuthFlow).toHaveBeenCalledTimes(2);
  });
});
