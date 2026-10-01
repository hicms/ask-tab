import { createMcpServer } from '../../packages/mcp-bridge/lib/mcp-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BridgeContent, BridgeTool } from '../../packages/mcp-bridge/lib/protocol';

const tool: BridgeTool = {
  name: 'browser',
  description: 'Control browser tabs',
  inputSchema: { type: 'object', properties: { action: { type: 'string' } } },
};

const connect = async (link: Parameters<typeof createMcpServer>[0]) => {
  const server = createMcpServer(link, '0.0.0');
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
};

const open: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map(item => item.close()));
});

describe('MCP server', () => {
  it('lists the tools returned by the extension link unchanged', async () => {
    const listTools = vi.fn(async () => [tool]);
    const { client, server } = await connect({ listTools, callTool: vi.fn() });
    open.push(client, server);

    const result = await client.listTools();

    expect(result.tools).toEqual([tool]);
    expect(listTools).toHaveBeenCalledOnce();
  });

  it('forwards a tool call and returns its content and error flag', async () => {
    const content: BridgeContent[] = [
      { type: 'text', text: 'Screenshot captured' },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    ];
    const callTool = vi.fn(async () => ({ content, isError: false }));
    const { client, server } = await connect({ listTools: vi.fn(), callTool });
    open.push(client, server);

    const result = await client.callTool({ name: 'browser', arguments: { action: 'screenshot' } });

    expect(callTool).toHaveBeenCalledWith(
      'browser',
      { action: 'screenshot' },
      expect.any(AbortSignal),
    );
    expect(result.content).toEqual(content);
    expect(result.isError).toBe(false);
  });

  it('passes an error flag from the extension through', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'Error: no tab' }],
      isError: true,
    }));
    const { client, server } = await connect({ listTools: vi.fn(), callTool });
    open.push(client, server);

    const result = await client.callTool({ name: 'browser', arguments: {} });

    expect(result.isError).toBe(true);
  });

  it('turns a link failure into an error result with its message', async () => {
    const callTool = vi.fn(async () => {
      throw new Error('AskTab extension is not connected.');
    });
    const { client, server } = await connect({ listTools: vi.fn(), callTool });
    open.push(client, server);

    const result = await client.callTool({ name: 'browser', arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'AskTab extension is not connected.' }]);
  });

  it('aborts the link request when the client cancels', async () => {
    let seen: AbortSignal | undefined;
    const callTool = vi.fn(
      (_name: string, _args: unknown, signal?: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          seen = signal;
          signal?.addEventListener('abort', () => reject(new Error('cancelled')));
        }),
    );
    const { client, server } = await connect({ listTools: vi.fn(), callTool });
    open.push(client, server);

    const controller = new AbortController();
    const pending = client.callTool({ name: 'browser', arguments: {} }, undefined, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(callTool).toHaveBeenCalled());
    controller.abort();

    await expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(seen?.aborted).toBe(true));
  });
});
