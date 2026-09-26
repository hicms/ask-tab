---
summary: "AskTab's Manifest V3 architecture — service worker, storage, and data flow."
read_when:
  - Understanding how AskTab is built
  - Learning about the extension architecture
  - Debugging or extending AskTab
title: "Architecture"
---

# Architecture

AskTab is a Manifest V3 Chrome extension built with React, TypeScript, Vite, and Tailwind CSS. Browser tools run in the extension. All AI capabilities go through the AskTab Rust service with a JWT.

## High-level data flow

```
Side Panel / Full-Page Chat
  → useLLMStream hook (chrome.runtime.Port)
  → Background Service Worker (stream-handler.ts)
  → Model Adapter (chatModelToPiModel) → pi-mono streamSimple()
  → AskTab Rust relay
  → SSE stream back through Port → UI updates
```

## Core components

### Background Service Worker

The service worker (`chrome-extension/src/background/`) is the heart of AskTab. It handles:

- **LLM streaming** — Manages Port connections, streams responses, handles tool calls
- **Agent system** — Multi-agent loop with steering/follow-up message queues
- **Tool execution** — 31 built-in tools with schema validation and timeout management
- **Memory** — Syncs memory files and transcripts to the AskTab service for hybrid search, session journaling
- **Context compaction** — Sliding-window and LLM-powered summarization
- **Channel routing** — WhatsApp and Telegram message bridge (inbound messages leased from the AskTab service queue)
- **Cron scheduler** — Alarm-based task execution
- **TTS** — Text-to-speech through the server TTS model

<Warning>
MV3 service workers may be terminated after 30 seconds of inactivity. AskTab uses keep-alive mechanisms during long-running LLM streams to prevent this.
</Warning>

### Extension pages

| Page | Purpose |
|------|---------|
| **Side Panel** | Primary chat interface — streaming, artifacts, chat history, voice input/output |
| **Full-Page Chat** | Full-page chat mode (push sidebar) with embedded settings |
| **Options** | Settings page with tabbed configuration panels |

## Storage

AskTab uses two storage mechanisms:

### Chrome Storage (local/session)

Settings, tool configurations, channel settings (allowlists, model overrides), and small key-value data. Channel credentials (Telegram bot token, WhatsApp session) are held by the AskTab service, not the extension.

### IndexedDB via Dexie.js

The `asktab` database (current initial schema version 1) stores:

| Table | Contents |
|-------|----------|
| `chats` | Conversation metadata, token usage, compaction info, channel metadata |
| `messages` | Chat messages with parts (text, reasoning, tool calls, files) |
| `artifacts` | Generated documents (text, code, spreadsheets, images) |
| `workspaceFiles` | Context files — predefined and custom, scoped per agent |
| `scheduledTasks` | Persistent cron/scheduler tasks |
| `taskRunLogs` | Scheduled task execution history |

## Model adapter

The model adapter (`agents/model-adapter.ts`) converts AskTab's `ChatModel` type to pi-mono's `Model<Api>` type for provider routing:

- **Published remote models** — OpenAI-compatible or Anthropic protocol, with upstream configuration owned by Rust

The account JWT is stored separately from public model metadata. Remote speech and memory search use the same service boundary; memory indexing and embeddings run on the service.

## Streaming architecture

All LLM communication uses `chrome.runtime.Port` for streaming:

1. **Client** (`useLLMStream` hook) opens a Port connection
2. **Service worker** receives the connection, builds context, and starts the LLM stream
3. **pi-mono** `streamSimple()` handles provider-specific SSE parsing
4. **Events** flow back through the Port: text deltas, reasoning, tool calls, tool results, turn end

The agent loop processes steering messages (user corrections) and follow-up messages (auto-continuations) between turns.

## Tool loop detection

A 5-level detection system prevents infinite tool-calling loops:

1. **Global no-progress** — No new information produced across multiple turns
2. **Known poll tools** — Repeated polling tools (browser, debugger) with stricter thresholds
3. **Repeat detection** — Same tool + arguments called multiple times
4. **Ping-pong detection** — Two tools alternating without progress
5. **Warnings** — Soft alerts before circuit breaker triggers

Severity levels: `none` → `warning` → `critical` → `circuit_breaker`

## Error handling and retry

AskTab implements automatic retry on context overflow:

1. **Attempt 1** — Run normally
2. **Attempt 2** — Truncate oversized tool results
3. **Attempt 3** — Apply full context compaction

Error classification categorizes failures (context overflow, rate limit, auth, network) to choose the appropriate recovery strategy.
