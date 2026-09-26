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

The service stores each upstream model ID, Base URL, and API key, then publishes a public model ID to the extension. Import models using the six-column CSV format documented in the Rust service README. Custom OpenAI-compatible endpoints must support `/chat/completions` and standard streaming responses when streaming is needed. The service also publishes separate STT, TTS, and Embedding models. The extension has no upstream credential form.

| Setting | Meaning |
|---|---|
| Public model | ID and display name chosen from the signed-in service catalog |
| Supports tools / reasoning | Capabilities published by the service |
| Context window | Published model limit when present, otherwise the built-in estimate |
| Tool timeout | How long an agent tool may run |

Remote model requests use the current JWT for authentication. The JWT is kept in account session storage and excluded from full backups.
