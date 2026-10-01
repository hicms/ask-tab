import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';

const TOKEN = 'secret-token-value';
const PORT = 47821;
const ALARM = 'mcp-bridge-reconnect';

// ── Fakes ──

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  closeCode: number | undefined;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onopen: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000) {
    if (this.readyState === 3) return;
    this.closeCode = code;
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ code }));
  }

  /** The bridge side closes the connection. */
  serverClose(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  receive(message: unknown) {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
  }

  sentMessages() {
    return this.sent.map(raw => JSON.parse(raw) as Record<string, unknown>);
  }
}

const config = { enabled: true, port: PORT, token: TOKEN };
let configListeners: Array<() => void> = [];
const storageGet = vi.fn(async () => ({ ...config }));

vi.mock('@extension/storage', () => ({
  mcpBridgeConfigStorage: {
    get: () => storageGet(),
    subscribe: (listener: () => void) => {
      configListeners.push(listener);
      return () => {};
    },
  },
}));

const listMcpTools = vi.fn(() => [
  { name: 'browser', description: 'Browser', inputSchema: { type: 'object' } },
]);
const callMcpTool =
  vi.fn<
    (
      name: string,
      args: unknown,
      signal: AbortSignal,
    ) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError: boolean }>
  >();
vi.mock('../../chrome-extension/src/background/mcp/mcp-tools', () => ({
  listMcpTools: () => listMcpTools(),
  callMcpTool: (name: string, args: unknown, signal: AbortSignal) =>
    callMcpTool(name, args, signal),
}));

const releaseToolResources = vi.fn<(signal: AbortSignal) => Promise<void>>(async () => {});
vi.mock('../../chrome-extension/src/background/tools/tool-lifecycle', () => ({
  releaseToolResources: (signal: AbortSignal) => releaseToolResources(signal),
}));

