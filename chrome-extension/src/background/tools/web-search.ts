import { jsonFormatResult } from './tool-registration';
import {
  normalizeCacheKey,
  readCache,
  writeCache,
  withTimeout,
  DEFAULT_CACHE_TTL_MINUTES,
} from './web-shared';
import { requestAuthorized } from '../ask-service/client';
import { createLogger } from '../logging/logger-buffer';
import { askSessionStorage, toolConfigStorage } from '@extension/storage';
import { Type } from '@sinclair/typebox';
import type { ToolRegistration } from './tool-registration';
import type { CacheEntry } from './web-shared';
import type { BrowserSearchEngine, AskSession } from '@extension/storage';
import type { Static } from '@sinclair/typebox';

const searchLog = createLogger('tool');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const webSearchSchema = Type.Object({
  query: Type.String({ description: 'The search query' }),
  maxResults: Type.Optional(
    Type.Number({ description: 'Maximum number of results to return', default: 5 }),
  ),
});

type WebSearchArgs = Static<typeof webSearchSchema>;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const SEARCH_CACHE = new Map<string, CacheEntry<SearchResult[]>>();
const CACHE_TTL_MS = DEFAULT_CACHE_TTL_MINUTES * 60_000;
let lastServerSessionToken: string | null = null;
let serverCacheGeneration = 0;

// ---------------------------------------------------------------------------
// Server provider — the AskTab server holds the search API credentials
// ---------------------------------------------------------------------------

const runServerSearch = async (
  query: string,
  maxResults: number,
  session: AskSession,
): Promise<SearchResult[]> => {
  searchLog.trace('[server] request', { query, maxResults });
  const response = await requestAuthorized(
    '/api/search',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, maxResults }),
      signal: withTimeout(45),
    },
    session,
  );
  const data = (await response.json()) as { results?: SearchResult[] };
  const current = await askSessionStorage.get();
  if (
    current?.token !== session.token ||
    current.userId !== session.userId ||
    current.expiresAt <= Date.now()
  ) {
    throw new Error('Account changed during search');
  }
  searchLog.trace('[server] response', { count: data.results?.length ?? 0 });
  return data.results ?? [];
};

// ---------------------------------------------------------------------------
// Browser provider — tab + scripting APIs (no CDP / chrome.debugger needed)
// ---------------------------------------------------------------------------

const TAB_LOAD_TIMEOUT_MS = 15_000;

/** Wait for a tab to finish loading (status === 'complete'). */
const waitForTabLoad = async (tabId: number, timeoutMs = TAB_LOAD_TIMEOUT_MS): Promise<void> =>
  new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Page load timed out'));
    }, timeoutMs);

    const onUpdated = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        cleanup();
        resolve();
      }
    };

    const onRemoved = (removedTabId: number) => {
      if (removedTabId === tabId) {
        cleanup();
        reject(new Error('Tab was closed before loading completed'));
      }
    };

    // Register listeners FIRST, then check current status to close the TOCTOU race.
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);

    chrome.tabs
      .get(tabId)
      .then(tab => {
        if (tab.status === 'complete') {
          cleanup();
          resolve();
        }
      })
      .catch(() => {
        // Tab may have been removed — timeout will handle it
      });
  });

/** Evaluate a JS expression in a tab using chrome.scripting (no CDP). */
const scriptEvaluate = async (tabId: number, expression: string): Promise<string> => {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN' as chrome.scripting.ExecutionWorld, // MAIN world needed to eval in page context
    func: (expr: string) => {
      try {
        const result = eval(expr);
        if (result === undefined) return 'undefined';
        return typeof result === 'string' ? result : JSON.stringify(result);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    args: [expression],
  });
  return results?.[0]?.result ?? 'Error: No result from script evaluation';
};

/** Build the search URL for a given engine. */
const buildSearchUrl = (engine: BrowserSearchEngine, query: string): string => {
  const q = encodeURIComponent(query);
  switch (engine) {
    case 'google':
      return `https://www.google.com/search?q=${q}`;
    case 'bing':
      return `https://www.bing.com/search?q=${q}`;
    case 'duckduckgo':
      return `https://html.duckduckgo.com/html/?q=${q}`;
  }
};

