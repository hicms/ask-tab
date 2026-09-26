---
summary: "Speech-to-text through an STT model published by the AskTab server."
read_when:
  - Configuring speech-to-text
  - Understanding voice input options
title: "Speech-to-Text (STT)"
---

# Speech-to-Text (STT)

AskTab transcribes voice input and channel voice messages with an STT model published by the AskTab server.

## Server STT

Transcription uses a published server STT model. The extension sends audio and its AskTab JWT to the Rust relay; the service holds the upstream model and API key.

### Features

- **Endpoint**: `/api/audio/{model}/transcriptions` on the AskTab service
- **Format detection**: Uses the recorded audio MIME type
- **Language support**: Supports language specification for better accuracy
- **Compatible**: The server can relay to any OpenAI-compatible transcription API

---

## Engine selection

| Mode | Behavior |
|------|----------|
| `auto` | Same as `openai` |
| `openai` | Use the selected server STT model; show a configuration error when unavailable |
| `off` | Disable STT |

## Usage

### Side panel

Click the microphone button in the chat input to record audio. The recording is transcribed and inserted as a text message.

### Channel voice messages

Voice messages received via Telegram are transcribed and the transcript replaces the audio content in the message sent to the agent. Voice audio is downloaded via the Bot API (`getFile` + `downloadFile`).

WhatsApp voice messages are currently delivered to the agent as a `[Voice message]` or `[Audio]` placeholder without a transcript.
