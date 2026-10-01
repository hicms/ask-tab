import { AUTH_FAILED_CLOSE_CODE } from './protocol.js';
import { WebSocketServer } from 'ws';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  BridgeContent,
  BridgeTool,
  BridgeToExtension,
  ExtensionToBridge,
} from './protocol.js';
import type { AddressInfo } from 'node:net';
import type { RawData, WebSocket } from 'ws';

const HOST = '127.0.0.1';
const HEX_64 = /^[0-9a-f]{64}$/;
const EXTENSION_ORIGIN = /^(chrome|moz)-extension:\/\//;
const REPLACED_CLOSE_CODE = 4000;
const DEFAULT_AUTH_TIMEOUT_MS = 5_000;
// Shorter than a typical MCP client request timeout, long enough for a suspended
// service worker to be woken by its reconnect alarm.
const DEFAULT_REQUEST_WAIT_MS = 40_000;

interface ExtensionLinkOptions {
  port: number;
  token: string;
  log: (message: string) => void;
  authTimeoutMs?: number;
  requestWaitMs?: number;
}

interface ToolCallResult {
  content: BridgeContent[];
  isError: boolean;
}

interface ExtensionLink {
  address: { host: string; port: number };
  listTools: (signal?: AbortSignal) => Promise<BridgeTool[]>;
  callTool: (name: string, args: unknown, signal?: AbortSignal) => Promise<ToolCallResult>;
  close: () => Promise<void>;
}

interface Connection {
  socket: WebSocket;
  nonce: string;
  authenticated: boolean;
  authTimer: ReturnType<typeof setTimeout>;
}

interface PendingRequest {
  connection: Connection;
  reply: 'tools' | 'tool_result';
  resolve: (value: never) => void;
  reject: (error: Error) => void;
}

interface Waiter {
  dispatch: (connection: Connection) => void;
  reject: (error: Error) => void;
}

const sign = (token: string, data: string): string =>
  createHmac('sha256', token).update(data).digest('hex');

const proofMatches = (expected: string, received: string): boolean =>
  timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isBridgeTool = (value: unknown): value is BridgeTool =>
  isRecord(value) &&
  typeof value.name === 'string' &&
  typeof value.description === 'string' &&
  isRecord(value.inputSchema);

const isBridgeContent = (value: unknown): value is BridgeContent =>
  isRecord(value) &&
  ((value.type === 'text' && typeof value.text === 'string') ||
    (value.type === 'image' &&
      typeof value.data === 'string' &&
      typeof value.mimeType === 'string'));

