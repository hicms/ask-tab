---
summary: "Messaging channels overview — connect WhatsApp and Telegram to AskTab for AI-powered chat from any device."
read_when:
  - Setting up messaging channels
  - Understanding how channels route messages to the agent
title: "Channels"
---

# Channels

AskTab can send and receive messages on WhatsApp and Telegram. The AskTab service owns all channel I/O — it holds the Telegram bot token and the WhatsApp session, and queues inbound messages. The extension leases queued messages from the service, routes them through the agent system, and sends replies back via the service.

## Supported channels

| Channel | Connection | Delivery | Max Message |
|---------|-----------|----------|-------------|
| [WhatsApp](/channels/whatsapp) | QR code pairing, session kept by the AskTab service | Service queue, leased by the extension | 4,096 chars |
| [Telegram](/channels/telegram) | Bot token held by the AskTab service | Service queue, leased by the extension | 4,096 chars |

## How channels work

```
Inbound message (WhatsApp/Telegram)
  → AskTab service (receives, filters, queues)
  → Poller (extension leases queued updates, then acks)
  → Message Bridge (normalize, deduplicate, filter)
  → Agent Handler (build context, run LLM, stream response)
  → Channel Adapter (format reply, send back via the service)
```

### Message bridge

The message bridge normalizes raw platform messages into a common format:

1. **Normalization** — Convert platform-specific updates to `ChannelInboundMessage`
2. **Deduplication** — Track recently processed message IDs (up to 200) to prevent reprocessing on service worker restart
3. **DM-only filter** — Reject group messages (only direct messages are processed)
4. **Allowlist check** — Verify sender against `allowedSenderIds`
6. **Bot command dispatch** — Handle built-in commands (`/start`, `/help`, `/reset`, `/status`)
7. **Agent handler** — Route to LLM for response generation

### Agent handler

The agent handler processes each inbound message:

1. Apply per-chat locking (prevents concurrent processing of the same conversation)
2. Resolve model (channel override or default)
3. Find or create a linked chat session in IndexedDB
4. Start typing indicator
5. Transcribe voice messages (if applicable)
6. Build system prompt with workspace files and tools
7. Run agent loop with streaming callbacks
8. Send response back through the channel
9. Apply TTS if enabled (voice reply as audio message)

### Polling modes

The extension polls the service queue with a single alarm (every 30 seconds) and adapts the long-poll wait to balance latency and resource usage:

- **Idle** — short wait (about 5 seconds) when nothing is happening
- **Active** — longer wait (about 20 seconds) for 5 minutes after the last message, so replies feel near-instant

Each leased queue item is acknowledged after it is handled, so a service worker restart at most re-delivers the in-flight item.

## Configuration

Both channels are configured on the Options page under the **Channels** section:

- **Enable/disable** each channel independently
- **Connect** — Bot token (Telegram) or QR code pairing (WhatsApp); credentials are sent to and kept by the AskTab service
- **Allowed senders** — Allowlist of sender IDs that can interact with the agent
- **Model override** — Use a specific model for channel messages (optional)

## Built-in commands

Both channels support slash commands:

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/help` | Show available commands |
| `/reset` | Start a new conversation |
| `/status` | Show current model and usage info |
| `/tts` | Voice reply settings (Telegram only) |

## Voice messages

Both channels support voice messages:

- **Inbound**: Voice messages are transcribed using the configured STT engine (server STT model)
- **Outbound**: When TTS is enabled, responses are sent as voice/audio messages
  - Telegram sends voice bubbles or audio files
  - WhatsApp sends PTT (Push-to-Talk) voice messages