vi.mock('../../chrome-extension/src/background/logging/logger-buffer', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const alarmsGet = vi.fn<(name: string) => Promise<unknown>>(async () => undefined);
const alarmsCreate = vi.fn(async () => {});
const alarmsClear = vi.fn(async () => true);
Object.defineProperty(globalThis, 'chrome', {
  value: { alarms: { get: alarmsGet, create: alarmsCreate, clear: alarmsClear } },
  writable: true,
  configurable: true,
});

const { createMcpBridgeClient, isMcpBridgeAlarm, MCP_BRIDGE_ALARM } = await import(
  '../../chrome-extension/src/background/mcp/mcp-bridge-client'
);

// ── Helpers ──

const hmac = (data: string, token = TOKEN) =>
  createHmac('sha256', token).update(data).digest('hex');

/** Real timers for crypto.subtle; fake ones for the client's own timers. */
const settle = async (ticks = 20) => {
  for (let i = 0; i < ticks; i++) await new Promise(resolve => setImmediate(resolve));
};

const until = async (predicate: () => boolean) => {
  for (let i = 0; i < 500 && !predicate(); i++) await new Promise(resolve => setImmediate(resolve));
  expect(predicate()).toBe(true);
};

const latestSocket = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;

const startClient = async () => {
  const client = createMcpBridgeClient();
  await client.start();
  return client;
};

/** Drives a socket through challenge → hello → welcome like the real bridge. */
const completeHandshake = async (socket: FakeWebSocket, opts?: { welcomeToken?: string }) => {
  const bridgeNonce = randomBytes(32).toString('hex');
  socket.receive({ type: 'challenge', nonce: bridgeNonce });
  await until(() => socket.sentMessages().some(m => m['type'] === 'hello'));
  const hello = socket.sentMessages().find(m => m['type'] === 'hello')!;
  socket.receive({
    type: 'welcome',
    proof: hmac(`bridge:${hello['nonce'] as string}`, opts?.welcomeToken ?? TOKEN),
  });
  return { bridgeNonce, hello };
};

const establishSession = async () => {
  const client = await startClient();
  const socket = latestSocket();
  await completeHandshake(socket);
  socket.receive({ type: 'list_tools', id: 'probe' });
  await until(() => socket.sentMessages().some(m => m['type'] === 'tools'));
  return { client, socket };
};

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  FakeWebSocket.instances = [];
  configListeners = [];
  Object.assign(config, { enabled: true, port: PORT, token: TOKEN });
  vi.stubGlobal('WebSocket', FakeWebSocket);
  storageGet.mockClear();
  listMcpTools.mockClear();
  callMcpTool.mockReset();
  callMcpTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false });
  releaseToolResources.mockClear();
  alarmsGet.mockReset();
  alarmsGet.mockResolvedValue(undefined);
  alarmsCreate.mockClear();
  alarmsClear.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('disabled', () => {
  beforeEach(() => {
    config.enabled = false;
  });

  it('opens no WebSocket, creates no alarm and clears a leftover one', async () => {
    await startClient();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(alarmsCreate).not.toHaveBeenCalled();
    expect(alarmsClear).toHaveBeenCalledWith(ALARM);
  });

  it('ignores the reconnect alarm', async () => {
    const client = await startClient();
    await client.handleAlarm();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});

describe('connecting', () => {
  it('connects to the loopback bridge and keeps a periodic reconnect alarm', async () => {
    await startClient();
    expect(latestSocket().url).toBe(`ws://127.0.0.1:${PORT}`);
    expect(alarmsCreate).toHaveBeenCalledWith(ALARM, { periodInMinutes: 0.5 });
  });

  it('does not recreate an alarm that already exists', async () => {
    alarmsGet.mockResolvedValue({ name: ALARM });
    await startClient();
    expect(alarmsCreate).not.toHaveBeenCalled();
  });

  it('recognises its own alarm only', () => {
    expect(isMcpBridgeAlarm(MCP_BRIDGE_ALARM)).toBe(true);
    expect(isMcpBridgeAlarm('channel-poll')).toBe(false);
  });

  it('does not open a second socket when the alarm fires while connected', async () => {
    const client = await startClient();
    await client.handleAlarm();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('reconnects from the alarm without waiting for the backoff, and drops the pending retry', async () => {
    const client = await startClient();
    latestSocket().serverClose();
    await client.handleAlarm();
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});

describe('handshake', () => {
  it('answers the challenge with a proof that does not reveal the token', async () => {
    await startClient();
    const socket = latestSocket();
    const { bridgeNonce, hello } = await completeHandshake(socket);
    expect(hello['nonce']).toMatch(/^[0-9a-f]{64}$/);
    expect(hello['proof']).toBe(hmac(`extension:${bridgeNonce}`));
    expect(socket.sent.join('')).not.toContain(TOKEN);
  });

  it('executes nothing before it has verified the bridge', async () => {
    await startClient();
    const socket = latestSocket();
    socket.receive({ type: 'challenge', nonce: randomBytes(32).toString('hex') });
    await until(() => socket.sentMessages().length === 1);
    socket.receive({ type: 'call_tool', id: '1', name: 'browser', args: {} });
    socket.receive({ type: 'list_tools', id: '2' });
    await settle();
    expect(socket.closeCode).toBe(4401);
    expect(callMcpTool).not.toHaveBeenCalled();
    expect(listMcpTools).not.toHaveBeenCalled();
  });

  it('closes when the welcome proof was made with another token', async () => {
    await startClient();
    const socket = latestSocket();
    await completeHandshake(socket, { welcomeToken: 'impostor' });
    await until(() => socket.closeCode === 4401);
    socket.receive({ type: 'call_tool', id: '1', name: 'browser', args: {} });
    await settle();
    expect(callMcpTool).not.toHaveBeenCalled();
  });

  it.each([
    ['too short', 'abc'],
    ['upper case', 'A'.repeat(64)],
    ['not a string', 42],
  ])('closes on a malformed welcome proof (%s)', async (_label, proof) => {
    await startClient();
    const socket = latestSocket();
    socket.receive({ type: 'challenge', nonce: randomBytes(32).toString('hex') });
    await until(() => socket.sentMessages().length === 1);
    socket.receive({ type: 'welcome', proof });
    await until(() => socket.closeCode === 4401);
  });

  it('closes on a malformed challenge nonce and sends nothing', async () => {
    await startClient();
    const socket = latestSocket();
    socket.receive({ type: 'challenge', nonce: 'short' });
    await until(() => socket.closeCode === 4401);
    expect(socket.sent).toHaveLength(0);
  });

  it('closes on a second welcome', async () => {
    const { socket } = await establishSession();
    socket.receive({ type: 'welcome', proof: 'f'.repeat(64) });
    await until(() => socket.closeCode === 4401);
  });

  it('closes on a welcome that arrives before the challenge', async () => {
    await startClient();
    const socket = latestSocket();
    socket.receive({ type: 'welcome', proof: 'f'.repeat(64) });
    await until(() => socket.closeCode === 4401);
  });
});

describe('serving requests', () => {
  it('lists tools', async () => {
    const { socket } = await establishSession();
    expect(socket.sentMessages().find(m => m['type'] === 'tools')).toEqual({
      type: 'tools',
      id: 'probe',
      tools: [{ name: 'browser', description: 'Browser', inputSchema: { type: 'object' } }],
    });
  });

  it('runs every call of one session with the same signal', async () => {
    const { socket } = await establishSession();
    socket.receive({ type: 'call_tool', id: 'a', name: 'browser', args: { action: 'snapshot' } });
    socket.receive({ type: 'call_tool', id: 'b', name: 'browser', args: { action: 'click' } });
    await until(() => callMcpTool.mock.calls.length === 2);
    const [first, second] = callMcpTool.mock.calls;
    expect(first![2]).toBe(second![2]);
    expect(first![2].aborted).toBe(false);
    expect(first!.slice(0, 2)).toEqual(['browser', { action: 'snapshot' }]);
  });

  it('sends the result back under the request id', async () => {
    const { socket } = await establishSession();
    callMcpTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Error: nope' }],
      isError: true,
    });
    socket.receive({ type: 'call_tool', id: 'x', name: 'browser', args: {} });
    await until(() => socket.sentMessages().some(m => m['type'] === 'tool_result'));
    expect(socket.sentMessages().find(m => m['type'] === 'tool_result')).toEqual({
      type: 'tool_result',
      id: 'x',
      content: [{ type: 'text', text: 'Error: nope' }],
      isError: true,
    });
  });

  it('does not block other requests while a call is running', async () => {
    const { socket } = await establishSession();
    callMcpTool.mockReturnValueOnce(new Promise(() => {}));
    socket.receive({ type: 'call_tool', id: 'slow', name: 'browser', args: {} });
    socket.receive({ type: 'list_tools', id: 'fast' });
    await until(() => socket.sentMessages().filter(m => m['type'] === 'tools').length === 2);
  });

  it('drops malformed messages without closing', async () => {
    const { socket } = await establishSession();
    socket.receive('not json');
    socket.receive({ type: 'call_tool', name: 'browser', args: {} });
    socket.receive({ type: 'call_tool', id: 'x', name: 5, args: {} });
    socket.receive({ type: 'mystery' });
    socket.receive(null);
    await settle();
    expect(socket.closeCode).toBeUndefined();
    expect(callMcpTool).not.toHaveBeenCalled();
  });

  it('does not throw when the socket closed before the call finished', async () => {
    const { socket } = await establishSession();
    let finish: (value: { content: []; isError: false }) => void = () => {};
    callMcpTool.mockReturnValueOnce(new Promise(resolve => (finish = resolve)));
    socket.receive({ type: 'call_tool', id: 'late', name: 'browser', args: {} });
    await until(() => callMcpTool.mock.calls.length === 1);
    socket.serverClose();
    finish({ content: [], isError: false });
    await settle();
    expect(socket.sentMessages().some(m => m['type'] === 'tool_result')).toBe(false);
  });
});

describe('keepalive', () => {
  it('sends a keepalive every 20 seconds once the session exists, and stops after it ends', async () => {
    const { socket } = await establishSession();
    const count = () => socket.sentMessages().filter(m => m['type'] === 'keepalive').length;
    expect(count()).toBe(0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(count()).toBe(1);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(count()).toBe(3);
    socket.serverClose();
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(count()).toBe(3);
  });
});

describe('session end', () => {
  it('aborts the session signal and releases tool resources when the bridge disconnects', async () => {
    const { socket } = await establishSession();
    socket.receive({ type: 'call_tool', id: 'a', name: 'browser', args: {} });
    await until(() => callMcpTool.mock.calls.length === 1);
    const signal = callMcpTool.mock.calls[0]![2];
    socket.serverClose();
    await settle();
    expect(signal.aborted).toBe(true);
    expect(releaseToolResources).toHaveBeenCalledWith(signal);
  });

  it('does not release resources for a connection that never authenticated', async () => {
    await startClient();
    latestSocket().serverClose();
    await settle();
    expect(releaseToolResources).not.toHaveBeenCalled();
  });

  it('starts a new session with a fresh signal after reconnecting', async () => {
    const { socket } = await establishSession();
    socket.receive({ type: 'call_tool', id: 'a', name: 'browser', args: {} });
    await until(() => callMcpTool.mock.calls.length === 1);
    socket.serverClose();
    await vi.advanceTimersByTimeAsync(1_000);
    const next = latestSocket();
    expect(next).not.toBe(socket);
    await completeHandshake(next);
    next.receive({ type: 'call_tool', id: 'b', name: 'browser', args: {} });
    await until(() => callMcpTool.mock.calls.length === 2);
    expect(callMcpTool.mock.calls[1]![2]).not.toBe(callMcpTool.mock.calls[0]![2]);
    expect(callMcpTool.mock.calls[1]![2].aborted).toBe(false);
  });
});

describe('retrying', () => {
  it('backs off 1s, 2s, 4s … up to 30s', async () => {
    await startClient();
    const delays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    for (const [index, delay] of delays.entries()) {
      latestSocket().serverClose();
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(FakeWebSocket.instances).toHaveLength(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeWebSocket.instances).toHaveLength(index + 2);
    }
  });

  it('starts over from 1s after a successful handshake', async () => {
    await startClient();
    latestSocket().serverClose();
    await vi.advanceTimersByTimeAsync(1_000);
    latestSocket().serverClose();
    await vi.advanceTimersByTimeAsync(2_000);
    await completeHandshake(latestSocket());
    await until(() => latestSocket().sentMessages().length >= 1);
    await settle();
    const before = FakeWebSocket.instances.length;
    latestSocket().serverClose();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWebSocket.instances).toHaveLength(before + 1);
  });

  it('schedules a retry when the WebSocket constructor throws', async () => {
    const throwing = vi.fn(() => {
      throw new Error('blocked');
    });
    vi.stubGlobal('WebSocket', throwing);
    await startClient();
    expect(throwing).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(throwing).toHaveBeenCalledTimes(2);
  });
});

describe('configuration changes', () => {
  const change = async (patch: Partial<typeof config>) => {
    Object.assign(config, patch);
    for (const listener of configListeners) listener();
    await settle();
  };

  it('reconnects with the new port and ends the old session', async () => {
    const { socket } = await establishSession();
    socket.receive({ type: 'call_tool', id: 'a', name: 'browser', args: {} });
    await until(() => callMcpTool.mock.calls.length === 1);
    await change({ port: 50000 });
    expect(socket.closeCode).toBe(1000);
    expect(callMcpTool.mock.calls[0]![2].aborted).toBe(true);
    expect(latestSocket().url).toBe('ws://127.0.0.1:50000');
  });

  it('reconnects with a regenerated token', async () => {
    await startClient();
    const first = latestSocket();
    await change({ token: 'another-token' });
    expect(first.closeCode).toBe(1000);
    const next = latestSocket();
    expect(next).not.toBe(first);
    const nonce = randomBytes(32).toString('hex');
    next.receive({ type: 'challenge', nonce });
    await until(() => next.sentMessages().length === 1);
    expect(next.sentMessages()[0]!['proof']).toBe(hmac(`extension:${nonce}`, 'another-token'));
  });

  it('does not reconnect when nothing relevant changed', async () => {
    await startClient();
    await change({});
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('turning MCP off closes the socket, ends the session, clears the alarm and stops retrying', async () => {
    const { socket } = await establishSession();
    socket.receive({ type: 'call_tool', id: 'a', name: 'browser', args: {} });
    await until(() => callMcpTool.mock.calls.length === 1);
    await change({ enabled: false });
    expect(socket.closeCode).toBe(1000);
    expect(callMcpTool.mock.calls[0]![2].aborted).toBe(true);
    expect(releaseToolResources).toHaveBeenCalledTimes(1);
    expect(alarmsClear).toHaveBeenCalledWith(ALARM);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('turning MCP on connects and creates the alarm', async () => {
    config.enabled = false;
    await startClient();
    alarmsCreate.mockClear();
    await change({ enabled: true });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(alarmsCreate).toHaveBeenCalledWith(ALARM, { periodInMinutes: 0.5 });
  });

  it('treats an empty token as disabled', async () => {
    config.token = '';
    await startClient();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});
