import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@extension/shared/lib/diagnostics.js': path.resolve(
        __dirname,
        'packages/shared/lib/diagnostics.ts',
      ),
      '@extension/env': path.resolve(__dirname, 'packages/env/index.mts'),
      '@extension/i18n': path.resolve(__dirname, 'packages/i18n/lib/index.ts'),
      '@extension/shared': path.resolve(__dirname, 'packages/shared/index.mts'),
      '@extension/storage': path.resolve(__dirname, 'packages/storage/lib/index.ts'),
      '@storage-internal': path.resolve(__dirname, 'packages/storage/lib/impl'),
      '@extension/skills': path.resolve(__dirname, 'packages/skills/index.mts'),
      '@extension/config-panels': path.resolve(__dirname, 'packages/config-panels/index.ts'),
    },
  },
  test: {
    include: [
      'tests/unit/**/*.test.ts',
      'packages/*/lib/**/*.test.ts',
      'chrome-extension/src/**/*.test.ts',
      'pages/*/src/**/*.test.ts',
    ],
    setupFiles: ['packages/storage/lib/test-setup.ts'],
    coverage: {
      provider: 'v8',
      include: [
        // Packages — shared
        'packages/shared/lib/chat-types.ts',
        'packages/shared/lib/prompts.ts',
        'packages/shared/lib/skill-parser.ts',
        'packages/shared/lib/skill-zip-import.ts',
        'packages/storage/lib/impl/chat-storage.ts',

        // Background — agents
        'chrome-extension/src/background/agents/agent-setup.ts',
        'chrome-extension/src/background/agents/stream-handler.ts',
        'chrome-extension/src/background/agents/message-adapter.ts',
        'chrome-extension/src/background/agents/model-adapter.ts',
        'chrome-extension/src/background/agents/model-compat.ts',
        'chrome-extension/src/background/agents/stream-bridge.ts',
        // local-llm-bridge.ts excluded — Chrome runtime messaging IPC with offscreen document,
        // covered with runtime mocks in local-llm-bridge.test.ts, not a real offscreen E2E.

        // Background — context
        'chrome-extension/src/background/context/compaction.ts',
        // context/limits.ts excluded — pure re-export shim, actual code tested via @extension/shared
        'chrome-extension/src/background/context/summarizer.ts',
        'chrome-extension/src/background/context/transform.ts',
        'chrome-extension/src/background/context/tool-result-truncation.ts',

        // Background — logging & errors
        'chrome-extension/src/background/logging/logger-buffer.ts',
        'chrome-extension/src/background/errors/error-classification.ts',

        // Tools
        // get-weather.ts removed
        'chrome-extension/src/background/tools/index.ts',
        'chrome-extension/src/background/tools/browser.ts',
        'chrome-extension/src/background/tools/agent-tab-group.ts',
        'chrome-extension/src/background/tools/workspace.ts',
        'chrome-extension/src/background/tools/web-search.ts',
        'chrome-extension/src/background/tools/deep-research.ts',
        'chrome-extension/src/background/tools/execute-js.ts',
        'chrome-extension/src/background/tools/google-auth.ts',
        'chrome-extension/src/background/tools/web-fetch.ts',
        'chrome-extension/src/background/tools/scheduler.ts',
        'chrome-extension/src/background/tools/agents-list.ts',
        'chrome-extension/src/background/tools/memory-tools.ts',

        // Channels
        // agent-handler.ts excluded — heavy integration file (Chrome alarms, TTS, media transcription,
        // draft streaming state machine, channel-specific reactions). No direct E2E coverage.
        'chrome-extension/src/background/channels/message-bridge.ts',
        'chrome-extension/src/background/channels/poller.ts',
        'chrome-extension/src/background/channels/config.ts',
        'chrome-extension/src/background/channels/telegram/bot-api.ts',

        // Memory
        'chrome-extension/src/background/memory/memory-search.ts',
        'chrome-extension/src/background/memory/memory-chunker.ts',
        'chrome-extension/src/background/memory/memory-journal.ts',
        'chrome-extension/src/background/memory/serialize-transcript.ts',

        // Cron
        'chrome-extension/src/background/cron/executor.ts',
        'chrome-extension/src/background/cron/service/timer.ts',
        'chrome-extension/src/background/cron/service/jobs.ts',
        'chrome-extension/src/background/cron/schedule.ts',

        // Pages
        'pages/side-panel/src/lib/artifact-stream.ts',
        'pages/side-panel/src/components/search-results.tsx',
      ],
      thresholds: {
        lines: 85,
        branches: 85,
      },
    },
  },
});