/**
 * Build a generic, engine-agnostic JS expression that extracts search results
 * from any search engine page.
 *
 * Strategy: Instead of relying on engine-specific CSS class names (which
 * change frequently), we structurally find all external `<a>` links on the
 * page, filter out the search engine's own navigation/infrastructure links,
 * extract the title from the link text (or a heading inside/above the link),
 * and extract a snippet from the nearest parent container's text content.
 */
const getExtractionExpression = (maxResults: number): string => `
  (() => {
    const host = location.hostname;
    const skip = [
      'google.', 'gstatic.', 'googleapis.', 'youtube.com/results',
      'bing.com/aclick', 'bing.com/ck/', 'microsoft.com/en-us/bing',
      'duckduckgo.com', 'duck.com',
      'schema.org', 'w3.org', 'creativecommons.org',
      'accounts.google', 'support.google', 'maps.google',
      'policies.google', 'play.google',
    ];
    const results = [];
    const seen = new Set();

    for (const a of document.querySelectorAll('a[href]')) {
      if (results.length >= ${maxResults}) break;
      try {
        const url = new URL(a.href, location.href);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
        if (url.hostname === host) continue;
        if (skip.some(d => url.href.includes(d))) continue;

        const dedup = url.origin + url.pathname;
        if (seen.has(dedup)) continue;
        seen.add(dedup);

        const heading = a.querySelector('h1,h2,h3,h4') || a.closest('h1,h2,h3,h4');
        const title = (heading ? heading.innerText : a.innerText || '').trim();
        if (!title || title.length < 5 || title.startsWith('http')) continue;

        let snippet = '';
        let el = a.parentElement;
        for (let i = 0; i < 5 && el; i++) {
          const text = (el.innerText || '').trim();
          if (text.length > title.length + 20) {
            snippet = text
              .split('\\n')
              .filter(line => line.trim() && !line.includes(title) && !line.startsWith('http'))
              .join(' ')
              .substring(0, 300)
              .trim();
            break;
          }
          el = el.parentElement;
        }

        results.push({ title, url: url.href, snippet });
      } catch (_) {}
    }
    return JSON.stringify(results);
  })()
`;

// ---------------------------------------------------------------------------
// Query sanitization & simplification
// ---------------------------------------------------------------------------

const MAX_QUERY_LENGTH = 200;

/** Sanitize a query to reduce CAPTCHA / "unusual traffic" triggers. */
const sanitizeQuery = (query: string): string => {
  let q = query;
  // Replace smart quotes with regular quotes
  q = q.replace(/[\u201c\u201d\u2018\u2019]/g, '"');
  // Remove excessive quoted phrases (keep max 2)
  let quoteCount = 0;
  q = q.replace(/"[^"]*"/g, match => {
    quoteCount++;
    return quoteCount <= 2 ? match : match.replace(/"/g, '');
  });
  // Truncate to MAX_QUERY_LENGTH at word boundary
  if (q.length > MAX_QUERY_LENGTH) {
    q = q.slice(0, MAX_QUERY_LENGTH).replace(/\s\S*$/, '');
  }
  return q.trim();
};

/** Aggressively simplify a query for retry after initial search fails. */
const simplifyQuery = (query: string): string => {
  let q = query;
  // Remove quotes from all quoted phrases
  q = q.replace(/"[^"]*"/g, match => match.replace(/"/g, ''));
  // Strip special characters (keep word chars, spaces, hyphens)
  q = q.replace(/[^\w\s-]/g, ' ');
  q = q.replace(/\s+/g, ' ').trim();
  // Truncate to ~100 chars at word boundary
  if (q.length > 100) {
    q = q
      .slice(0, 100)
      .replace(/\s\S*$/, '')
      .trim();
  }
  return q;
};

// ---------------------------------------------------------------------------
// Page diagnostics (for debugging CAPTCHA / consent pages)
// ---------------------------------------------------------------------------

