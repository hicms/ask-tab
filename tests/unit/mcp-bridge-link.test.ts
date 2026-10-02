import { createExtensionLink } from '../../packages/mcp-bridge/lib/extension-link';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createHmac, randomBytes } from 'node:crypto';
import type { ExtensionLink } from '../../packages/mcp-bridge/lib/extension-link';

const TOKEN = 'test-token-0123456789';
const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnop';

const hmacHex = (token: string, data: string) =>
  createHmac('sha256', token).update(data).digest('hex');

type Message = Record<string, unknown> & { type: string };

class FakeExtension {
  readonly received: Message[] = [];
  private waiting: Array<(message: Message) => void> = [];
  readonly closed: Promise<number>;

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', data => {
      const message = JSON.parse(data.toString()) as Message;
      const waiter = this.waiting.shift();
      if (waiter) waiter(message);
      else this.received.push(message);
    });
    this.closed = new Promise(resolve => socket.once('close', code => resolve(code)));
  }

  static connect(
    port: number,
    origin: string | undefined = EXTENSION_ORIGIN,
  ): Promise<FakeExtension> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : {});
      const extension = new FakeExtension(socket);
      socket.once('open', () => resolve(extension));
      socket.once('error', reject);
      socket.once('unexpected-response', (_request, response) =>
        reject(new Error(`HTTP ${response.statusCode}`)),
      );
    });
  }

  next(): Promise<Message> {
    const queued = this.received.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise(resolve => this.waiting.push(resolve));
  }

  send(message: unknown) {
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  close() {
    this.socket.close();
  }
}

const authenticate = async (port: number, token = TOKEN): Promise<FakeExtension> => {
  const extension = await FakeExtension.connect(port);
  const challenge = await extension.next();
  const nonce = randomBytes(32).toString('hex');
  extension.send({
    type: 'hello',
    nonce,
    proof: hmacHex(token, `extension:${challenge.nonce as string}`),
  });
  const welcome = await extension.next();
  expect(welcome).toEqual({ type: 'welcome', proof: hmacHex(token, `bridge:${nonce}`) });
  return extension;
};

const links: ExtensionLink[] = [];
const extensions: FakeExtension[] = [];

const startLink = async (options: Partial<Parameters<typeof createExtensionLink>[0]> = {}) => {
  const link = await createExtensionLink({
    port: 0,
    token: TOKEN,
    log: () => {},
    ...options,
  });
  links.push(link);
  return link;
};

const track = (extension: FakeExtension) => {
  extensions.push(extension);
  return extension;
};

afterEach(async () => {
  for (const extension of extensions.splice(0)) extension.close();
  await Promise.all(links.splice(0).map(link => link.close()));
});

