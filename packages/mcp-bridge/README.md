# AskTab MCP bridge

A local [MCP](https://modelcontextprotocol.io) server that lets external MCP clients (Claude Desktop, Cursor, Claude Code, and others) use AskTab's browser tools in the browser where AskTab is installed.

```
MCP client ──stdio──▶ bridge (this package) ◀──WebSocket 127.0.0.1── AskTab extension
```

The client starts the bridge as a subprocess. The extension connects to the bridge, so nothing listens on the network except the bridge's loopback socket.

## Tools

When MCP is enabled, the bridge lists these tools. Names, descriptions and input schemas come from the extension, so they always match the tools AskTab agents use.

| Tool                 | Chrome | Firefox |
| -------------------- | ------ | ------- |
| `browser`            | yes    | yes     |
| `debugger`           | yes    | no      |
| `execute_javascript` | yes    | yes     |
| `web_fetch`          | yes    | yes     |

There is no per-tool switch. Other AskTab tools (search, memory, Google, and so on) are not exposed.

## Setup

Every AskTab release on [GitHub](https://github.com/hicms/ask-tab/releases) includes the bridge as `asktab-mcp-vX.Y.Z.tgz`, and MCP clients run it with `npx`. You need Node.js 18 or later and access to github.com; nothing has to be installed or cloned. The bridge ships with AskTab releases from v0.1.15 on.

1. In AskTab, open **Settings → Tools → MCP Bridge** and turn the option on. **Copy client config** puts a ready-made `mcpServers` entry on the clipboard, with the port, the token and the bridge for your AskTab version filled in.
2. Paste that entry into your MCP client configuration and restart the client.

On macOS and Linux the entry looks like this (for AskTab 0.1.15):

```json
{
  "mcpServers": {
    "asktab-browser": {
      "command": "npx",
      "args": [
        "-y",
        "https://github.com/hicms/ask-tab/releases/download/v0.1.15/asktab-mcp-v0.1.15.tgz"
      ],
      "env": {
        "ASKTAB_MCP_PORT": "47821",
        "ASKTAB_MCP_TOKEN": "<token from the settings page>"
      }
    }
  }
}
```

On Windows, `npx` is a `.cmd` script that most MCP clients cannot start directly, so the copied entry uses `"command": "cmd"` and puts `"/c", "npx"` in front of the same arguments.

The dependencies (the MCP SDK and `ws`) come from your configured npm registry, so a registry mirror works. The package itself always downloads from github.com; if GitHub is slow or blocked on your network, use a local build instead.

MCP is off by default. The default port is 47821.

### Running from a local build

For development, or if you cannot download from GitHub, run `pnpm build` and point the client at the built file instead of `npx`:

```json
"command": "node",
"args": ["<path-to-ask-tab>/packages/mcp-bridge/dist/index.mjs"]
```

## Versions

The bridge and the extension share the message format in `lib/protocol.ts` and are released together under one version. The copied config pins the bridge from the same release as the installed extension, so the two always match. After AskTab updates, copy the config again to move to the new bridge. An older bridge keeps working as long as `lib/protocol.ts` has not changed between the two versions.

## Security

- The bridge binds to `127.0.0.1` only and accepts only WebSocket connections whose `Origin` is `chrome-extension://` or `moz-extension://`.
- Both sides prove they know the token with an HMAC challenge and response. The token is never sent over the socket, and the extension runs no request until it has verified the bridge's proof. A process that takes over the port without the token cannot send tool calls.
- The token is stored in `chrome.storage.local` under `mcp-bridge-config` and is not part of full backups.
- Anyone who can read the token (your MCP client configuration, or your browser profile) can control your browser, including logged-in sessions. `debugger` can send arbitrary Chrome DevTools Protocol commands, and `execute_javascript` runs code in pages and can register or remove custom tools on the active agent.

## Behavior to know about

- **Sessions.** Each authenticated connection is one session. A `browser` snapshot and the `click`, `type` and `select` calls that use its refs can be separate tool calls, as long as the connection stays open. When the connection closes (the client exits, MCP is turned off, or the port or token changes), AskTab stops a running `browser wait`, stops queued `browser` actions, ends a running `execute_javascript`, and removes the page markers and refs. A click or navigation that has already started finishes. `debugger` and `web_fetch` do not react to the stop.
- **No per-call cancel.** Cancelling a request in the client stops the bridge from waiting, but the call keeps running in the extension and its result is discarded. Disconnecting is the way to stop a long `execute_javascript`.
- **Cleanup is best effort.** If the browser terminates the extension's service worker or the extension is reloaded, page markers are not removed.
- **Errors.** A result is flagged `isError` when the tool throws, rejects its arguments, or returns a message that starts with `Error:`. `web_fetch` reports failures as `{ "error": ... }` in the JSON text (an HTTP error can still include a body), so it is not flagged.
- **Tabs.** Tabs that MCP clients open are not placed in an agent tab group. MCP and AskTab agents can take over each other's snapshot refs on the same tab, in the same way two agent runs can.
- **One bridge at a time.** A second bridge on the same port exits with an error on stderr. A new authenticated connection replaces the previous one.
- **Reconnecting.** With MCP enabled, the extension first probes the local bridge over HTTP and opens a WebSocket only after receiving its `426 Upgrade Required` response. When no client is running, it retries quietly (backoff up to 30 seconds, plus a 30 second alarm that wakes a sleeping service worker), avoiding repeated WebSocket connection-refused errors. WebSocket failures are logged at debug level in the AskTab log viewer. If a request arrives before the extension is connected, the bridge waits up to 40 seconds, then returns "AskTab extension is not connected".
- **New token.** After **Regenerate token**, restart the MCP client so the bridge gets the new token. A bridge with an old token is rejected until then.

## Development

```bash
pnpm --filter asktab-mcp ready       # build to dist/
pnpm --filter asktab-mcp type-check
pnpm exec vitest run tests/unit/mcp-bridge
pnpm build && pnpm exec playwright test tests/playwright/e2e/mcp-bridge.spec.ts
```

### Releasing

The bridge is not published to npm. `pnpm release:package vX.Y.Z` writes `dist-zip/asktab-mcp-vX.Y.Z.tgz` next to the extension ZIP, and the release workflow attaches it to the GitHub Release. `scripts/release.ps1` keeps the bridge version equal to the extension version.

The wire protocol is defined once in `lib/protocol.ts`. The extension side lives in `chrome-extension/src/background/mcp/` and imports only the types.