const PAGE_DIAGNOSTICS_EXPR = `JSON.stringify({ title: document.title, text: document.body?.innerText?.slice(0, 500) ?? '' })`;

/** Max number of polling attempts for search results to appear in DOM. */
const POLL_MAX_ATTEMPTS = 3;
/** Delay between polling attempts in milliseconds. */
const POLL_INTERVAL_MS = 1000;

/**
 * Poll the tab for search results up to `maxAttempts` times.
 * Returns parsed results on success, or `null` if all attempts returned empty.
 */
const pollForResults = async (
  tabId: number,
  expression: string,
  engine: BrowserSearchEngine,
  maxAttempts: number,
): Promise<SearchResult[] | null> => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    const evalResult = await scriptEvaluate(tabId, expression);
    searchLog.trace('[browser] evaluate attempt', {
      attempt: attempt + 1,
      rawLength: evalResult.length,
      rawPreview: evalResult.slice(0, 300),
    });

    if (evalResult.startsWith('Error:')) {
      throw new Error(`Browser search extraction failed: ${evalResult}`);
    }

    let parsed: Array<{ title: string; url: string; snippet: string }>;
    try {
      parsed = JSON.parse(evalResult) as Array<{
        title: string;
        url: string;
        snippet: string;
      }>;
    } catch {
      throw new Error(
        `Browser search: failed to parse results from ${engine} — raw output: ${evalResult.slice(0, 200)}`,
      );
    }

    searchLog.trace('[browser] parsed attempt', {
      attempt: attempt + 1,
      resultCount: parsed.length,
    });

    if (parsed.length > 0) {
      return parsed.map(r => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.snippet || '',
      }));
    }
  }
  return null;
};

