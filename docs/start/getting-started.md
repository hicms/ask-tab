---
summary: "Quick start guide for AskTab — install, configure a model, and start chatting."
read_when:
  - Setting up AskTab for the first time
  - Looking for a quick start guide
title: "Getting Started"
---

# Getting Started

AskTab is ready to use in minutes. Install the extension, sign in to your AskTab account, and start chatting.

## Prerequisites

- Chrome 120+ or Firefox 128+
- A running AskTab service (`ask_service`) with models imported; the extension connects to `CEB_ASK_SERVICE_URL` (default `http://127.0.0.1:37817`)

## Step 1: Install the extension

Build the extension from source and load it in developer mode. See [Installation](/start/installation).

## Step 2: Sign in

1. Click the AskTab icon in your browser toolbar
2. On first run, you'll see the **First Run Setup** screen
3. Enter your email and password, or choose **No account? Create one**
4. Click **Sign in**

After sign-in the extension loads the models published by the server. Switch between them at any time from the chat interface.

## Step 3: Start chatting

Open any web page and click the AskTab icon to open the side panel. Type a message and press Enter.

AskTab streams responses in real time with markdown rendering. Models that support reasoning (like OpenAI o-series or Anthropic Claude) show collapsible thinking output.

## What's next

<CardGroup cols={2}>
  <Card title="Workspace Files" href="/concepts/workspace-files" icon="file-text">
    Add persistent context to every conversation
  </Card>
  <Card title="Tools" href="/tools/index" icon="wrench">
    Enable web search, browser automation, and more
  </Card>
  <Card title="Channels" href="/channels/index" icon="message-circle">
    Connect WhatsApp or Telegram
  </Card>
  <Card title="Agents" href="/agents/index" icon="users">
    Create named agents with custom personalities
  </Card>
</CardGroup>

## Managing models

Open the **Options** page (right-click the extension icon → Options, or use the gear icon in the side panel) to:

- View and refresh the server's models
- Set default models per agent
- Sign out of your account

Models, their provider API keys and upstream addresses are managed on the server; the extension never receives them.

## Settings overview

The Options page is organized into three tab groups:

- **Control** — Channels, Cron Jobs, Sessions, Usage
- **Agent** — Agents, Tools, Skills
- **Settings** — General, Models, Actions, Logs