const createExtensionLink = async (options: ExtensionLinkOptions): Promise<ExtensionLink> => {
  const { token, log } = options;
  const authTimeoutMs = options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
  const requestWaitMs = options.requestWaitMs ?? DEFAULT_REQUEST_WAIT_MS;

  const connections = new Set<Connection>();
  const pending = new Map<string, PendingRequest>();
  const waiters = new Set<Waiter>();
  let session: Connection | undefined;

  const server = new WebSocketServer({
    host: HOST,
    port: options.port,
    verifyClient: (info, done) => {
      const allowed = EXTENSION_ORIGIN.test(info.origin);
      if (!allowed) log(`Rejected a connection from origin "${info.origin || '(none)'}"`);
      done(allowed, 403, 'Forbidden');
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(
              `Port ${options.port} is already in use. Another AskTab MCP bridge may be running.`,
            )
          : error,
      );
    });
  });
  const { port } = server.address() as AddressInfo;

  const send = (connection: Connection, message: BridgeToExtension): void => {
    connection.socket.send(JSON.stringify(message));
  };

  const failAuth = (connection: Connection, reason: string): void => {
    log(`Closing a connection: ${reason}`);
    connection.socket.close(AUTH_FAILED_CLOSE_CODE, reason);
  };

  const rejectPendingFor = (connection: Connection): void => {
    for (const [id, request] of pending) {
      if (request.connection !== connection) continue;
      pending.delete(id);
      request.reject(new Error('AskTab extension disconnected'));
    }
  };

  const establishSession = (connection: Connection): void => {
    const previous = session;
    session = connection;
    if (previous && previous !== connection) {
      rejectPendingFor(previous);
      previous.socket.close(REPLACED_CLOSE_CODE, 'Replaced by a newer connection');
    }
    const waiting = [...waiters];
    waiters.clear();
    for (const waiter of waiting) waiter.dispatch(connection);
  };

  const handleHello = (connection: Connection, message: Record<string, unknown>): void => {
    const { nonce, proof } = message;
    if (typeof nonce !== 'string' || typeof proof !== 'string') {
      return failAuth(connection, 'Malformed hello');
    }
    if (!HEX_64.test(nonce) || !HEX_64.test(proof)) return failAuth(connection, 'Malformed hello');
    if (!proofMatches(sign(token, `extension:${connection.nonce}`), proof)) {
      return failAuth(connection, 'Token mismatch');
    }
    clearTimeout(connection.authTimer);
    connection.authenticated = true;
    send(connection, { type: 'welcome', proof: sign(token, `bridge:${nonce}`) });
    establishSession(connection);
  };

  const settle = (
    connection: Connection,
    id: unknown,
    reply: PendingRequest['reply'],
    value: unknown,
  ): void => {
    if (typeof id !== 'string') return;
    const request = pending.get(id);
    if (!request || request.connection !== connection || request.reply !== reply) return;
    pending.delete(id);
    request.resolve(value as never);
  };

  const handleReply = (connection: Connection, message: Record<string, unknown>): void => {
    if (message.type === 'tools' && Array.isArray(message.tools)) {
      if (message.tools.every(isBridgeTool)) settle(connection, message.id, 'tools', message.tools);
      return;
    }
    if (
      message.type === 'tool_result' &&
      Array.isArray(message.content) &&
      message.content.every(isBridgeContent) &&
      typeof message.isError === 'boolean'
    ) {
      const result: ToolCallResult = { content: message.content, isError: message.isError };
      settle(connection, message.id, 'tool_result', result);
    }
  };

  const handleMessage = (connection: Connection, data: RawData): void => {
    let message: unknown;
    try {
      message = JSON.parse(data.toString());
    } catch {
      if (!connection.authenticated) failAuth(connection, 'Unparseable handshake message');
      else log('Ignored an unparseable message from the extension');
      return;
    }
    if (!isRecord(message)) return;

    if (!connection.authenticated) {
      if (message.type === 'hello') handleHello(connection, message);
      else failAuth(connection, 'Expected hello');
      return;
    }
    const type = message.type as ExtensionToBridge['type'];
    if (type === 'hello') return failAuth(connection, 'Unexpected second hello');
    if (type !== 'keepalive') handleReply(connection, message);
  };

  server.on('connection', socket => {
    const connection: Connection = {
      socket,
      nonce: randomBytes(32).toString('hex'),
      authenticated: false,
      authTimer: setTimeout(() => failAuth(connection, 'Handshake timed out'), authTimeoutMs),
    };
    connections.add(connection);
    socket.on('message', data => handleMessage(connection, data));
    socket.on('close', () => {
      clearTimeout(connection.authTimer);
      connections.delete(connection);
      if (session === connection) session = undefined;
      rejectPendingFor(connection);
    });
    socket.on('error', error => log(`Connection error: ${error.message}`));
    send(connection, { type: 'challenge', nonce: connection.nonce });
  });

  const request = <T>(
    build: (id: string) => BridgeToExtension,
    reply: PendingRequest['reply'],
    signal?: AbortSignal,
  ): Promise<T> => {
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
      const id = randomUUID();
      const wait: { timer?: ReturnType<typeof setTimeout> } = {};
      const waiter: Waiter = {
        dispatch: connection => dispatch(connection),
        reject: error => fail(error),
      };

      const finish = (): void => {
        clearTimeout(wait.timer);
        signal?.removeEventListener('abort', onAbort);
        pending.delete(id);
        waiters.delete(waiter);
      };
      const fail = (error: Error): void => {
        finish();
        reject(error);
      };
      const onAbort = (): void => fail(signal?.reason);
      const dispatch = (connection: Connection): void => {
        clearTimeout(wait.timer);
        pending.set(id, {
          connection,
          reply,
          resolve: value => {
            finish();
            resolve(value as T);
          },
          reject: fail,
        });
        send(connection, build(id));
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      if (session) return dispatch(session);
      waiters.add(waiter);
      wait.timer = setTimeout(
        () =>
          fail(
            new Error(
              'AskTab extension is not connected. Enable MCP in AskTab settings and check that the port and token match.',
            ),
          ),
        requestWaitMs,
      );
    });
  };

  return {
    address: { host: (server.address() as AddressInfo).address, port },
    listTools: signal => request<BridgeTool[]>(id => ({ type: 'list_tools', id }), 'tools', signal),
    callTool: (name, args, signal) =>
      request<ToolCallResult>(id => ({ type: 'call_tool', id, name, args }), 'tool_result', signal),
    close: async () => {
      const shutdown = new Error('AskTab MCP bridge is shutting down');
      for (const waiter of [...waiters]) waiter.reject(shutdown);
      for (const connection of connections) {
        clearTimeout(connection.authTimer);
        rejectPendingFor(connection);
        connection.socket.terminate();
      }
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
};

export { createExtensionLink };
export type { ExtensionLink };
