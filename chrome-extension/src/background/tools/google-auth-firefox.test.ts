/**
 * Tests for google-auth.ts — Firefox-specific behavior.
 *
 * These tests verify that on Firefox (IS_FIREFOX=true):
 * - getGoogleToken throws if no custom client ID is configured
 * - getGoogleToken works via launchWebAuthFlow when client ID IS set
 * - removeCachedToken does NOT call chrome.identity.removeCachedAuthToken
 * - revokeGoogleAccess skips Chrome-only getAuthToken/removeCachedAuthToken
 *
 * NOTE: These tests will fail until google-auth.ts is updated with IS_FIREFOX guards.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock IS_FIREFOX = true ──
vi.mock('@extension/env', () => ({
  IS_FIREFOX: true,
  IS_DEV: false,
  IS_PROD: true,
  IS_CI: false,
  default: {},
}));

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
    runtime: { lastError: undefined },
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
  revokeGoogleAccess,
  webAuthTokenCache,
  _resetForTesting,
} = await import('./google-auth');

describe('getGoogleToken — Firefox path (IS_FIREFOX=true)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
  });

  it('throws with clear error when no custom client ID is configured', async () => {
    mockGoogleClientId = undefined;
    _resetForTesting();

    await expect(getGoogleToken(['scope'])).rejects.toThrow(
      'Google tools require a Google Client ID on Firefox',
    );
    expect(mockGetAuthToken).not.toHaveBeenCalled();
  });

  it('uses launchWebAuthFlow when custom client ID is set', async () => {
    mockGoogleClientId = 'firefox-client-id.apps.googleusercontent.com';
    _resetForTesting();

    mockLaunchWebAuthFlow.mockResolvedValue(
      'https://abcdefg.chromiumapp.org/#access_token=ff-token&token_type=Bearer',
    );

    const token = await getGoogleToken(['scope']);
    expect(token).toBe('ff-token');
    expect(mockLaunchWebAuthFlow).toHaveBeenCalled();
    expect(mockGetAuthToken).not.toHaveBeenCalled();
  });
});

describe('removeCachedToken — Firefox path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
  });

  it('does NOT call chrome.identity.removeCachedAuthToken on Firefox', async () => {
    // Token not in webAuthFlow cache — on Chrome this would call removeCachedAuthToken
    await removeCachedToken('some-token');
    expect(mockRemoveCachedAuthToken).not.toHaveBeenCalled();
  });

  it('still clears webAuthFlow cache entries', async () => {
    webAuthTokenCache.set('scope1', { token: 'cached-token', expiresAt: Date.now() + 60000 });

    await removeCachedToken('cached-token');
    expect(webAuthTokenCache.has('scope1')).toBe(false);
    expect(mockRemoveCachedAuthToken).not.toHaveBeenCalled();
  });
});

describe('revokeGoogleAccess — Firefox path', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('skips getAuthToken/removeCachedAuthToken on Firefox', async () => {
    await revokeGoogleAccess();

    expect(mockGetAuthToken).not.toHaveBeenCalled();
    expect(mockRemoveCachedAuthToken).not.toHaveBeenCalled();
  });

  it('still revokes webAuthFlow tokens via HTTP', async () => {
    webAuthTokenCache.set('scope1', { token: 'web-token', expiresAt: Date.now() + 60000 });

    await revokeGoogleAccess();

    // Should have called fetch to revoke the webAuthFlow token
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/revoke',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(webAuthTokenCache.size).toBe(0);
  });
});
