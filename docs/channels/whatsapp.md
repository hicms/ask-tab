---
summary: "WhatsApp channel — connect via QR code pairing on the AskTab service, sender control, voice messages, and message formatting."
read_when:
  - Setting up WhatsApp integration
  - Troubleshooting WhatsApp connection
  - Understanding WhatsApp message handling
title: "WhatsApp"
---

# WhatsApp

AskTab connects to WhatsApp through the AskTab service, which maintains the WhatsApp WebSocket session and queues inbound messages. The extension leases messages from that queue and routes them through the agent system; no WhatsApp credentials are stored in the browser.

## Setup

1. Open the **Options** page → **Channels** → **WhatsApp**
2. Click **Connect**
3. A QR code will appear — scan it with your WhatsApp mobile app (Settings → Linked Devices → Link a Device)
4. Once linked, the status will show "Connected" with your phone number
5. Add allowed sender IDs to the allowlist

### Allowed senders

The `allowedSenderIds` list controls who can interact with the agent. Add phone numbers in JID format:

```
12345678901@s.whatsapp.net
```

Device suffixes are automatically stripped for matching — `12345:67@s.whatsapp.net` matches `12345@s.whatsapp.net`.

## Direction filtering

WhatsApp supports separate controls for message direction:

| Setting | Default | Description |
|---------|---------|-------------|
| `acceptFromMe` | `true` | Process messages you send from your phone |
| `acceptFromOthers` | `false` | Process messages from other people |

This lets you use AskTab as a personal assistant by sending messages to yourself, or open it to specific contacts.

## Message handling

### Inbound messages

Each inbound message includes:

- **Sender ID** — WhatsApp JID (phone@s.whatsapp.net)
- **Chat type** — Direct or group (only direct messages are processed)
- **Body** — Message text
- **Voice flag** — Whether the message is a voice note

### Voice messages

- Inbound voice messages are detected via the `isAudio` flag
- The extension downloads the audio from the service queue and transcribes it using the configured STT engine
- The transcript replaces the audio in the message body sent to the agent

When TTS is enabled for outbound messages:
- Responses are synthesized using the configured TTS engine
- Audio is sent back as a WhatsApp PTT (Push-to-Talk) voice message via the AskTab service

### Message formatting

AskTab converts LLM markdown output to WhatsApp markup:

| Markdown | WhatsApp |
|----------|----------|
| `**bold**` | `*bold*` |
| `*italic*` | `_italic_` |
| `` `code` `` | `` ```code``` `` |
| `~~strike~~` | `~strike~` |
| `[text](url)` | `text (url)` |

Code blocks and protected content are processed carefully to avoid formatting conflicts.

### Message splitting

Messages longer than 4,096 characters are automatically split at natural boundaries (newlines, then spaces).

## Connection model

The AskTab service maintains the **push-based** WhatsApp WebSocket connection and queues inbound messages:

- The WhatsApp session lives on the service — unlinking or relinking is done from the Options page
- The extension leases queued messages from the service (short wait when idle, longer wait while a conversation is active) and acknowledges each item once handled
- Direction settings (`acceptFromMe` / `acceptFromOthers`) are applied by the service before queueing

<Warning>
While the extension is not polling (browser closed or service worker idle between alarms), messages wait in the service queue and are processed on the next poll.
</Warning>

## Bot commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/help` | Show available commands |
| `/reset` | Start a new conversation |
| `/status` | Show current model and usage info |

## Configuration

| Setting | Description |
|---------|-------------|
| `enabled` | Enable/disable the channel |
| `allowedSenderIds` | Phone JIDs allowed to interact |
| `acceptFromMe` | Accept messages from your own phone |
| `acceptFromOthers` | Accept messages from other people |
| `modelId` | Override default model for this channel |
