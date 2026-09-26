import 'webextension-polyfill';
import { handleLLMStream } from './agents/stream-handler';
import { handleAskMessage, refreshSessionOnStartup } from './ask-service/session';
import {
  ALARM_NAME,
  handleBackupMessage,
  initializeBackup,
  runAutomaticBackup,
} from './backup/service';
import {
  connectChannel,
  getChannelState,
  initChannels,
  removeServerChannel,
  saveLocalChannelConfig,
  setServerChannelEnabled,
} from './channels';
import { isChannelPollAlarm, runPollCycle, stopChannelPolling } from './channels/poller';
import { CronService, readRunLogs } from './cron';
import { executeScheduledTask } from './cron/executor';
import { HeartbeatService, setHeartbeatServiceRef } from './heartbeat';
import {
  createLogger,
  configReady,
  getLogEntries,
  clearLogEntries,
  registerStreamPort,
} from './logging/logger-buffer';
import { runSessionJournal } from './memory/memory-journal';
import { initNetworkStatus } from './network/network-status';
import { setCronServiceRef } from './tools/scheduler';
import { createKeepAliveManager } from './utils/keep-alive';
import { initSidePanelBehavior } from '@extension/shared';
import { diagnostics } from '@extension/shared/lib/diagnostics.js';
import { askSessionStorage, getScheduledTask } from '@extension/storage';
import type { ChatMessage, ChatModel, LLMRequestMessage, LogCategory } from '@extension/shared';

// ── Port Listener for LLM Streaming ───────────

// ── Side Panel Behavior ────────────────────────

// ── Loggers ─────────────────────────────────
const cronLog = createLogger('cron');
const slashCmdLog = createLogger('slash-cmd');
const mediaLog = createLogger('media');

// Tracks the open mic-permission popup so repeat clicks focus it instead of
// spawning duplicate windows.
let micPermissionWindowId: number | null = null;

const cronService = new CronService({
  log: cronLog,
  executeTask: executeScheduledTask,
  onEvent: evt => {
    chrome.runtime.sendMessage({ type: 'CRON_EVENT', ...evt }).catch(() => {});
  },
});

setCronServiceRef(cronService);

// ── Network status broadcaster ──────────────────
// Single source of truth for online/offline transitions. Emits NETWORK_STATUS
// messages to all open pages on real state changes, with internal dedup so
// burst events (e.g. after waking from hibernate) collapse into one broadcast.
initNetworkStatus();

// ── Heartbeat subsystem ─────────────────────────
const heartbeatLog = createLogger('heartbeat');
const heartbeatService = new HeartbeatService({
  log: heartbeatLog,
  onEvent: evt => {
    chrome.runtime.sendMessage({ type: 'HEARTBEAT_EVENT', ...evt }).catch(() => {});
  },
});
setHeartbeatServiceRef(heartbeatService);
Promise.resolve().then(() =>
  heartbeatService.start().catch(err => {
    heartbeatLog.error('Failed to start heartbeat service', { error: String(err) });
  }),
);

chrome.runtime.onInstalled.addListener(() => {
  heartbeatService.start().catch(err => {
    heartbeatLog.error('onInstalled heartbeat start failed', { error: String(err) });
  });
});
chrome.runtime.onStartup.addListener(() => {
  heartbeatService.start().catch(err => {
    heartbeatLog.error('onStartup heartbeat start failed', { error: String(err) });
  });
});

// Start cron — use microtask to avoid setTimeout race with Firefox event page suspension.
// IndexedDB is available immediately; the 1-second delay was unnecessary and risky.
Promise.resolve().then(() =>
  cronService.start().catch(err => {
    cronLog.error('Failed to start cron service', { error: String(err) });
  }),
);

