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
| `method` | `GET` \| `HEAD` \| `POST` \| `PUT` \| `PATCH` \| `DELETE` \| `OPTIONS` | `GET` | HTTP method |
| `params` | object | — | URL query parameters; arrays produce repeated keys, `null` removes an existing key |
| `headers` | object | — | Custom request headers |
| `body` | string | — | Raw request body |
| `json` | object or array | — | JSON request body; automatically adds `Content-Type: application/json` |
| `form` | object | — | URL-encoded form body; automatically adds its content type |
| `credentials` | `omit` \| `same-origin` \| `include` | Browser default | Credential policy for HTTP fetch requests |
| `extractMode` | `text` \| `html` \| `binary` | `text` | Content extraction mode |
| `maxChars` | number | 30,000 | Maximum characters to return |

Specify only one of `body`, `json`, or `form`. GET and HEAD cannot have a request body. Custom `Content-Type` headers override the automatic JSON/form values. Query parameters work with every method and replace existing URL parameters with the same name.

For example, `{"url":"https://example.com/search","params":{"q":"hello world","tag":["a","b"]}}` loads `https://example.com/search?q=hello+world&tag=a&tag=b`. To update an API resource, use `{"url":"https://example.com/api/items/1","method":"PATCH","json":{"name":"New name"}}`.

### Extraction modes

- **text** — On Chrome, reads the rendered page's visible text for ordinary GET requests. Programmable requests strip HTML but preserve JSON and plain text responses as returned by the server.
- **html** — On Chrome, returns the current DOM HTML for ordinary GET requests, including changes made by page scripts. Programmable requests return raw response HTML.
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
| `browserFallback` | Whether a browser tab was used to read the page |

### Browser page reads

On Chrome, ordinary GET requests without custom headers or body read a browser page. This uses the browser profile and site login and runs the page's scripts. AskTab:

1. Uses an already-open tab at the exact URL when one exists, preserving its tab-specific state; otherwise opens an inactive temporary tab and waits for its load event (15 second timeout)
2. Reads the page's visible text or current DOM HTML and navigation HTTP status
3. Closes a temporary tab after reading, including when reading fails; existing user tabs remain open

Pages that render content after the load event may still require the browser tool to wait and interact with them. Restricted browser pages cannot be scripted. A missing HTTP status is reported as `0`, never assumed to be `200`.

HEAD, POST, PUT, PATCH, DELETE, OPTIONS, binary reads, and requests with custom headers, an explicit credential policy, or a request body use the extension's HTTP `fetch()`. HEAD returns status and available content type/length without reading a body. Firefox keeps the HTTP `fetch()` path for all methods. On its network failure, a plain GET text/HTML request may try the legacy browser fallback.

This tool is for HTTP(S) URLs. Other schemes such as `ws:`, `wss:`, or `ftp:` require separate protocol-specific tools; changing the HTTP method cannot make `fetch()` speak those protocols.

### Caching

Programmable successful GET text/HTML results without custom headers or an explicit credential policy are cached for 5 minutes by `method:resolvedUrl:extractMode:maxChars`. Non-GET methods, requests with custom headers or an explicit credential policy, and Chrome browser page reads skip the cache, so a login change is reflected in the next page read.
