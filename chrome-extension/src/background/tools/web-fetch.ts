// ---------------------------------------------------------------------------
// web_fetch tool — fetch and extract content from a URL.
// ---------------------------------------------------------------------------

import { fetchViaBrowserPage, waitForTabLoad } from './web-fetch-browser';
import { readCache, readResponseText, writeCache, withTimeout } from './web-shared';
import { createLogger } from '../logging/logger-buffer';
import { IS_FIREFOX } from '@extension/env';
import { Type } from '@sinclair/typebox';
import type { ToolRegistration, ToolResult } from './tool-registration';
import type { CacheEntry } from './web-shared';
import type { Static } from '@sinclair/typebox';

const log = createLogger('tool');

const parameterScalarSchema = Type.Union([Type.String(), Type.Number(), Type.Boolean()]);
const parameterValueSchema = Type.Union([
  parameterScalarSchema,
  Type.Array(parameterScalarSchema),
  Type.Null(),
]);

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const webFetchSchema = Type.Object({
  url: Type.String({ description: 'The URL to fetch content from' }),
  method: Type.Optional(
    Type.Union(
      [
        Type.Literal('GET'),
        Type.Literal('HEAD'),
        Type.Literal('POST'),
        Type.Literal('PUT'),
        Type.Literal('PATCH'),
        Type.Literal('DELETE'),
        Type.Literal('OPTIONS'),
      ],
      { description: 'HTTP method (default: GET)' },
    ),
  ),
  params: Type.Optional(
    Type.Record(Type.String(), parameterValueSchema, {
      description: 'URL query parameters. Arrays repeat the key; null removes it.',
    }),
  ),
  headers: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description: 'Custom request headers (e.g. Content-Type, Authorization)',
    }),
  ),
  body: Type.Optional(
    Type.String({ description: 'Raw request body for POST, PUT, PATCH, DELETE, or OPTIONS' }),
  ),
  json: Type.Optional(
    Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Array(Type.Unknown())], {
      description: 'Structured JSON request body; sets Content-Type unless provided',
    }),
  ),
  form: Type.Optional(
    Type.Record(Type.String(), parameterValueSchema, {
      description: 'URL-encoded form body; sets Content-Type unless provided',
    }),
  ),
  credentials: Type.Optional(
    Type.Union([Type.Literal('omit'), Type.Literal('same-origin'), Type.Literal('include')], {
      description: 'HTTP fetch credential policy. Omit to use the browser default.',
    }),
  ),
  extractMode: Type.Optional(
    Type.Union([Type.Literal('text'), Type.Literal('html'), Type.Literal('binary')], {
      description:
        'Extraction mode: "text" reads page text or preserves API text/JSON (default), "html" returns HTML, "binary" returns a base64 data URI',
    }),
  ),
  maxChars: Type.Optional(
    Type.Number({ description: 'Maximum characters to return (default: 30000)' }),
  ),
});

type WebFetchArgs = Static<typeof webFetchSchema>;
type Parameters = NonNullable<WebFetchArgs['params']>;

interface WebFetchResult {
  text: string;
  title?: string;
  status: number;
  mimeType?: string;
  sizeBytes?: number;
  isBase64?: boolean;
  error?: string;
  browserFallback?: boolean;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const FETCH_CACHE = new Map<string, CacheEntry<WebFetchResult>>();
const CACHE_TTL_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CHARS = 30_000;
const BINARY_DEFAULT_MAX_CHARS = 2_000_000;
const BINARY_MAX_BYTES = 10_000_000; // 10 MB hard limit

const appendParameters = (target: URLSearchParams, params: Parameters): void => {
  for (const [key, value] of Object.entries(params)) {
    target.delete(key);
    if (value === null) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) target.append(key, String(item));
  }
};

const resolveFetchUrl = (url: string, params?: Parameters): string => {
  const parsed = new URL(url);
  if (!params) return url;
  appendParameters(parsed.searchParams, params);
  return parsed.toString();
};

// ---------------------------------------------------------------------------
// Base64 encoding — chunked to avoid stack overflow on large arrays
// ---------------------------------------------------------------------------

const uint8ToBase64 = (bytes: Uint8Array): string => {
  // Process in 3072-byte chunks (multiple of 3 → 4096 base64 chars each).
  // Encoding per-chunk avoids the O(n²) join + single btoa() on huge strings.
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3072) {
    const slice = bytes.subarray(i, i + 3072);
    let s = '';
    for (let j = 0; j < slice.length; j++) {
      s += String.fromCharCode(slice[j]!);
    }
    parts.push(btoa(s));
  }
  return parts.join('');
};

