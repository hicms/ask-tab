/**
 * Shared OAuth helper for Google Workspace tools.
 *
 * Dual-path auth:
 * - Default: chrome.identity.getAuthToken() — uses the manifest's oauth2.client_id
 *   (built from CEB_GOOGLE_CLIENT_ID env var). Seamless, Chrome-managed tokens.
 * - Custom: chrome.identity.launchWebAuthFlow() — uses a user-provided client ID
 *   from ToolConfig.googleClientId. Requires manual OAuth URL construction + token parsing.
 */

import { createLogger } from '../logging/logger-buffer';
import { IS_FIREFOX } from '@extension/env';
import { toolConfigStorage } from '@extension/storage';

const gLog = createLogger('tool');

// ── Token cache for launchWebAuthFlow path ──

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Cache keyed by sorted scope string. TTL ~55 min (tokens last 60 min). */
const webAuthTokenCache = new Map<string, CachedToken>();
const TOKEN_TTL_MS = 55 * 60 * 1000;

const GOOGLE_FETCH_TIMEOUT_MS = 30_000;

const scopeCacheKey = (scopes: string[]): string => [...scopes].sort().join(' ');

// ── Cached googleClientId (avoids reading storage on every token call) ──

let cachedGoogleClientId: string | undefined;
let clientIdLoaded = false;

/** Load and cache the googleClientId from storage. Subscribe to changes. */
const getGoogleClientId = async (): Promise<string | undefined> => {
  if (!clientIdLoaded) {
    const config = await toolConfigStorage.get();
    cachedGoogleClientId = config.googleClientId;
    clientIdLoaded = true;
    // Subscribe to future changes
    toolConfigStorage.subscribe(() => {
      toolConfigStorage
        .get()
        .then(c => {
          cachedGoogleClientId = c.googleClientId;
        })
        .catch(() => {});
    });
  }
  return cachedGoogleClientId;
};

// ── launchWebAuthFlow path ──

/**
 * Get a token via launchWebAuthFlow using a user-provided client ID.
 * Opens a Google OAuth consent page, parses the access_token from the redirect URL.
 */
const getTokenViaWebAuthFlow = async (
  clientId: string,
  scopes: string[],
  interactive: boolean,
): Promise<string> => {
  // Check cache first
  const cacheKey = scopeCacheKey(scopes);
  const cached = webAuthTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const redirectUrl = chrome.identity.getRedirectURL();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUrl,
    response_type: 'token',
    scope: scopes.join(' '),
  });
  if (!interactive) {
    params.set('prompt', 'none');
  }

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive,
  });

  if (!responseUrl) {
    throw new Error('Google auth flow was cancelled or returned no URL');
  }

  // Parse access_token from URL fragment: ...#access_token=TOKEN&token_type=Bearer&expires_in=3600
  const fragment = responseUrl.split('#')[1];
  if (!fragment) {
    throw new Error('Google auth response missing token fragment');
  }

  const fragParams = new URLSearchParams(fragment);
  const token = fragParams.get('access_token');
  if (!token) {
    const error = fragParams.get('error');
    throw new Error(error ? `Google auth error: ${error}` : 'No access_token in auth response');
  }

  // Cache the token
  webAuthTokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });

  return token;
};

// ── Public API ──

/**
 * Acquire an OAuth token for the given scopes.
 * Routes to getAuthToken (manifest client ID) or launchWebAuthFlow (custom client ID).
 */
const getGoogleToken = async (scopes: string[], interactive = true): Promise<string> => {
  const customClientId = await getGoogleClientId();

  // Firefox does not support chrome.identity.getAuthToken — require custom client ID
  if (IS_FIREFOX && !customClientId) {
    throw new Error(
      'Google tools require a Google Client ID on Firefox. ' +
        'Set a custom client ID in Settings → Tools → Google Client ID.',
    );
  }

  const authPath = customClientId ? 'webAuthFlow' : 'getAuthToken';
  gLog.trace('[google] getToken', { path: authPath, scopes, interactive });

  if (customClientId) {
    const token = await getTokenViaWebAuthFlow(customClientId, scopes, interactive);
    gLog.trace('[google] token acquired', { path: authPath, tokenSuffix: '…' + token.slice(-4) });
    return token;
  }

  // Default path: chrome.identity.getAuthToken
  const result = await chrome.identity.getAuthToken({ interactive, scopes });
  const token = result.token;
  if (!token) {
    throw new Error('Failed to get Google auth token');
  }
  gLog.trace('[google] token acquired', { path: authPath, tokenSuffix: '…' + token.slice(-4) });
  return token;
};

