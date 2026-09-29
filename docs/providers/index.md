---
summary: "Models are published by the AskTab Rust service and relayed through it."
read_when:
  - Choosing a model
  - Understanding provider routing
title: "Providers Overview"
---

# Providers

Sign in to the AskTab service to use its published chat models. The service owns upstream URLs, model IDs, and API keys. The extension stores only public model details and your account JWT. Select a published model in the chat or Models settings.

Remote chat uses these protocols through the Rust relay:

| Upstream | Protocol |
|---|---|
| OpenAI, OpenRouter, Google-compatible, and custom OpenAI-compatible endpoints | `openai-completions` |
| Anthropic | `anthropic-messages` |
| Google Gemini (native `contents` / `candidates`) | `gemini-generate-content` |

The extension picks the SDK from the published protocol; the relay never converts between protocols. Gemini models use the Google GenAI SDK with base URL `/api/llm/{id}`, API version `v1beta`, and the public model ID, so streaming calls go to `/api/llm/{id}/v1beta/models/{id}:streamGenerateContent?alt=sse` with the JWT in `x-goog-api-key`. Thought signatures are kept in the model transcript and sent back with tool results and later turns.

Models published with `supportsTools: false` run without tool declarations or generated tool-use instructions. To enable web search or other tools, the service must publish tool support for an upstream that supports function calling. Mentioning tools in a system prompt does not make them callable.

Gemini abnormal finish reasons (such as `MALFORMED_FUNCTION_CALL` or `SAFETY`) are shown in the error instead of being replaced with a generic unknown error. This is maintained as a pnpm patch to `@mariozechner/pi-ai@0.53.0` in `patches/`; review it when upgrading the dependency. The Google SDK may omit upstream `finishMessage` details, so the finish reason is the reliable diagnostic in the current native relay.

The service stores each upstream model ID, Base URL, and API key, then publishes a public model ID to the extension. Import models using the six-column CSV format documented in the Rust service README. Custom OpenAI-compatible endpoints must support `/chat/completions` and standard streaming responses when streaming is needed. The service also publishes separate STT, TTS, and Embedding models. The extension has no upstream credential form.

| Setting | Meaning |
|---|---|
| Public model | ID and display name chosen from the signed-in service catalog |
| Supports tools / reasoning | Capabilities published by the service |
| Context window | Published model limit when present, otherwise the built-in estimate |
| Tool timeout | How long an agent tool may run |

Remote model requests use the current JWT for authentication. The JWT is kept in account session storage and excluded from full backups.