const runBrowserSearch = async (
  query: string,
  maxResults: number,
  engine: BrowserSearchEngine,
): Promise<SearchResult[]> => {
  const sanitizedQuery = sanitizeQuery(query);
  const searchUrl = buildSearchUrl(engine, sanitizedQuery);
  searchLog.trace('[browser] starting search', {
    engine,
    searchUrl,
    originalQuery: query,
    sanitizedQuery,
  });

  // 1. Open a background tab directly with the search URL (no CDP needed)
  const openedTab = await chrome.tabs.create({ url: searchUrl, active: false });
  const tabId = openedTab.id ?? null;
  searchLog.trace('[browser] opened background tab', { tabId });
  if (tabId == null) {
    throw new Error('Browser search: failed to open tab — no tab ID returned');
  }

  try {
    // 2. Wait for the page to finish loading
    await waitForTabLoad(tabId);
    searchLog.trace('[browser] tab loaded', { tabId });

    // 3. Poll for results — search engines render results asynchronously via JS
    //    after load, so we retry extraction with a short delay.
    const expression = getExtractionExpression(maxResults);
    const results = await pollForResults(tabId, expression, engine, POLL_MAX_ATTEMPTS);

    if (results) {
      return results;
    }

    // 4. All poll attempts returned empty — collect diagnostics and retry with simplified query
    searchLog.warn('[browser] all poll attempts returned empty', {
      tabId,
      engine,
      attempts: POLL_MAX_ATTEMPTS,
      sanitizedQuery,
    });
    let diagnostics: string | undefined;
    try {
      diagnostics = await scriptEvaluate(tabId, PAGE_DIAGNOSTICS_EXPR);
    } catch {
      // Diagnostics are best-effort
    }

    searchLog.trace('[browser] initial search returned empty, retrying with simplified query', {
      engine,
      sanitizedQuery,
      diagnostics: diagnostics?.slice(0, 500),
    });

    const simplified = simplifyQuery(sanitizedQuery);
    if (simplified === sanitizedQuery || !simplified) {
      // Simplification didn't change anything — no point retrying
      searchLog.trace('[browser] simplified query unchanged, returning empty', { simplified });
      return [];
    }

    // 5. Navigate to new search URL with simplified query
    const retryUrl = buildSearchUrl(engine, simplified);
    searchLog.trace('[browser] retry with simplified query', { simplified, retryUrl });

    await chrome.tabs.update(tabId, { url: retryUrl });
    try {
      await waitForTabLoad(tabId);
    } catch (err) {
      searchLog.trace('[browser] retry navigation failed', { error: String(err) });
      return [];
    }

    const retryResults = await pollForResults(tabId, expression, engine, POLL_MAX_ATTEMPTS);
    if (retryResults) {
      return retryResults;
    }

    // All retry attempts also returned empty
    searchLog.trace('[browser] retry also returned empty, giving up', {
      engine,
      totalAttempts: POLL_MAX_ATTEMPTS * 2,
    });
    return [];
  } finally {
    // Always close the tab
    searchLog.trace('[browser] closing search tab', { tabId });
    await chrome.tabs.remove(tabId).catch(() => {
      // Ignore cleanup errors
    });
  }
};

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const executeWebSearch = async (args: WebSearchArgs): Promise<SearchResult[]> => {
  const { query, maxResults: _maxResults } = args;
  const maxResults = _maxResults ?? 5;
  searchLog.trace('[webSearch] execute', { query, maxResults });

  const config = await toolConfigStorage.get();
  const searchConfig = config.webSearchConfig;
  const session = searchConfig.provider === 'server' ? await askSessionStorage.get() : null;
  if (searchConfig.provider === 'server' && session?.token !== lastServerSessionToken) {
    lastServerSessionToken = session?.token ?? null;
    serverCacheGeneration++;
  }

  searchLog.trace('[webSearch] resolved config', {
    provider: searchConfig.provider,
    ...(searchConfig.provider === 'browser' ? { engine: searchConfig.browser.engine } : {}),
  });

  // Check cache
  const cacheScope =
    searchConfig.provider === 'browser'
      ? `browser:${searchConfig.browser.engine}`
      : session
        ? `server:${serverCacheGeneration}`
        : null;
  const cacheKey = cacheScope ? normalizeCacheKey(`${cacheScope}:${query}:${maxResults}`) : null;
  const cached = cacheKey ? readCache(SEARCH_CACHE, cacheKey, CACHE_TTL_MS) : null;
  if (cached) {
    if (searchConfig.provider === 'server') {
      const current = await askSessionStorage.get();
      if (current?.token !== session?.token || current?.userId !== session?.userId) {
        throw new Error('Account changed during search');
      }
    }
    searchLog.trace('[webSearch] cache hit', { cacheKey, resultCount: cached.length });
    return cached;
  }
  searchLog.trace('[webSearch] cache miss', { cacheKey });

  let results: SearchResult[];

  searchLog.trace('[webSearch] dispatching to provider', { provider: searchConfig.provider });

  switch (searchConfig.provider) {
    case 'server': {
      if (!session) throw new Error('Sign in first');
      results = await runServerSearch(query, maxResults, session);
      break;
    }
    case 'browser': {
      results = await runBrowserSearch(query, maxResults, searchConfig.browser.engine);
      break;
    }
  }

  searchLog.trace('[webSearch] complete', {
    provider: searchConfig.provider,
    resultCount: results.length,
  });

  // Only cache non-empty results — empty results likely mean the extraction
  // failed (page not loaded, selectors missed, CAPTCHA, etc.) and should
  // not poison the cache for subsequent attempts.
  if (results.length > 0 && cacheKey) {
    writeCache(SEARCH_CACHE, cacheKey, results);
  }

  return results;
};

// ── Tool registration ──

const webSearchToolDef: ToolRegistration = {
  name: 'web_search',
  label: 'Web Search',
  description:
    'Search the web for current information using the configured search provider (AskTab server or browser search). Use this when the user asks about recent events, news, or information that may not be in your training data.',
  schema: webSearchSchema,
  execute: args => executeWebSearch(args as WebSearchArgs),
  formatResult: jsonFormatResult,
};

export {
  webSearchSchema,
  executeWebSearch,
  // Exported for testing
  runServerSearch,
  runBrowserSearch,
  buildSearchUrl,
  getExtractionExpression,
  sanitizeQuery,
  simplifyQuery,
  SEARCH_CACHE,
  webSearchToolDef,
};
export type { WebSearchArgs, SearchResult };
