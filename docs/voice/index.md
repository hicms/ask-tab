---
summary: "Voice overview — text-to-speech and speech-to-text through AskTab server models."
read_when:
  - Setting up voice features
  - Understanding TTS and STT options
  - Configuring auto-mode for voice
title: "Voice Overview"
---

# Voice

AskTab supports both text-to-speech (TTS) and speech-to-text (STT) through models published by the AskTab server. Voice features work in the side panel chat and through messaging channels.

## Engines

| Feature | Engine |
|---------|--------|
| **[TTS](/voice/tts)** | Server TTS model (OpenAI-compatible) |
| **[STT](/voice/stt)** | Server STT model (OpenAI-compatible) |

## Auto-mode

TTS auto-mode controls when responses are spoken aloud:

| Mode | Behavior |
|------|----------|
| `off` | TTS disabled — responses are text only |
| `always` | Every response is spoken aloud |
| `inbound` | Only speak responses triggered by voice input or channel messages |

Configure auto-mode on the Options page under General settings or via the `/tts` command in Telegram.

## How voice works

### In the side panel

1. Click the microphone button to start recording
2. Audio is transcribed using the configured STT engine
3. The transcript is sent as a text message to the agent
4. If TTS is enabled, the response is synthesized and played back

### In messaging channels

1. Voice messages received via WhatsApp or Telegram are transcribed
2. The transcript is processed by the agent
3. If TTS is enabled, the response is sent back as a voice/audio message

## Text preprocessing

Before synthesis, AskTab cleans text for better TTS output:

- Removes code blocks
- Strips URLs
- Removes markdown formatting
- Handles special characters

For long responses, text can be summarized via the LLM to fit within the configured character limit before synthesis.