// ---------------------------------------------------------------------------
// HTML entity decoding
// ---------------------------------------------------------------------------

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&ndash;': '\u2013',
  '&mdash;': '\u2014',
  '&hellip;': '\u2026',
};

const decodeEntities = (text: string): string =>
  text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(
      /&(?:amp|lt|gt|quot|#39|apos|nbsp|ndash|mdash|hellip);/g,
      match => HTML_ENTITIES[match] ?? match,
    );

// ---------------------------------------------------------------------------
// HTML → text extraction
// ---------------------------------------------------------------------------

const extractText = (html: string, maxChars: number): string => {
  let text = html;

  // Remove non-content elements entirely
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<aside[\s\S]*?<\/aside>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Convert block elements to newlines for structure
  text = text.replace(/<\/(?:p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode entities
  text = decodeEntities(text);

  // Normalize whitespace
  text = text
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length > 15) // Filter short lines (nav items, labels)
    .join('\n');

  // Collapse multiple blank lines
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text.slice(0, maxChars);
};

// ---------------------------------------------------------------------------
// Browser fallback — open a background tab to extract text when fetch() fails
// ---------------------------------------------------------------------------

const fetchViaBrowserFallback = async (url: string, maxChars: number): Promise<WebFetchResult> => {
  log.trace('[webFetch] attempting browser fallback', { url });

  // Only allow http/https — block chrome://, file://, extension-internal, etc.
  const parsedUrl = new URL(url);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return {
      text: '',
      status: 0,
      error: `Browser fallback skipped: unsupported protocol ${parsedUrl.protocol}`,
      browserFallback: true,
    };
  }

  // Chrome blocks all extension scripting on these domains — skip the tab round-trip.
  const BLOCKED_HOSTS = ['chromewebstore.google.com', 'chrome.google.com', 'clients.google.com'];
  if (BLOCKED_HOSTS.some(h => parsedUrl.hostname === h || parsedUrl.hostname.endsWith(`.${h}`))) {
    return {
      text: '',
      status: 0,
      browserFallback: true,
      error: `This URL is on a Chrome-restricted domain that blocks all extension access. Use web_search to find information about this page instead.`,
    };
  }

  let tabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id ?? undefined;
    if (tabId == null) {
      return {
        text: '',
        status: 0,
        error: 'Browser fallback failed: could not create tab.',
        browserFallback: true,
      };
    }
    await waitForTabLoad(tabId);
    const loadedTab = await chrome.tabs.get(tabId);
    const title = loadedTab.title || undefined;
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.body.innerText,
    });
    const raw = results?.[0]?.result;
    let text = typeof raw === 'string' ? raw : '';
    if (text.length > maxChars) {
      text = text.slice(0, maxChars);
    }
    return { text, title, status: 200, browserFallback: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: '', status: 0, error: `Browser fallback failed: ${msg}`, browserFallback: true };
  } finally {
    if (tabId != null) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* tab may already be closed */
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

const executeWebFetch = async (args: WebFetchArgs): Promise<WebFetchResult> => {
  const {
    url,
    method,
    params,
    headers,
    body,
    json,
    form,
    credentials,
    extractMode,
    maxChars = DEFAULT_MAX_CHARS,
  } = args;
  const effectiveMethod = method ?? 'GET';
  const bodyCount =
    Number(body !== undefined) + Number(json !== undefined) + Number(form !== undefined);
  if (bodyCount > 1) {
    return { text: '', status: 0, error: 'Specify only one of body, json, or form.' };
  }
  if ((effectiveMethod === 'GET' || effectiveMethod === 'HEAD') && bodyCount > 0) {
    return { text: '', status: 0, error: `${effectiveMethod} requests cannot have a body.` };
  }

  let requestUrl: string;
  try {
    requestUrl = resolveFetchUrl(url, params);
  } catch {
    return {
      text: '',
      status: 0,
      error: `Invalid URL: "${url}". Ensure the URL includes a protocol (e.g., https://).`,
    };
  }
  log.trace('[webFetch] fetching', {
    url: requestUrl,
    method: effectiveMethod,
    extractMode,
    maxChars,
  });

  // Personalized and non-GET requests must not reuse a cached response.
  const cacheable = effectiveMethod === 'GET' && !headers && !credentials;
  const cacheKey = `${effectiveMethod}:${requestUrl}:${extractMode ?? 'text'}:${maxChars}`;
  if (cacheable) {
    const cached = readCache(FETCH_CACHE, cacheKey, CACHE_TTL_MS);
    if (cached) {
      log.trace('[webFetch] cache hit', { url: requestUrl });
      return cached;
    }
  }

  const fetchInit: RequestInit = { signal: withTimeout(30) };
  if (method) fetchInit.method = method;
  if (credentials) fetchInit.credentials = credentials;
  if (body) fetchInit.body = body;
  if (json !== undefined || form !== undefined) {
    const requestHeaders = { ...headers };
    if (!Object.keys(requestHeaders).some(key => key.toLowerCase() === 'content-type')) {
      requestHeaders['Content-Type'] =
        json !== undefined ? 'application/json' : 'application/x-www-form-urlencoded;charset=UTF-8';
    }
    fetchInit.headers = requestHeaders;
    if (json !== undefined) fetchInit.body = JSON.stringify(json);
    if (form !== undefined) {
      const formData = new URLSearchParams();
      appendParameters(formData, form);
      fetchInit.body = formData.toString();
    }
  } else if (headers) {
    fetchInit.headers = headers;
  }

  let response: Response;
  try {
    response = await fetch(requestUrl, fetchInit);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout =
      (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) ||
      msg.includes('aborted') ||
      msg.includes('timeout');

    log.trace('[webFetch] fetch failed', { url: requestUrl, error: msg });

    if (isTimeout) {
      return {
        text: '',
        status: 0,
        error: 'Request timed out after 30 seconds. The server may be slow or unreachable.',
      };
    }

    // CORS/network error — try browser fallback for GET text/html requests
    if (cacheable && bodyCount === 0 && extractMode !== 'binary') {
      const fallbackResult = await fetchViaBrowserFallback(requestUrl, maxChars);
      if (fallbackResult.text.length > 0) {
        writeCache(FETCH_CACHE, cacheKey, fallbackResult);
        return fallbackResult;
      }
      return {
        text: '',
        status: 0,
        browserFallback: true,
        error: `Network error: ${msg}. Browser fallback also failed: ${fallbackResult.error ?? 'no content extracted'}`,
      };
    }

    // Requests with custom semantics cannot be retried as a browser navigation.
    return {
      text: '',
      status: 0,
      error: `Network error: ${msg}. Possible causes: CORS policy blocking the request, SSL/TLS error, DNS resolution failure, or the server is unreachable. Try using the browser tool to navigate to the URL instead.`,
    };
  }

  if (effectiveMethod === 'HEAD') {
    const mimeType = response.headers?.get('content-type')?.split(';')[0]?.trim() || undefined;
    const contentLength = response.headers?.get('content-length');
    const sizeBytes =
      contentLength != null && Number.isFinite(Number(contentLength))
        ? Number(contentLength)
        : undefined;
    return {
      text: '',
      status: response.status,
      mimeType,
      sizeBytes,
      ...(!response.ok && { error: `HTTP ${response.status} ${response.statusText}` }),
    };
  }

  // Handle non-2xx responses for binary mode early (no useful content to extract)
  if (!response.ok && extractMode === 'binary') {
    const errorBody = await readResponseText(response);
    const detail = `HTTP ${response.status} ${response.statusText}${errorBody ? `: ${errorBody}` : ''}`;
    log.trace('[webFetch] non-OK response', { url: requestUrl, status: response.status });
    return { text: '', status: response.status, error: detail };
  }

  // ── Binary mode: return base64 data URI ──
  if (extractMode === 'binary') {
    const rawContentType = response.headers.get('content-type') || 'application/octet-stream';
    const mimeType = rawContentType.split(';')[0]!.trim();

    // Pre-check Content-Length to avoid downloading huge files
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > BINARY_MAX_BYTES) {
      return {
        text: '',
        status: response.status,
        mimeType,
        sizeBytes: contentLength,
        isBase64: true,
        error: `Binary content too large: ${contentLength} bytes exceeds ${BINARY_MAX_BYTES} byte limit`,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Post-download size check (Content-Length may be absent or wrong)
    if (bytes.length > BINARY_MAX_BYTES) {
      return {
        text: '',
        status: response.status,
        mimeType,
        sizeBytes: bytes.length,
        isBase64: true,
        error: `Binary content too large: ${bytes.length} bytes exceeds ${BINARY_MAX_BYTES} byte limit`,
      };
    }

    const base64 = uint8ToBase64(bytes);
    const dataUri = `data:${mimeType};base64,${base64}`;

    // Auto-increase maxChars for binary mode
    const effectiveMaxChars = Math.max(maxChars, BINARY_DEFAULT_MAX_CHARS);
    if (dataUri.length > effectiveMaxChars) {
      return {
        text: '',
        status: response.status,
        mimeType,
        sizeBytes: bytes.length,
        isBase64: true,
        error: `Base64 data URI too large: ${dataUri.length} chars exceeds maxChars ${effectiveMaxChars}. Pass a larger maxChars to allow it.`,
      };
    }

    // Skip cache for binary results (large + rarely re-fetched)
    return {
      text: dataUri,
      status: response.status,
      mimeType,
      sizeBytes: bytes.length,
      isBase64: true,
    };
  }

  // ── Text / HTML modes ──
  const responseText = await response.text();
  const contentType = response.headers?.get('content-type')?.toLowerCase() ?? '';
  const isHtml =
    !contentType ||
    contentType.includes('text/html') ||
    contentType.includes('application/xhtml+xml');

  // Extract title from <title> tag
  const titleMatch = isHtml ? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(responseText) : null;
  const title = titleMatch?.[1]?.trim() ? decodeEntities(titleMatch[1].trim()) : undefined;

  let text: string;
  if (extractMode === 'html') {
    text = responseText.slice(0, maxChars);
  } else if (!isHtml) {
    text = responseText.slice(0, maxChars);
  } else {
    text = extractText(responseText, maxChars);
  }

  const result: WebFetchResult = {
    text,
    title,
    status: response.status,
    mimeType: contentType.split(';')[0]?.trim() || undefined,
  };

  // Flag non-2xx responses with error detail while preserving extracted content
  if (!response.ok) {
    result.error = `HTTP ${response.status} ${response.statusText}`;
    log.trace('[webFetch] non-OK response', { url: requestUrl, status: response.status });
  }

  if (cacheable && response.ok && text.length > 0) {
    writeCache(FETCH_CACHE, cacheKey, result);
  }

  return result;
};

const executeBrowserAwareWebFetch = async (args: WebFetchArgs): Promise<WebFetchResult> => {
  if (
    IS_FIREFOX ||
    (args.method !== undefined && args.method !== 'GET') ||
    args.headers ||
    args.body !== undefined ||
    args.json !== undefined ||
    args.form !== undefined ||
    args.credentials !== undefined ||
    args.extractMode === 'binary'
  ) {
    return executeWebFetch(args);
  }
  let requestUrl: string;
  try {
    requestUrl = resolveFetchUrl(args.url, args.params);
  } catch {
    return executeWebFetch(args);
  }
  return fetchViaBrowserPage(
    requestUrl,
    args.extractMode ?? 'text',
    args.maxChars ?? DEFAULT_MAX_CHARS,
  );
};

// ── Tool registration ──

const webFetchToolDef: ToolRegistration = {
  name: 'web_fetch',
  label: 'Fetch URL',
  description:
    'Read an HTTP(S) URL. Supports GET, HEAD, POST, PUT, PATCH, DELETE, and OPTIONS; params adds URL query values. In Chrome, a plain GET reads a browser tab with the site login. Other methods, binary responses, custom headers, credentials, and request bodies use HTTP fetch. Send one of body (raw string), json (structured JSON), or form (URL-encoded fields).',
  schema: webFetchSchema,
  execute: args => executeBrowserAwareWebFetch(args as WebFetchArgs),
  formatResult: (raw): ToolResult => {
    const result = raw as WebFetchResult;
    if (result.isBase64 && result.text) {
      const mediaType = result.mimeType || 'application/octet-stream';
      // Only send as image content block when it's actually an image
      if (mediaType.startsWith('image/')) {
        const rawBase64 = result.text.replace(/^data:[^;]+;base64,/, '');
        return {
          content: [
            {
              type: 'image' as const,
              data: rawBase64,
              mimeType: mediaType,
            },
          ],
          details: { mimeType: result.mimeType, sizeBytes: result.sizeBytes },
        };
      }
      // Non-image binary: return metadata (data URI is too large for text block)
      return {
        content: [
          {
            type: 'text',
            text: `Binary content fetched: ${mediaType}, ${result.sizeBytes ?? 0} bytes`,
          },
        ],
        details: { mimeType: result.mimeType, sizeBytes: result.sizeBytes, dataUri: result.text },
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
  },
};

export {
  webFetchSchema,
  executeWebFetch,
  executeBrowserAwareWebFetch,
  FETCH_CACHE,
  extractText,
  decodeEntities,
  uint8ToBase64,
  webFetchToolDef,
};
export type { WebFetchArgs, WebFetchResult };
