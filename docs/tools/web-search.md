---
summary: "Web search and URL fetch tools — search the web and extract content from pages."
read_when:
  - Configuring web search
  - Understanding URL fetching capabilities
  - Choosing a search provider
title: "Web Search & Fetch"
---

# Web Search & Fetch

Two tools for retrieving information from the web: `web_search` for searching and `web_fetch` for extracting content from specific URLs.

## web_search

Search the web for current information using the configured search provider.

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | (required) | The search query |
| `maxResults` | number | 5 | Maximum results to return |

### Returns

An array of search results, each with:
- `title` — Page title
- `url` — Page URL
- `snippet` — Brief excerpt from the page

### Search providers

AskTab supports two search providers:

- **AskTab server** (default) — Sends the query to the AskTab service with your account session. The server holds the search provider (Tavily, Exa or UCloud Exa) and its API key; the extension never sees them. Requires being signed in.
- **Browser-based** — Uses browser search without an account. Uses CAPTCHA resilience and fallback query simplification.

Server search providers are configured in the Rust service catalog.

### Caching

Only non-empty results are cached for the configured provider, query, and result count. Browser cache entries also include the configured search engine.

---

## web_fetch

Fetch and extract content from a URL with multiple extraction modes.

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | (required) | URL to fetch |
| `method` | `GET` \| `POST` | `GET` | HTTP method |
| `headers` | object | — | Custom request headers |
| `body` | string | — | Request body for POST |
| `extractMode` | `text` \| `html` \| `binary` | `text` | Content extraction mode |
| `maxChars` | number | 30,000 | Maximum characters to return |

### Extraction modes

- **text** — Converts HTML to plain text with entity decoding. Best for reading articles and documentation.
- **html** — Returns raw HTML. Useful when you need to inspect page structure.
- **binary** — Returns base64-encoded data URIs. Used for downloading images and other binary files.

### Returns

| Field | Description |
|-------|-------------|
| `text` | Extracted content |
| `title` | Page title (if available) |
| `status` | HTTP status code |
| `mimeType` | Response MIME type |
| `sizeBytes` | Response size |
| `isBase64` | Whether content is base64-encoded |
| `error` | Error message (if failed) |
| `browserFallback` | Whether browser fallback was used |

### Browser fallback

When a fetch fails due to CORS or network errors, AskTab automatically tries a browser fallback:

1. Opens a background tab with the URL
2. Waits for the page to load (15 second timeout)
3. Extracts `innerText` via the scripting API
4. Closes the tab

### Caching

Results are cached for 5 minutes by `method:url:extractMode:maxChars`. POST requests skip the cache.