describe('extension link handshake', () => {
  it('listens on 127.0.0.1 only', async () => {
    const link = await startLink();
    expect(link.address.host).toBe('127.0.0.1');
  });

  it('answers the availability probe with Upgrade Required before accepting a WebSocket', async () => {
    const link = await startLink();
    const response = await fetch(`http://127.0.0.1:${link.address.port}/`, { method: 'HEAD' });
    expect(response.status).toBe(426);
    expect(await response.text()).toBe('');
    track(await authenticate(link.address.port));
  });

  it('rejects a browser page origin', async () => {
    const link = await startLink();
    await expect(FakeExtension.connect(link.address.port, 'https://evil.example')).rejects.toThrow(
      'HTTP 403',
    );
  });

  it('rejects a connection without an origin', async () => {
    const link = await startLink();
    await expect(FakeExtension.connect(link.address.port, '')).rejects.toThrow('HTTP 403');
  });

  it('accepts moz-extension origins', async () => {
    const link = await startLink();
    const extension = track(await FakeExtension.connect(link.address.port, 'moz-extension://1234'));
    expect((await extension.next()).type).toBe('challenge');
  });

  it('sends a fresh 64 character hex nonce to every connection', async () => {
    const link = await startLink();
    const first = track(await FakeExtension.connect(link.address.port));
    const second = track(await FakeExtension.connect(link.address.port));
    const a = (await first.next()).nonce as string;
    const b = (await second.next()).nonce as string;
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('closes with 4401 when the proof was made with another token', async () => {
    const link = await startLink();
    const extension = track(await FakeExtension.connect(link.address.port));
    const challenge = await extension.next();
    extension.send({
      type: 'hello',
      nonce: randomBytes(32).toString('hex'),
      proof: hmacHex('another-token', `extension:${challenge.nonce as string}`),
    });
    expect(await extension.closed).toBe(4401);
  });

  it('closes with 4401 when the proof signs the bridge direction (reflection)', async () => {
    const link = await startLink();
    const extension = track(await FakeExtension.connect(link.address.port));
    const challenge = await extension.next();
    extension.send({
      type: 'hello',
      nonce: randomBytes(32).toString('hex'),
      proof: hmacHex(TOKEN, `bridge:${challenge.nonce as string}`),
    });
    expect(await extension.closed).toBe(4401);
  });

  it.each([
    ['a short proof', { nonce: 'a'.repeat(64), proof: 'abc' }],
    ['an uppercase nonce', { nonce: 'A'.repeat(64), proof: 'a'.repeat(64) }],
    ['a missing nonce', { proof: 'a'.repeat(64) }],
    ['a non-string proof', { nonce: 'a'.repeat(64), proof: 12 }],
  ])('closes with 4401 for %s', async (_name, fields) => {
    const link = await startLink();
    const extension = track(await FakeExtension.connect(link.address.port));
    await extension.next();
    extension.send({ type: 'hello', ...fields });
    expect(await extension.closed).toBe(4401);
  });

  it('closes with 4401 when the extension does not answer in time', async () => {
    const link = await startLink({ authTimeoutMs: 50 });
    const extension = track(await FakeExtension.connect(link.address.port));
    expect(await extension.closed).toBe(4401);
  });

  it('closes with 4401 when a message other than hello arrives first', async () => {
    const link = await startLink();
    const extension = track(await FakeExtension.connect(link.address.port));
    await extension.next();
    extension.send({ type: 'keepalive' });
    expect(await extension.closed).toBe(4401);
  });

  it('closes with 4401 when hello is sent twice', async () => {
    const link = await startLink();
    const extension = track(await authenticate(link.address.port));
    extension.send({ type: 'hello', nonce: 'a'.repeat(64), proof: 'a'.repeat(64) });
    expect(await extension.closed).toBe(4401);
  });
});

describe('extension link requests', () => {
  const tool = { name: 'browser', description: 'd', inputSchema: { type: 'object' } };

  it('lists tools through the authenticated extension', async () => {
    const link = await startLink();
    const extension = track(await authenticate(link.address.port));

    const pending = link.listTools();
    const request = await extension.next();
    expect(request.type).toBe('list_tools');
    extension.send({ type: 'tools', id: request.id, tools: [tool] });

    expect(await pending).toEqual([tool]);
  });

  it('matches concurrent calls to their results even when they finish out of order', async () => {
    const link = await startLink();
    const extension = track(await authenticate(link.address.port));

    const first = link.callTool('browser', { action: 'tabs' });
    const second = link.callTool('web_fetch', { url: 'https://example.com' });
    const firstRequest = await extension.next();
    const secondRequest = await extension.next();
    expect(firstRequest).toMatchObject({
      type: 'call_tool',
      name: 'browser',
      args: { action: 'tabs' },
    });
    expect(secondRequest).toMatchObject({ type: 'call_tool', name: 'web_fetch' });

    extension.send({
      type: 'tool_result',
      id: secondRequest.id,
      content: [{ type: 'text', text: 'second' }],
      isError: false,
    });
    extension.send({
      type: 'tool_result',
      id: firstRequest.id,
      content: [{ type: 'text', text: 'first' }],
      isError: true,
    });

    expect(await second).toEqual({ content: [{ type: 'text', text: 'second' }], isError: false });
    expect(await first).toEqual({ content: [{ type: 'text', text: 'first' }], isError: true });
  });

  it('ignores unparseable and malformed extension messages', async () => {
    const link = await startLink();
    const extension = track(await authenticate(link.address.port));

    const pending = link.listTools();
    const request = await extension.next();
    extension.send('not json');
    extension.send({ type: 'tools', id: request.id, tools: 'nope' });
    extension.send({ type: 'tool_result', id: request.id, content: [], isError: 'no' });
    extension.send({ type: 'keepalive' });
    extension.send({ type: 'tools', id: request.id, tools: [tool] });

    expect(await pending).toEqual([tool]);
  });

  it('waits for the extension to connect and then delivers the request', async () => {
    const link = await startLink();
    const pending = link.listTools();

    const extension = track(await authenticate(link.address.port));
    const request = await extension.next();
    extension.send({ type: 'tools', id: request.id, tools: [tool] });

    expect(await pending).toEqual([tool]);
  });

  it('reports a missing extension after the wait limit', async () => {
    const link = await startLink({ requestWaitMs: 30 });
    await expect(link.listTools()).rejects.toThrow('AskTab extension is not connected');
  });

  it('never forwards a request to a connection that has not authenticated', async () => {
    const link = await startLink({ requestWaitMs: 50 });
    const extension = track(await FakeExtension.connect(link.address.port));
    expect((await extension.next()).type).toBe('challenge');

    await expect(link.listTools()).rejects.toThrow('not connected');
    expect(extension.received).toEqual([]);
  });

  it('rejects pending requests when the extension disconnects', async () => {
    const link = await startLink();
    const extension = track(await authenticate(link.address.port));

    const pending = link.callTool('browser', {});
    await extension.next();
    extension.close();

    await expect(pending).rejects.toThrow('AskTab extension disconnected');
  });

  it('replaces the previous session with a newly authenticated connection', async () => {
    const link = await startLink();
    const first = track(await authenticate(link.address.port));
    const rejection = expect(link.callTool('browser', {})).rejects.toThrow(
      'AskTab extension disconnected',
    );
    await first.next();

    const second = track(await authenticate(link.address.port));

    await rejection;
    await first.closed;
    const next = link.listTools();
    const request = await second.next();
    expect(request.type).toBe('list_tools');
    second.send({ type: 'tools', id: request.id, tools: [] });
    expect(await next).toEqual([]);
  });

  it('stops waiting when the caller aborts and ignores the late result', async () => {
    const link = await startLink();
    const extension = track(await authenticate(link.address.port));
    const controller = new AbortController();

    const pending = link.callTool('browser', {}, controller.signal);
    const request = await extension.next();
    controller.abort(new Error('client cancelled'));

    await expect(pending).rejects.toThrow('client cancelled');
    extension.send({ type: 'tool_result', id: request.id, content: [], isError: false });

    const next = link.listTools();
    const nextRequest = await extension.next();
    extension.send({ type: 'tools', id: nextRequest.id, tools: [] });
    expect(await next).toEqual([]);
  });

  it('rejects a call that is already aborted without contacting the extension', async () => {
    const link = await startLink();
    const extension = track(await authenticate(link.address.port));

    await expect(
      link.callTool('browser', {}, AbortSignal.abort(new Error('gone'))),
    ).rejects.toThrow('gone');
    expect(extension.received).toEqual([]);
  });
});

describe('extension link startup', () => {
  it('fails clearly when the port is already in use', async () => {
    const first = await startLink();
    await expect(startLink({ port: first.address.port })).rejects.toThrow('already in use');
  });
});
