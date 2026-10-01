// ---------------------------------------------------------------------------
// MCP bridge client — keeps a WebSocket open to the local MCP bridge
// (packages/mcp-bridge) and serves its tool requests.
//
// Each authenticated connection is one MCP session. It owns an AbortController
// whose signal is the ToolContext.signal of every call, so browser snapshot refs
// stay valid across calls and are released when the session ends.
// ---------------------------------------------------------------------------

import { callMcpTool, listMcpTools } from './mcp-tools';
import { createLogger } from '../logging/logger-buffer';
import { releaseToolResources } from '../tools/tool-lifecycle';
import { mcpBridgeConfigStorage } from '@extension/storage';
import type { BridgeToExtension, ExtensionToBridge } from '@extension/mcp-bridge/protocol';

const log = createLogger('tool');

const MCP_BRIDGE_ALARM = 'mcp-bridge-reconnect';
const ALARM_PERIOD_MINUTES = 0.5;
/** Below Chrome's 30s service worker idle limit, so traffic keeps the worker alive. */
const KEEPALIVE_INTERVAL_MS = 20_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
// Application close code (4000-4999); the bridge does not interpret it, it only helps diagnostics.
const HANDSHAKE_FAILED_CLOSE_CODE = 4401;
const NORMAL_CLOSE_CODE = 1000;
const HEX_64 = /^[0-9a-f]{64}$/;

type Phase = 'awaiting-challenge' | 'awaiting-welcome' | 'ready' | 'closed';

interface Link {
  ws: WebSocket;
  token: string;
  phase: Phase;
  extensionNonce?: string;
  controller?: AbortController;
  keepalive?: ReturnType<typeof setInterval>;
  /** Handshake messages are verified asynchronously; the chain keeps them in order. */
  inbound: Promise<void>;
}

/** A function call keeps TypeScript from narrowing phase across awaits. */
const isClosed = (target: Link): boolean => target.phase === 'closed';

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

const fromHex = (hex: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from((hex.match(/../g) ?? []).map(pair => parseInt(pair, 16)));

const hmacKey = (token: string, usage: KeyUsage): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(token),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );

const signExtensionProof = async (token: string, bridgeNonce: string): Promise<string> => {
  const key = await hmacKey(token, 'sign');
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`extension:${bridgeNonce}`),
  );
  return toHex(new Uint8Array(signature));
};