// ── Strip CORP headers for extension image loads ──
// Google CDN (and other servers) set Cross-Origin-Resource-Policy: same-site,
// which blocks <img> loads from chrome-extension:// pages.
// This dynamic rule removes that header for image requests initiated by the extension.
// NOTE: Use string literals for action type / header operation / resource type —
// Firefox does not expose the Chrome-style enum objects (RuleActionType, HeaderOperation, etc.).
const CORP_STRIP_RULE_ID = 9999;
try {
  chrome.declarativeNetRequest
    .updateDynamicRules({
      removeRuleIds: [CORP_STRIP_RULE_ID],
      addRules: [
        {
          id: CORP_STRIP_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
            responseHeaders: [
              {
                header: 'Cross-Origin-Resource-Policy',
                operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation,
              },
            ],
          },
          condition: {
            resourceTypes: ['image' as chrome.declarativeNetRequest.ResourceType],
            initiatorDomains: [chrome.runtime.id],
          },
        },
      ],
    })
    .catch(err => {
      diagnostics.error('[corp-strip] Failed to register CORP header rule:', err);
    });
} catch (err) {
  diagnostics.error('[corp-strip] Failed to create CORP header rule:', err);
}

// ── Message Handlers ───────────────────────────

type MessageHandler = (
  request: Record<string, unknown>,
) => Promise<Record<string, unknown> | undefined>;

