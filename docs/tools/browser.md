---
summary: "Browser automation with numbered snapshots, clicks, input, dropdown selection, scrolling, screenshots, and console/network logs."
read_when:
  - Using browser automation features
  - Understanding CDP integration
  - Automating web interactions
title: "Browser Automation"
---

# Browser Automation

The `browser` tool provides full browser control via the Chrome DevTools Protocol (CDP). It can list tabs, navigate, take screenshots, interact with page elements, and capture console and network logs.

## Actions

| Action | Description |
|--------|-------------|
| `tabs` | List all open browser tabs |
| `open` | Open a new tab with optional URL |
| `close` | Close a tab by ID |
| `focus` | Focus/activate a tab |
| `navigate` | Navigate a tab to a URL |
| `content` | Extract text content (optional CSS selector) |
| `snapshot` | DOM snapshot with numbered element refs |
| `screenshot` | Capture a screenshot (viewport or full page) |
| `click` | Click an element by ref number |
| `type` | Type text into an element by ref number |
| `select` | Select a native dropdown option by exact label or value |
| `scroll` | Scroll the page or a ref's nearest scrollable ancestor in any direction |
| `wait` | Wait up to 10 seconds for page updates; cancelled when the task stops |
| `console` | View console log entries |
| `network` | View network request/response log |

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | string | (required) One of the actions above |
| `tabId` | number | Target tab ID |
| `url` | string | URL for `open` / `navigate` |
| `active` | boolean | Whether to activate the tab |
| `ref` | number | Snapshot ref for `click` / `type` / `select`; optional scroll target |
| `text` | string | Text to type (empty clears), or exact dropdown option label |
| `value` | string | Exact dropdown option value; takes precedence over `text` |
| `direction` | string | `up`, `down` (default), `left`, or `right` |
| `pixels` | number | Nonnegative scroll distance; takes precedence over `pages` |
| `pages` | number | Scroll distance in viewport/container sizes, 0–10 (default 1) |
| `seconds` | number | Wait duration, 0–10 (default 1); no `tabId` required |
| `selector` | string | CSS selector for `content` extraction |
| `fullPage` | boolean | Full-page screenshot |
| `limit` | number | Max entries for `console` / `network` (default: 50) |

## DOM snapshots

The `snapshot` action creates a structured representation of the page with numbered element refs:

```
[1] <button> Submit
[2] <input type="text" placeholder="Enter name">
[3] <a href="/about"> About Us
```

Each element gets a unique ref number that you can use with `click` or `type` actions. The snapshot includes:
- Clickable elements (buttons, links, inputs)
- Text content
- Form field values

Refs belong to the latest snapshot of that tab. Take another snapshot after navigation or when an action reports that a ref is stale, hidden, or blocked. A successful `click` means the browser sent the click; inspect the page again to confirm the intended change.

After a snapshot, visible elements are outlined on the page with the same ref numbers. The outlines follow scrolling and resizing. A Page Agent cursor is visible immediately; subsequent snapshots keep it visible. Clicking, typing or selecting by ref activates the target tab and moves the cursor. The outlines do not intercept pointer input. Navigation and a fresh snapshot replace the previous outlines. Task completion, failure, cancellation and timeout remove all markers and invalidate refs before reporting completion. A concurrent task's newer snapshot is preserved. On restricted pages, visual feedback may be unavailable even when an action succeeds.

`select` works with native `<select>` elements. Use `click` for custom dropdowns. `scroll` with a ref scrolls its nearest ancestor with overflow on the requested axis, including ancestors across a shadow root. Without a ref it scrolls the document. Text-only scroll panes without an interactive ref require page JavaScript. Scroll results report actual distance, including boundaries; take a fresh snapshot after scrolling to inspect content.

## Screenshots

Screenshots are returned as base64-encoded images. Use `fullPage: true` for the entire page, or omit it for just the visible viewport.

## JavaScript evaluation

Use the `execute_javascript` tool with `tabId` for page scripts. This replaces the removed `browser.evaluate` action and supports asynchronous code and scripting fallback when Chrome's debugger cannot attach:

```json
{
  "action": "execute",
  "tabId": 123,
  "code": "return document.title"
}
```

Returns the result and captured console output.

## Console and network logs

- **console** — View recent console.log, console.error, etc. entries
- **network** — View recent HTTP requests/responses with URLs, status codes, and timing

Both support a `limit` parameter (default 50) to control how many entries are returned.

## Debugger tool

The `debugger` tool provides direct access to the Chrome DevTools Protocol for advanced use cases:

| Action | Description |
|--------|-------------|
| `send` | Send a CDP command (e.g., `Runtime.evaluate`, `DOM.getDocument`) |
| `attach` | Attach debugger to a tab |
| `detach` | Detach debugger from a tab |
| `list_targets` | List available debug targets |

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | string | (required) One of the actions above |
| `tabId` | number | Target tab ID |
| `method` | string | CDP method name |
| `params` | object | CDP command parameters |

<Note>
The debugger tool is Chrome-only and not available on Firefox. Firefox uses the scripting API as a fallback for basic browser actions.
</Note>

## Timeouts

- Tab load: 15 seconds
- Network requests: 30 seconds
- Tool execution: 5 minutes (global)
