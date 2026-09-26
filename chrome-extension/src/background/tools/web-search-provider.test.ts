/**
 * Tests for web-search.ts — pure utilities and the provider dispatcher.
 */

// Import after mocks
import {
  buildSearchUrl,
  sanitizeQuery,
  simplifyQuery,
  executeWebSearch,
  SEARCH_CACHE,
} from './web-search';
import { requestAuthorized } from '../ask-service/client';
import { askSessionStorage, toolConfigStorage } from '@extension/storage';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolConfig } from '@extension/storage';

// ── Mocks ────────────────────────────────────────────────

vi.mock('./browser', () => ({
  executeBrowser: vi.fn(),
}));

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  }),
}));

vi.mock('../ask-service/client', () => ({
  requestAuthorized: vi.fn(),
}));

vi.mock('@extension/storage', () => ({
  askSessionStorage: { get: vi.fn() },
  toolConfigStorage: {
    get: vi.fn(),
  },
}));

// ── Tests ────────────────────────────────────────────────

describe('web-search utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requestAuthorized).mockReset();
    SEARCH_CACHE.clear();
    vi.mocked(askSessionStorage.get).mockResolvedValue({ token: 'a-token', email: 'a@b.c' });
  });

  // ── buildSearchUrl ──

  describe('buildSearchUrl', () => {
    it('returns Google search URL', () => {
      const url = buildSearchUrl('google', 'hello world');
      expect(url).toBe('https://www.google.com/search?q=hello%20world');
    });

    it('returns Bing search URL', () => {
      const url = buildSearchUrl('bing', 'test query');
      expect(url).toBe('https://www.bing.com/search?q=test%20query');
    });

    it('returns DuckDuckGo search URL', () => {
      const url = buildSearchUrl('duckduckgo', 'privacy search');
      expect(url).toBe('https://html.duckduckgo.com/html/?q=privacy%20search');
    });
  });

  // ── sanitizeQuery ──

  describe('sanitizeQuery', () => {
    it('replaces smart quotes with regular quotes', () => {
      const result = sanitizeQuery('\u201chello\u201d \u2018world\u2019');
      expect(result).toBe('"hello" "world"');
    });

    it('removes excess quoted phrases (keeps max 2)', () => {
      const result = sanitizeQuery('"one" "two" "three" "four"');
      expect(result).toBe('"one" "two" three four');
    });

    it('truncates at word boundary when >200 chars', () => {
      const longQuery = 'word '.repeat(50); // 250 chars
      const result = sanitizeQuery(longQuery);
      expect(result.length).toBeLessThanOrEqual(200);
      // Should end with a complete word (no trailing space after truncation)
      expect(result).toBe(result.trim());
    });

    it('returns trimmed result', () => {
      expect(sanitizeQuery('  hello  ')).toBe('hello');
    });
  });

  // ── simplifyQuery ──

  describe('simplifyQuery', () => {
    it('removes quotes from quoted phrases', () => {
      const result = simplifyQuery('"hello world" test');
      expect(result).toBe('hello world test');
    });

    it('strips special characters (keeps word chars, spaces, hyphens)', () => {
      const result = simplifyQuery('hello!@#$% world-test');
      expect(result).toBe('hello world-test');
    });

    it('truncates to ~100 chars at word boundary', () => {
      const longQuery = 'word '.repeat(25); // 125 chars
      const result = simplifyQuery(longQuery);
      expect(result.length).toBeLessThanOrEqual(100);
    });

    it('collapses whitespace', () => {
      const result = simplifyQuery('hello   world');
      expect(result).toBe('hello world');
    });
  });

  // ── executeWebSearch ──

  describe('executeWebSearch', () => {
    const serverConfig: ToolConfig = {
      enabledTools: {},
      webSearchConfig: { provider: 'server', browser: { engine: 'google' } },
    };
    const serverResults = (results: unknown[]) =>
      new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    beforeEach(() => {
      vi.mocked(toolConfigStorage.get).mockResolvedValue(serverConfig);
    });

    it('returns cached results on cache hit', async () => {
      const cachedResults = [{ title: 'Cached', url: 'https://cached.com', snippet: 'cached' }];
      vi.mocked(requestAuthorized).mockResolvedValue(serverResults(cachedResults));
      await executeWebSearch({ query: 'test query' });
      vi.mocked(requestAuthorized).mockClear();
      const results = await executeWebSearch({ query: 'test query' });
      expect(results).toEqual(cachedResults);
      expect(requestAuthorized).not.toHaveBeenCalled();
    });

    it('does not return an old cached result after a session switch during lookup', async () => {
      vi.mocked(requestAuthorized).mockResolvedValueOnce(
        serverResults([{ title: 'Old', url: 'https://old.test', snippet: '' }]),
      );
      await executeWebSearch({ query: 'cached while switching' });
      const old = { token: 'a-token', userId: 'a', email: 'a@b.c', expiresAt: Date.now() + 60_000 };
      const newer = { ...old, token: 'b-token', userId: 'b' };
      vi.mocked(askSessionStorage.get).mockResolvedValueOnce(old).mockResolvedValue(newer);
      await expect(executeWebSearch({ query: 'cached while switching' })).rejects.toThrow(
        'Account changed during search',
      );
    });

    it('does not reuse a server result from another account', async () => {
      vi.mocked(requestAuthorized)
        .mockResolvedValueOnce(serverResults([{ title: 'A', url: 'https://a.test', snippet: '' }]))
        .mockResolvedValueOnce(serverResults([{ title: 'B', url: 'https://b.test', snippet: '' }]));

      expect((await executeWebSearch({ query: 'same query' }))[0].title).toBe('A');
      vi.mocked(askSessionStorage.get).mockResolvedValue({ token: 'b-token', email: 'b@b.c' });
      expect((await executeWebSearch({ query: 'same query' }))[0].title).toBe('B');
      expect(requestAuthorized).toHaveBeenCalledTimes(2);
    });

    it('does not serve a cached server result after sign-out', async () => {
      vi.mocked(requestAuthorized).mockResolvedValueOnce(
        serverResults([{ title: 'A', url: 'https://a.test', snippet: '' }]),
      );
      await executeWebSearch({ query: 'same query' });
      vi.mocked(askSessionStorage.get).mockResolvedValue(null);

      await expect(executeWebSearch({ query: 'same query' })).rejects.toThrow('Sign in first');
      expect(requestAuthorized).toHaveBeenCalledTimes(1);
    });

    it('discards a delayed result after the account changes', async () => {
      let finish!: (response: Response) => void;
      vi.mocked(requestAuthorized).mockImplementationOnce(
        () =>
          new Promise<Response>(resolve => {
            finish = resolve;
          }),
      );
      const pending = executeWebSearch({ query: 'delayed' });
      await vi.waitFor(() => expect(requestAuthorized).toHaveBeenCalledTimes(1));
      vi.mocked(askSessionStorage.get).mockResolvedValue({
        token: 'b-token',
        userId: 'b',
        email: 'b@b.c',
        expiresAt: Date.now() + 60_000,
      });
      finish(serverResults([{ title: 'Old account', url: 'https://a.test', snippet: '' }]));
      await expect(pending).rejects.toThrow('Account changed during search');
      expect(SEARCH_CACHE.size).toBe(0);
    });

    it('sends only the query and result count to the AskTab server', async () => {
      vi.mocked(requestAuthorized).mockResolvedValue(
        serverResults([{ title: 'T', url: 'https://t.com', snippet: 'S' }]),
      );

      const results = await executeWebSearch({ query: 'server test', maxResults: 3 });
      expect(results).toEqual([{ title: 'T', url: 'https://t.com', snippet: 'S' }]);
      const [path, init] = vi.mocked(requestAuthorized).mock.calls[0];
      expect(path).toBe('/api/search');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual({ query: 'server test', maxResults: 3 });
    });

    it('surfaces server errors to the tool call', async () => {
      vi.mocked(requestAuthorized).mockRejectedValue(new Error('Search provider unavailable'));
      await expect(executeWebSearch({ query: 'failing' })).rejects.toThrow(
        'Search provider unavailable',
      );
    });

    it('keeps browser and server caches separate', async () => {
      SEARCH_CACHE.set('browser:google:same query:5', {
        data: [{ title: 'Browser', url: 'https://b.com', snippet: '' }],
        timestamp: Date.now(),
      });
      vi.mocked(requestAuthorized).mockResolvedValue(
        serverResults([{ title: 'Server', url: 'https://s.com', snippet: '' }]),
      );

      expect((await executeWebSearch({ query: 'same query' }))[0].title).toBe('Server');
    });

    it('does not cache empty results', async () => {
      vi.mocked(requestAuthorized).mockResolvedValue(serverResults([]));

      const results = await executeWebSearch({ query: 'empty results test' });
      expect(results).toEqual([]);
      expect(SEARCH_CACHE.size).toBe(0);
    });
  });
});