const verifyBridgeProof = async (
  token: string,
  extensionNonce: string,
  proof: string,
): Promise<boolean> =>
  crypto.subtle.verify(
    'HMAC',
    await hmacKey(token, 'verify'),
    fromHex(proof),
    new TextEncoder().encode(`bridge:${extensionNonce}`),
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Inbound messages come from a local process, so they are checked before use. */
const parseBridgeMessage = (raw: unknown): BridgeToExtension | undefined => {
  if (typeof raw !== 'string') return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  switch (value['type']) {
    case 'challenge':
      return {
        type: 'challenge',
        nonce: typeof value['nonce'] === 'string' ? value['nonce'] : '',
      };
    case 'welcome':
      return { type: 'welcome', proof: typeof value['proof'] === 'string' ? value['proof'] : '' };
    case 'list_tools':
      return typeof value['id'] === 'string' ? { type: 'list_tools', id: value['id'] } : undefined;
    case 'call_tool':
      return typeof value['id'] === 'string' && typeof value['name'] === 'string'
        ? { type: 'call_tool', id: value['id'], name: value['name'], args: value['args'] }
        : undefined;
    default:
      return undefined;
  }
};

const createMcpBridgeClient = () => {
  /** Port and token of the connection we want; undefined while MCP is off. */
  let wanted: { port: number; token: string } | undefined;
  let link: Link | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let backoffMs = INITIAL_BACKOFF_MS;
  let work: Promise<void> = Promise.resolve();

  const send = (target: Link, message: ExtensionToBridge): void => {
    if (link !== target) return;
    try {
      target.ws.send(JSON.stringify(message));
    } catch (err) {
      log.debug('Send failed', { error: String(err) });
    }
  };

  const endSession = async (target: Link): Promise<void> => {
    clearInterval(target.keepalive);
    target.keepalive = undefined;
    target.phase = 'closed';
    const controller = target.controller;
    target.controller = undefined;
    if (!controller) return;
    controller.abort();
    await releaseToolResources(controller.signal);
  };

  const rejectLink = (target: Link, reason: string): void => {
    log.warn('Closing bridge connection', { reason });
    target.phase = 'closed';
    target.ws.close(HANDSHAKE_FAILED_CLOSE_CODE, 'Handshake failed');
  };

  const clearRetry = (): void => {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  };

  const scheduleRetry = (): void => {
    if (!wanted || retryTimer) return;
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (wanted && !link) connect();
    }, delay);
  };

  const serve = (target: Link, controller: AbortController, message: BridgeToExtension): void => {
    if (message.type === 'list_tools') {
      send(target, { type: 'tools', id: message.id, tools: listMcpTools() });
    } else if (message.type === 'call_tool') {
      const { id, name, args } = message;
      callMcpTool(name, args, controller.signal)
        .then(result => send(target, { type: 'tool_result', id, ...result }))
        .catch(err => log.error('MCP tool call failed', { name, error: String(err) }));
    }
  };

  const handleMessage = async (target: Link, data: unknown): Promise<void> => {
    if (link !== target || isClosed(target)) return;
    const message = parseBridgeMessage(data);
    if (!message) {
      log.warn('Dropped a malformed bridge message');
      return;
    }

    switch (message.type) {
      case 'challenge': {
        if (target.phase !== 'awaiting-challenge' || !HEX_64.test(message.nonce)) {
          rejectLink(target, 'Unexpected or malformed challenge');
          return;
        }
        const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
        target.extensionNonce = nonce;
        const proof = await signExtensionProof(target.token, message.nonce);
        if (link !== target || isClosed(target)) return;
        target.phase = 'awaiting-welcome';
        send(target, { type: 'hello', nonce, proof });
        return;
      }
      case 'welcome': {
        if (
          target.phase !== 'awaiting-welcome' ||
          !target.extensionNonce ||
          !HEX_64.test(message.proof)
        ) {
          rejectLink(target, 'Unexpected or malformed welcome');
          return;
        }
        const valid = await verifyBridgeProof(target.token, target.extensionNonce, message.proof);
        if (link !== target || isClosed(target)) return;
        if (!valid) {
          rejectLink(target, 'The bridge did not prove it knows the token');
          return;
        }
        target.phase = 'ready';
        target.controller = new AbortController();
        target.keepalive = setInterval(
          () => send(target, { type: 'keepalive' }),
          KEEPALIVE_INTERVAL_MS,
        );
        backoffMs = INITIAL_BACKOFF_MS;
        log.info('MCP bridge session started');
        return;
      }
      default:
        if (target.phase !== 'ready' || !target.controller) {
          rejectLink(target, 'Request before the bridge was verified');
          return;
        }
        serve(target, target.controller, message);
    }
  };

  const connect = (): void => {
    if (!wanted) return;
    clearRetry();
    const { port, token } = wanted;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}`);
    } catch (err) {
      log.debug('Could not open the bridge connection', { error: String(err) });
      scheduleRetry();
      return;
    }
    const target: Link = {
      ws,
      token,
      phase: 'awaiting-challenge',
      inbound: Promise.resolve(),
    };
    link = target;

    ws.onmessage = event => {
      target.inbound = target.inbound
        .then(() => handleMessage(target, event.data))
        .catch(err => {
          log.error('Bridge message handling failed', { error: String(err) });
          if (!isClosed(target)) rejectLink(target, 'Message handling failed');
        });
    };
    ws.onerror = () => log.debug('Bridge connection error', { port });
    ws.onclose = event => {
      if (link !== target) return;
      link = undefined;
      log.debug('Bridge connection closed', { code: event.code });
      scheduleRetry();
      endSession(target).catch(err => log.warn('Session cleanup failed', { error: String(err) }));
    };
  };

  const disconnect = async (): Promise<void> => {
    clearRetry();
    const target = link;
    link = undefined;
    if (!target) return;
    target.ws.close(NORMAL_CLOSE_CODE);
    await endSession(target);
  };

  const ensureAlarm = async (): Promise<void> => {
    if (!(await chrome.alarms.get(MCP_BRIDGE_ALARM))) {
      await chrome.alarms.create(MCP_BRIDGE_ALARM, { periodInMinutes: ALARM_PERIOD_MINUTES });
    }
  };

  const reconcile = async (): Promise<void> => {
    const config = await mcpBridgeConfigStorage.get();
    if (!config.enabled || !config.token) {
      wanted = undefined;
      backoffMs = INITIAL_BACKOFF_MS;
      await disconnect();
      await chrome.alarms.clear(MCP_BRIDGE_ALARM);
      return;
    }
    const changed = wanted?.port !== config.port || wanted.token !== config.token;
    wanted = { port: config.port, token: config.token };
    await ensureAlarm();
    if (changed) {
      backoffMs = INITIAL_BACKOFF_MS;
      await disconnect();
    }
    if (!link) connect();
  };

  const enqueue = (): Promise<void> => {
    work = work
      .then(reconcile)
      .catch(err => log.error('MCP bridge setup failed', { error: String(err) }));
    return work;
  };

  return {
    /** Applies the stored configuration and follows later changes. */
    start: async (): Promise<void> => {
      mcpBridgeConfigStorage.subscribe(() => void enqueue());
      await enqueue();
    },
    /** The periodic alarm revives the connection after the service worker slept. */
    handleAlarm: async (): Promise<void> => {
      await work;
      if (wanted && !link) connect();
    },
  };
};

const isMcpBridgeAlarm = (alarmName: string): boolean => alarmName === MCP_BRIDGE_ALARM;

export { createMcpBridgeClient, isMcpBridgeAlarm, MCP_BRIDGE_ALARM };
