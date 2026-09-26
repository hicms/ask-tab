import { Value } from '@sinclair/typebox/value';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTabsCreate = vi.fn(async () => ({ id: 99, status: 'complete' as const }));
const mockTabsQuery = vi.fn(async () => [] as chrome.tabs.Tab[]);
const mockTabsRemove = vi.fn(async () => undefined);
const mockExecuteScript = vi.fn(async () => [
  { result: { text: 'Page response', title: 'Page', status: 200, mimeType: 'text/html' } },
]);

Object.defineProperty(globalThis, 'chrome', {
  value: {
    tabs: { create: mockTabsCreate, query: mockTabsQuery, remove: mockTabsRemove },
    scripting: { executeScript: mockExecuteScript },
  },
  writable: true,
  configurable: true,
});

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({ trace: vi.fn() }),
}));

const { executeWebFetch, executeBrowserAwareWebFetch, webFetchSchema, FETCH_CACHE } = await import(
  './web-fetch'
);

describe('web_fetch HTTP methods and parameters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();
    FETCH_CACHE.clear();
  });

  it('accepts the supported methods and structured fields in the tool schema', () => {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(Value.Check(webFetchSchema, { url: 'https://example.com', method })).toBe(true);
    }
    expect(Value.Check(webFetchSchema, { url: 'https://example.com', method: 'TRACE' })).toBe(
      false,
    );
    expect(
      Value.Check(webFetchSchema, {
        url: 'https://example.com',
        params: { tag: ['a', 'b'], page: 2 },
        json: { enabled: true },
      }),
    ).toBe(true);
  });

  it('merges query params into a browser page GET', async () => {
    await executeBrowserAwareWebFetch({
      url: 'https://example.com/search?keep=1&old=value',
      params: { old: null, q: 'hello world', tag: ['a', 'b'], page: 2, active: true },
    });

    expect(mockTabsCreate).toHaveBeenCalledWith({
      url: 'https://example.com/search?keep=1&q=hello+world&tag=a&tag=b&page=2&active=true',
      active: false,
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockTabsRemove).toHaveBeenCalledWith(99);
  });

  it.each(['PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const)(
    'sends %s with query params through HTTP fetch and preserves JSON responses',
    async method => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }),
      );

      const result = await executeBrowserAwareWebFetch({
        url: 'https://api.example.com/items',
        method,
        params: { id: 3 },
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/items?id=3',
        expect.objectContaining({ method }),
      );
      expect(result).toMatchObject({
        text: '{"ok":true}',
        status: 200,
        mimeType: 'application/json',
      });
      expect(mockTabsCreate).not.toHaveBeenCalled();
    },
  );

  it('returns HEAD status and metadata without reading a body', async () => {
    const readBody = vi.fn();
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 204,
      headers: {
        get: (key: string) =>
          ({ 'content-type': 'application/json; charset=utf-8', 'content-length': '42' })[key] ??
          null,
      },
      text: readBody,
    } as unknown as Response);

    const result = await executeBrowserAwareWebFetch({
      url: 'https://api.example.com/items',
      method: 'HEAD',
    });

    expect(result).toMatchObject({
      text: '',
      status: 204,
      mimeType: 'application/json',
      sizeBytes: 42,
    });
    expect(readBody).not.toHaveBeenCalled();
    expect(mockTabsCreate).not.toHaveBeenCalled();
  });

  it('serializes JSON and adds a content type', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response('{"id":1}'));
    await executeWebFetch({
      url: 'https://api.example.com/items',
      method: 'POST',
      json: { name: 'Alice', tags: ['a', 'b'] },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/items',
      expect.objectContaining({
        method: 'POST',
        body: '{"name":"Alice","tags":["a","b"]}',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('serializes repeated form fields and respects an explicit content type', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response('saved'));
    await executeWebFetch({
      url: 'https://api.example.com/items',
      method: 'PATCH',
      form: { tag: ['red', 'blue'], count: 2, optional: null },
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/items',
      expect.objectContaining({
        method: 'PATCH',
        body: 'tag=red&tag=blue&count=2',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }),
    );
  });

  it('sets the default URL-encoded form content type', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response('saved'));
    await executeWebFetch({
      url: 'https://api.example.com/items',
      method: 'POST',
      form: { name: 'Alice Smith' },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/items',
      expect.objectContaining({
        body: 'name=Alice+Smith',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      }),
    );
  });

  it('preserves query parameter case in GET cache keys', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response('uppercase response'))
      .mockResolvedValueOnce(new Response('lowercase response'));

    const upper = await executeWebFetch({
      url: 'https://api.example.com/items',
      params: { token: 'AbC' },
    });
    const lower = await executeWebFetch({
      url: 'https://api.example.com/items',
      params: { token: 'abc' },
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(upper.text).toBe('uppercase response');
    expect(lower.text).toBe('lowercase response');
  });

  it('rejects conflicting body fields and GET or HEAD bodies', async () => {
    expect(
      (await executeWebFetch({ url: 'https://example.com', method: 'POST', body: 'x', json: {} }))
        .error,
    ).toContain('only one');
    expect((await executeWebFetch({ url: 'https://example.com', json: {} })).error).toContain(
      'GET requests cannot have a body',
    );
    expect(
      (await executeWebFetch({ url: 'https://example.com', method: 'HEAD', form: { a: 1 } })).error,
    ).toContain('HEAD requests cannot have a body');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('passes an explicit credential policy through HTTP fetch', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response('plain response'));
    const result = await executeBrowserAwareWebFetch({
      url: 'https://api.example.com/items',
      credentials: 'include',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/items',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(result.text).toBe('plain response');
    expect(mockTabsCreate).not.toHaveBeenCalled();
  });
});
