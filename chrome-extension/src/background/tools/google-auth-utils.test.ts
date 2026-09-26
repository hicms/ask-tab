/**
 * Tests for google-auth.ts — token acquisition, caching, and fetch helpers.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Chrome identity mock ──
const chromeIdentityMock = {
  getAuthToken: vi.fn(async () => ({ token: 'chrome-token-123' })),
  removeCachedAuthToken: vi.fn(async () => {}),
  launchWebAuthFlow: vi.fn(
    async () => 'https://redirect#access_token=web-token-456&token_type=Bearer',
  ),
  getRedirectURL: vi.fn(() => 'https://redirect'),
};

beforeAll(() => {
  Object.defineProperty(globalThis, 'chrome', {
    value: {
      identity: chromeIdentityMock,
      runtime: { onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
    },
    writable: true,
    configurable: true,
  });
});

// ── Module mocks ──

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  }),
}));

vi.mock('@extension/storage', () => ({
  toolConfigStorage: {
    get: vi.fn(async () => ({ googleClientId: undefined })),
    subscribe: vi.fn(),
  },
}));

// Store original fetch
const originalFetch = globalThis.fetch;

describe('google-auth', () => {
  let getGoogleToken: typeof import('./google-auth').getGoogleToken;
  let removeCachedToken: typeof import('./google-auth').removeCachedToken;
  let revokeGoogleAccess: typeof import('./google-auth').revokeGoogleAccess;
  let googleFetch: typeof import('./google-auth').googleFetch;
  let googleFetchRaw: typeof import('./google-auth').googleFetchRaw;
  let _resetForTesting: typeof import('./google-auth')._resetForTesting;
  let webAuthTokenCache: typeof import('./google-auth').webAuthTokenCache;

  beforeEach(async () => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();

    // Reset modules to get fresh state
    vi.resetModules();
    const mod = await import('./google-auth');
    getGoogleToken = mod.getGoogleToken;
    removeCachedToken = mod.removeCachedToken;
    revokeGoogleAccess = mod.revokeGoogleAccess;
    googleFetch = mod.googleFetch;
    googleFetchRaw = mod.googleFetchRaw;
    _resetForTesting = mod._resetForTesting;
    webAuthTokenCache = mod.webAuthTokenCache;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── getGoogleToken (default path: getAuthToken) ──

  describe('getGoogleToken', () => {
    it('returns token via chrome.identity.getAuthToken (default path)', async () => {
      const token = await getGoogleToken(['https://www.googleapis.com/auth/drive']);
      expect(token).toBe('chrome-token-123');
      expect(chromeIdentityMock.getAuthToken).toHaveBeenCalledWith({
        interactive: true,
        scopes: ['https://www.googleapis.com/auth/drive'],
      });
    });

    it('throws when getAuthToken returns no token', async () => {
      chromeIdentityMock.getAuthToken.mockResolvedValueOnce({ token: '' });
      await expect(getGoogleToken(['https://www.googleapis.com/auth/drive'])).rejects.toThrow(
        'Failed to get Google auth token',
      );
    });

    it('uses launchWebAuthFlow when custom clientId is configured', async () => {
      _resetForTesting();
      const { toolConfigStorage } = await import('@extension/storage');
      vi.mocked(toolConfigStorage.get).mockResolvedValue({
        googleClientId: 'custom-client-id',
        enabledTools: [],
        webSearchConfig: {
          provider: 'server',
          browser: { engine: 'google' },
        },
      } as never);

      const token = await getGoogleToken(['https://www.googleapis.com/auth/drive']);
      expect(token).toBe('web-token-456');
      expect(chromeIdentityMock.launchWebAuthFlow).toHaveBeenCalled();
    });
  });

  // ── removeCachedToken ──

  describe('removeCachedToken', () => {
    it('removes token from webAuthFlow cache if found', async () => {
      webAuthTokenCache.set('scope1', {
        token: 'cached-web-token',
        expiresAt: Date.now() + 60_000,
      });

      await removeCachedToken('cached-web-token');
      expect(webAuthTokenCache.has('scope1')).toBe(false);
    });

    it('removes token from Chrome cache if not in webAuth cache', async () => {
      await removeCachedToken('chrome-only-token');
      expect(chromeIdentityMock.removeCachedAuthToken).toHaveBeenCalledWith({
        token: 'chrome-only-token',
      });
    });
  });

  // ── revokeGoogleAccess ──

  describe('revokeGoogleAccess', () => {
    it('clears webAuth cache and revokes tokens', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
      webAuthTokenCache.set('scope1', {
        token: 'web-token-to-revoke',
        expiresAt: Date.now() + 60_000,
      });

      await revokeGoogleAccess();

      expect(webAuthTokenCache.size).toBe(0);
      // Should have revoked via Google endpoint
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://accounts.google.com/o/oauth2/revoke',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('handles errors gracefully when revoking Chrome token', async () => {
      chromeIdentityMock.getAuthToken.mockRejectedValueOnce(new Error('No token'));
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

      // Should not throw
      await revokeGoogleAccess();
    });
  });

  // ── googleFetch ──

  describe('googleFetch', () => {
    it('returns parsed JSON on success', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ email: 'test@example.com' }),
      });

      const result = await googleFetch<{ email: string }>(
        'https://www.googleapis.com/oauth2/v1/userinfo',
        ['https://www.googleapis.com/auth/userinfo.email'],
      );
      expect(result.email).toBe('test@example.com');
    });

    it('retries on 401 by removing cached token', async () => {
      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      // First call: 401
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Token expired'),
      });
      // Second call after token refresh: success
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: 'refreshed' }),
      });

      const result = await googleFetch<{ data: string }>('https://www.googleapis.com/api', [
        'scope',
      ]);
      expect(result.data).toBe('refreshed');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('throws on non-401 error', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: () => Promise.resolve('Insufficient permissions'),
      });

      await expect(googleFetch('https://api.example.com', ['scope'])).rejects.toThrow(
        'Google API error 403',
      );
    });

    it('throws on 401 retry that also fails', async () => {
      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('expired'),
      });
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('still expired'),
      });

      await expect(googleFetch('https://api.example.com', ['scope'])).rejects.toThrow(
        'Google API error 401',
      );
    });
  });

  // ── googleFetchRaw ──

  describe('googleFetchRaw', () => {
    it('returns raw Response on success', async () => {
      const mockResponse = { ok: true, status: 200, text: () => Promise.resolve('raw content') };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await googleFetchRaw('https://www.googleapis.com/api/resource', ['scope']);
      expect(result).toBe(mockResponse);
    });

    it('retries on 401 by removing cached token', async () => {
      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('expired'),
      });
      const successResponse = { ok: true, status: 200 };
      fetchMock.mockResolvedValueOnce(successResponse);

      const result = await googleFetchRaw('https://api.example.com', ['scope']);
      expect(result).toBe(successResponse);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('throws on non-401 error', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Server error'),
      });

      await expect(googleFetchRaw('https://api.example.com', ['scope'])).rejects.toThrow(
        'Google API error 500',
      );
    });
  });
});