const messageHandlers: Record<string, MessageHandler> = {
  ASK_LOGIN: handleAskMessage,
  ASK_REGISTER: handleAskMessage,
  ASK_LOGOUT: handleAskMessage,
  ASK_SYNC_MODELS: handleAskMessage,
  BACKUP_STATUS: handleBackupMessage,
  BACKUP_SET_ENABLED: handleBackupMessage,
  BACKUP_RUN: handleBackupMessage,
  BACKUP_HISTORY: handleBackupMessage,
  BACKUP_DELETE_REVISION: handleBackupMessage,
  BACKUP_KEEP_LATEST: handleBackupMessage,
  BACKUP_RESTORE_PREVIEW: handleBackupMessage,
  BACKUP_RESTORE: async request => {
    let stopped = false;
    try {
      const response = await handleBackupMessage(request, async () => {
        cronService.stop();
        stopped = true;
        await heartbeatService.stop();
        await stopChannelPolling();
      });
      setTimeout(() => chrome.runtime.reload(), 500);
      return response;
    } catch (error) {
      if (stopped)
        await Promise.allSettled([cronService.start(), heartbeatService.start(), initChannels()]);
      throw error;
    }
  },
  GET_LOGS: async () => ({ ...getLogEntries() }),

  CLEAR_LOGS: async () => {
    clearLogEntries();
    return { success: true };
  },

  HEARTBEAT_RUN_NOW: async request => {
    const agentId = typeof request.agentId === 'string' ? request.agentId : undefined;
    if (!agentId) return { success: false, error: 'agentId required' };
    heartbeatService.requestHeartbeatNow({ reason: 'manual', agentId });
    return { success: true };
  },

  LOG_RELAY: async request => {
    const category =
      typeof request.category === 'string' ? (request.category as LogCategory) : 'media';
    const logger = createLogger(category);
    const level = request.level as string;
    const logFn = logger[level as keyof typeof logger];
    if (logFn) logFn(request.message as string, request.data);
    return {};
  },

  CHANNEL_GET: async request => {
    const state = await getChannelState(request.channelId);
    return { ...state };
  },

  CHANNEL_SAVE_CONFIG: async request => {
    const updates =
      request.config && typeof request.config === 'object'
        ? (request.config as Record<string, unknown>)
        : {};
    await saveLocalChannelConfig(request.channelId, updates);
    return { success: true };
  },

  CHANNEL_CONNECT: async request => ({ view: await connectChannel(request) }),

  CHANNEL_SET_ENABLED: async request => {
    if (typeof request.enabled !== 'boolean') throw new Error('enabled must be a boolean');
    return { view: await setServerChannelEnabled(request.channelId, request.enabled) };
  },

  CHANNEL_REMOVE: async request => {
    await removeServerChannel(request.channelId);
    return { success: true };
  },

  TRANSCRIBE_DICTATION: async request => {
    const { resolveTranscription } = await import('./media-understanding');
    const base64 = request.audio as string;
    const mimeType = (request.mimeType as string) || 'audio/webm';
    try {
      // Decode inside the try so a malformed-base64 DOMException is logged too,
      // not just failures from resolveTranscription.
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      mediaLog.info('TRANSCRIBE_DICTATION received', { mimeType, bytes: bytes.length });
      const transcript = await resolveTranscription(bytes.buffer, mimeType);
      mediaLog.info('TRANSCRIBE_DICTATION succeeded', { length: transcript.length });
      return { transcript };
    } catch (err) {
      mediaLog.error('TRANSCRIBE_DICTATION failed', {
        mimeType,
        base64Length: base64?.length ?? 0,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  // Opens a normal popup window that requests microphone permission. The side
  // panel's getUserMedia prompt is unreliable (shows "Permission dismissed"),
  // but a top-level window prompts reliably and the grant persists to the
  // extension origin, so the side-panel mic works afterwards.
  OPEN_MIC_PERMISSION: async () => {
    // Focus an already-open popup instead of spawning a duplicate.
    if (micPermissionWindowId !== null) {
      try {
        await chrome.windows.update(micPermissionWindowId, { focused: true });
        mediaLog.info('OPEN_MIC_PERMISSION focused existing window', {
          windowId: micPermissionWindowId,
        });
        return { windowId: micPermissionWindowId };
      } catch {
        // Window was closed out from under us — fall through and create a new one.
        micPermissionWindowId = null;
      }
    }
    try {
      const url = chrome.runtime.getURL('mic-permission.html');
      const win = await chrome.windows.create({
        url,
        type: 'popup',
        width: 420,
        height: 320,
        focused: true,
      });
      micPermissionWindowId = win.id ?? null;
      mediaLog.info('OPEN_MIC_PERMISSION opened window', { windowId: micPermissionWindowId });
      return { windowId: micPermissionWindowId };
    } catch (err) {
      mediaLog.error('OPEN_MIC_PERMISSION failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  SUBAGENT_STOP: async request => {
    const runId = request.runId as string;
    if (!runId) return { status: 'error', error: 'runId is required' };
    const { executeKillSubagent } = await import('./tools/subagent');
    const result = await executeKillSubagent({ runId });
    return JSON.parse(result);
  },

  MEMORY_FORGET_AGENT: async request => {
    const agentId = request.agentId as string;
    if (!agentId) return { error: 'agentId is required' };
    const { forgetAgentMemory } = await import('./memory/memory-service');
    await forgetAgentMemory(agentId);
    return { success: true };
  },

  SESSION_JOURNAL: async request => {
    const chatId = request.chatId as string;
    if (!chatId) return { error: 'chatId is required' };
    const agentId = (request.agentId as string) || undefined;
    cronLog.debug('Session journal requested', { chatId, agentId });
    streamKeepAlive.acquire();
    try {
      const result = await runSessionJournal({ chatId, agentId });
      return { result };
    } finally {
      streamKeepAlive.release();
    }
  },

  CRON_STATUS: async () => {
    const result = await cronService.status();
    return { status: result };
  },

  CRON_LIST_TASKS: async request => {
    const tasks = await cronService.list({
      includeDisabled: (request.includeDisabled as boolean) ?? true,
    });
    return { tasks };
  },

  CRON_GET_TASK: async request => {
    const id = request.taskId as string;
    if (!id) return { error: 'taskId is required' };
    const task = await getScheduledTask(id);
    return { task: task ?? null };
  },

  CRON_TOGGLE_TASK: async request => {
    const id = request.taskId as string;
    const enabled = request.enabled as boolean;
    if (!id) return { error: 'taskId is required' };
    await cronService.update(id, { enabled });
    return { success: true };
  },

  CRON_DELETE_TASK: async request => {
    const id = request.taskId as string;
    if (!id) return { error: 'taskId is required' };
    const result = await cronService.remove(id);
    return result;
  },

  CRON_RUN_NOW: async request => {
    const id = request.taskId as string;
    if (!id) return { error: 'taskId is required' };
    const result = await cronService.run(id, 'force');
    return result;
  },

  CRON_GET_RUNS: async request => {
    const id = request.taskId as string;
    if (!id) return { error: 'taskId is required' };
    const runs = await readRunLogs(id, 50);
    return { runs };
  },

  CHECK_LOCAL_STORAGE: async request => {
    const tabId = request.tabId as number;
    const keys = request.keys as string[];
    if (!tabId || !keys?.length) return { tokens: null };
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (indicators: string[]) =>
          indicators.reduce(
            (acc, name) => {
              const val = localStorage.getItem(name);
              if (val) acc[name] = val;
              return acc;
            },
            {} as Record<string, string>,
          ),
        args: [keys],
      });
      const tokens = results?.[0]?.result as Record<string, string> | undefined;
      return { tokens: tokens && Object.keys(tokens).length > 0 ? tokens : null };
    } catch {
      return { tokens: null };
    }
  },

  COMPACT_REQUEST: async request => {
    const chatId = request.chatId as string;
    const modelConfig = request.modelConfig as ChatModel;
    if (!chatId || !modelConfig) return { error: 'chatId and modelConfig are required' };

    slashCmdLog.trace('COMPACT_REQUEST received', { chatId, modelId: modelConfig.id });
    streamKeepAlive.acquire();

    try {
      const {
        getMessagesByChatId,
        getChat,
        updateCompactionSummary,
        incrementCompactionCount,
        getEnabledWorkspaceFiles,
      } = await import('@extension/storage');
      const { compactMessagesWithSummary } = await import('./context/compaction');
      const { enforceToolResultBudget } = await import('./context/tool-result-context-guard');
      const { extractCriticalRules } = await import('./context/summarizer');
      const { buildHeadlessSystemPrompt } = await import('./agents/agent-setup');
      const { getProviderTokenLimit } = await import('./context/provider-limit-cache');

      const [messages, chat] = await Promise.all([getMessagesByChatId(chatId), getChat(chatId)]);
      slashCmdLog.debug('Loaded messages for compaction', {
        chatId,
        messageCount: messages.length,
      });
      if (messages.length <= 2) return { error: 'Not enough messages to compact' };

      // Build system prompt to get accurate token count (same as stream-handler.ts)
      const agentId = chat?.agentId ?? 'main';
      const systemPrompt = await buildHeadlessSystemPrompt(modelConfig, agentId);
      const systemPromptTokens = Math.ceil(systemPrompt.length / 4);

      // Use the lower of model contextWindow and any detected provider limit
      const cachedLimit = getProviderTokenLimit(modelConfig.id);
      const effectiveContextWindow =
        cachedLimit && modelConfig.contextWindow
          ? Math.min(cachedLimit, modelConfig.contextWindow)
          : (cachedLimit ?? modelConfig.contextWindow);

      slashCmdLog.trace('COMPACT_REQUEST: effective context window', {
        cachedLimit,
        modelContextWindow: modelConfig.contextWindow,
        effectiveContextWindow,
      });

      // Pre-compaction: enforce tool result budget (same as transform.ts auto-compaction path)
      const guarded = enforceToolResultBudget(
        messages as ChatMessage[],
        modelConfig.id,
        effectiveContextWindow,
      );

      // Extract critical rules from workspace files for summary context
      const workspaceFiles = await getEnabledWorkspaceFiles(agentId);
      const criticalRules = extractCriticalRules(workspaceFiles);

      const result = await compactMessagesWithSummary(guarded, modelConfig.id, modelConfig, {
        existingSummary: chat?.compactionSummary,
        systemPromptTokens,
        contextWindowOverride: effectiveContextWindow,
        force: true,
        criticalRules,
      });

      if (!result.wasCompacted) {
        // force compaction was requested but nothing was compacted — this can happen
        // when there are too few messages to summarize (e.g. only anchor + 1 message)
        return { error: 'Not enough messages to compact' };
      }

      slashCmdLog.info('Compaction result', {
        chatId,
        wasCompacted: result.wasCompacted,
        compactionMethod: result.compactionMethod,
        summaryLength: result.summary?.length ?? 0,
        keptMessages: result.messages.length,
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
        tokensSaved:
          result.tokensBefore && result.tokensAfter
            ? result.tokensBefore - result.tokensAfter
            : undefined,
        messagesDropped: result.messagesDropped,
        durationMs: result.durationMs,
      });

      // Persist: delete old messages and keep only the compacted set
      const { deleteMessagesByChatId, addMessage } = await import('@extension/storage');
      await deleteMessagesByChatId(chatId);
      for (const msg of result.messages) {
        await addMessage({ ...msg, chatId });
      }

      if (result.summary) await updateCompactionSummary(chatId, result.summary);
      await incrementCompactionCount(chatId);

      return {
        success: true,
        summary: result.summary ?? '',
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
        messagesDropped: result.messagesDropped,
        compactionMethod: result.compactionMethod,
        durationMs: result.durationMs,
      };
    } catch (err) {
      slashCmdLog.error('Compaction failed', { chatId, error: String(err) });
      throw err;
    } finally {
      streamKeepAlive.release();
    }
  },
};

chrome.runtime.onMessage.addListener(
  (
    request: Record<string, unknown>,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: Record<string, unknown> | undefined) => void,
  ) => {
    const handler = messageHandlers[request.type as string];
    if (handler) {
      handler(request)
        .then(sendResponse)
        .catch(err => sendResponse({ error: err instanceof Error ? err.message : String(err) }));
      return true; // Keep message channel open for async response
    }
    return false;
  },
);

// Clear the mic-permission popup tracker when the user closes that window.
chrome.windows.onRemoved.addListener(windowId => {
  if (windowId === micPermissionWindowId) micPermissionWindowId = null;
});

const streamKeepAlive = createKeepAliveManager('keep-alive');

chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'log-stream') {
    registerStreamPort(port);
    return;
  }

  if (port.name === 'llm-stream') {
    streamKeepAlive.acquire();

    port.onDisconnect.addListener(() => {
      streamKeepAlive.release();
    });

    port.onMessage.addListener((msg: Record<string, unknown>) => {
      if (msg.type === 'LLM_REQUEST') {
        handleLLMStream(port, msg as unknown as LLMRequestMessage);
      }
    });
  }
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (HeartbeatService.isSchedulerAlarm(alarm.name)) {
    heartbeatService.handleAlarm(alarm).catch(err => {
      heartbeatLog.error('Heartbeat alarm handler failed', { error: String(err) });
    });
  } else if (CronService.isSchedulerAlarm(alarm.name)) {
    cronService.handleAlarm().catch(err => {
      cronLog.error('Cron alarm handler failed', { error: String(err) });
    });
  } else if (alarm.name === ALARM_NAME) {
    runAutomaticBackup().catch(err => diagnostics.error('[backup] Automatic backup failed:', err));
  } else if (isChannelPollAlarm(alarm.name)) {
    runPollCycle().catch(err => diagnostics.error('[alarm] Channel poll failed:', err));
  }
  // keep-alive alarms: no-op (they only keep the service worker active)
});

// ── Channel Initialization ────────────────────

const channelLog = createLogger('channel-init');
const initWithRetry = async (attempts = 3, delayMs = 2000): Promise<void> => {
  for (let i = 0; i < attempts; i++) {
    try {
      await initChannels();
      return;
    } catch (err) {
      channelLog.error('Init failed', { attempt: i + 1, attempts, error: String(err) });
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
};
// Log config must be loaded first so structured channel logs aren't silently dropped.
configReady
  .then(() => initWithRetry())
  .catch(err => diagnostics.error('[channels] configReady failed:', err));
askSessionStorage.subscribe(() => {
  initChannels().catch(err =>
    channelLog.warn('Channel refresh after session change failed', { error: String(err) }),
  );
});

refreshSessionOnStartup().catch(err => diagnostics.error('[account] Model sync failed:', err));
let backupInitialization = Promise.resolve();
const refreshBackupForAccount = () => {
  backupInitialization = backupInitialization
    .then(() => initializeBackup())
    .catch(err => diagnostics.error('[backup] Initialization failed:', err));
};
askSessionStorage.subscribe(refreshBackupForAccount);
refreshBackupForAccount();

initSidePanelBehavior();