/** Remove a cached auth token (used on 401 before retry or for disconnect). */
const removeCachedToken = async (token: string): Promise<void> => {
  // Remove from webAuthFlow cache
  for (const [key, cached] of webAuthTokenCache) {
    if (cached.token === token) {
      webAuthTokenCache.delete(key);
      return;
    }
  }
  // Remove from Chrome's built-in cache (not available on Firefox)
  if (!IS_FIREFOX && typeof chrome.identity?.removeCachedAuthToken === 'function') {
    await chrome.identity.removeCachedAuthToken({ token });
  }
};

/** Revoke Google access by clearing all cached tokens. */
const revokeGoogleAccess = async (): Promise<void> => {
  // Clear webAuthFlow cache
  for (const cached of webAuthTokenCache.values()) {
    await fetch('https://accounts.google.com/o/oauth2/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${cached.token}`,
    }).catch(() => {});
  }
  webAuthTokenCache.clear();

  // Clear Chrome's built-in cache (not available on Firefox)
  if (!IS_FIREFOX) {
    try {
      const result = await chrome.identity.getAuthToken({ interactive: false });
      const token = result.token;
      if (!token) return;
      await chrome.identity.removeCachedAuthToken({ token });
      await fetch('https://accounts.google.com/o/oauth2/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${token}`,
      }).catch(() => {});
    } catch {
      // No token cached
    }
  }
};

/**
 * Fetch a Google API endpoint with automatic Bearer token injection.
 * Retries once on 401 (expired token) by removing the cached token and re-acquiring.
 */
const googleFetch = async <T>(url: string, scopes: string[], init?: RequestInit): Promise<T> => {
  const attempt = async (isRetry: boolean): Promise<T> => {
    const token = await getGoogleToken(scopes);

    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);

    const timeoutSignal = AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS);
    const signal = init?.signal ? AbortSignal.any([timeoutSignal, init.signal]) : timeoutSignal;

    const response = await fetch(url, {
      ...init,
      headers,
      signal,
    });

    if (response.status === 401 && !isRetry) {
      gLog.trace('[google] 401 — removing cached token and retrying', { url });
      await removeCachedToken(token);
      return attempt(true);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const msg = `Google API error ${response.status}: ${response.statusText} — ${body.slice(0, 200)}`;
      gLog.error('[google] request failed', {
        url,
        status: response.status,
        body: body.slice(0, 300),
      });
      throw new Error(msg);
    }

    return response.json() as Promise<T>;
  };

  return attempt(false);
};

/**
 * Like googleFetch but returns the raw Response instead of parsing JSON.
 * Used for endpoints that return non-JSON (text, binary, 204 No Content).
 * Includes the same 401 retry logic.
 */
const googleFetchRaw = async (
  url: string,
  scopes: string[],
  init?: RequestInit,
): Promise<Response> => {
  const attempt = async (isRetry: boolean): Promise<Response> => {
    const token = await getGoogleToken(scopes);

    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);

    const timeoutSignal = AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS);
    const signal = init?.signal ? AbortSignal.any([timeoutSignal, init.signal]) : timeoutSignal;

    const response = await fetch(url, {
      ...init,
      headers,
      signal,
    });

    if (response.status === 401 && !isRetry) {
      gLog.trace('[google] 401 — removing cached token and retrying', { url });
      await removeCachedToken(token);
      return attempt(true);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const msg = `Google API error ${response.status}: ${response.statusText} — ${body.slice(0, 200)}`;
      gLog.error('[google] request failed', {
        url,
        status: response.status,
        body: body.slice(0, 300),
      });
      throw new Error(msg);
    }

    return response;
  };

  return attempt(false);
};

/** Get the email address of the connected Google account. */
const getGoogleUserEmail = async (): Promise<string> => {
  const info = await googleFetch<{ email: string }>(
    'https://www.googleapis.com/oauth2/v1/userinfo?alt=json',
    ['https://www.googleapis.com/auth/userinfo.email'],
  );
  return info.email;
};

/** Reset cached state — exported for testing only. */
const _resetForTesting = () => {
  webAuthTokenCache.clear();
  cachedGoogleClientId = undefined;
  clientIdLoaded = false;
};

export {
  getGoogleToken,
  removeCachedToken,
  revokeGoogleAccess,
  googleFetch,
  googleFetchRaw,
  getGoogleUserEmail,
  // Exported for testing
  webAuthTokenCache,
  _resetForTesting,
};
