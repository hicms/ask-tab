---
summary: "Text-to-speech through a TTS model published by the AskTab server."
read_when:
  - Configuring text-to-speech
  - Understanding server TTS
title: "Text-to-Speech (TTS)"
---

# Text-to-Speech (TTS)

AskTab synthesizes speech with a TTS model published by the AskTab server. The engine setting is either `off` or `openai` (AskTab server).

## Server TTS

Synthesis uses a published server TTS model. The extension sends text and its AskTab JWT to the Rust relay; the service holds the upstream API key.

### Features

- **Endpoint**: `/api/audio/{model}/speech` on the AskTab service
- **Output**: Opus audio (24kHz sample rate)
- **No streaming**: Single synthesis call (entire text at once)
- **Compatible**: The server can relay to any OpenAI-compatible TTS API

### Default settings

| Setting | Default |
|---------|---------|
| Model | Selected public server model |
| Voice | `nova` |

### Server configuration

The Rust service operator imports the TTS endpoint, upstream model ID, and API key. The browser settings contain only the public model ID and voice.

## Text preprocessing

Before synthesis, text is cleaned for better audio output:

- Code blocks are removed
- URLs are stripped
- Markdown formatting is removed

For long responses, AskTab can optionally summarize the text via the LLM to fit within a configurable character limit (`maxChars`).

## Channel voice messages

When TTS is enabled for channel responses:

- **Telegram**: Audio sent as voice bubble (`sendVoice`) or audio file (`sendAudio`)
- **WhatsApp**: Audio sent as PTT (Push-to-Talk) voice message via the AskTab service
