import { Type } from '@sinclair/typebox';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolRegistration } from '../../chrome-extension/src/background/tools/tool-registration';

const browserSchema = Type.Object({
  action: Type.Union([Type.Literal('snapshot'), Type.Literal('click')], {
    description: 'What to do',
  }),
  ref: Type.Optional(Type.String()),
});

const registrations = new Map<string, ToolRegistration>();
const implemented = new Set<string>();
const executeTool = vi.fn<(name: string, args: unknown, context?: unknown) => Promise<unknown>>();

vi.mock('../../chrome-extension/src/background/tools', () => ({
  executeTool: (name: string, args: unknown, context?: unknown) => executeTool(name, args, context),
  getToolRegistration: (name: string) => registrations.get(name),
  getImplementedToolNames: () => implemented,
}));

const { MCP_TOOL_NAMES, listMcpTools, callMcpTool } = await import(
  '../../chrome-extension/src/background/mcp/mcp-tools'
);

const register = (def: Partial<ToolRegistration> & { name: string }) => {
  registrations.set(def.name, {
    label: def.name,
    description: `${def.name} description`,
    schema: Type.Object({}),
    execute: vi.fn(),
    ...def,
  });
  implemented.add(def.name);
};

beforeEach(() => {
  registrations.clear();
  implemented.clear();
  executeTool.mockReset();
  register({ name: 'browser', schema: browserSchema, description: 'Control the browser' });
  register({ name: 'debugger' });
  register({ name: 'execute_javascript' });
  register({ name: 'web_fetch' });
  register({ name: 'web_search' });
});

describe('listMcpTools', () => {
  it('exposes exactly the whitelisted tools that exist on this platform', () => {
    expect(listMcpTools().map(t => t.name)).toEqual([
      'browser',
      'debugger',
      'execute_javascript',
      'web_fetch',
    ]);
    expect(MCP_TOOL_NAMES).not.toContain('web_search');
  });

  it('omits whitelisted tools the platform does not implement', () => {
    implemented.delete('debugger');
    expect(listMcpTools().map(t => t.name)).not.toContain('debugger');
  });

  it('passes name, description and the TypeBox schema through unchanged', () => {
    const browser = listMcpTools().find(t => t.name === 'browser');
    expect(browser?.description).toBe('Control the browser');
    expect(JSON.parse(JSON.stringify(browser?.inputSchema))).toEqual(
      JSON.parse(JSON.stringify(browserSchema)),
    );
    expect(browser?.inputSchema['type']).toBe('object');
  });
});

describe('callMcpTool', () => {
  it('runs the tool through executeTool with the session signal', async () => {
    const signal = new AbortController().signal;
    executeTool.mockResolvedValue('ok');
    await callMcpTool('browser', { action: 'snapshot' }, signal);
    expect(executeTool).toHaveBeenCalledTimes(1);
    const [name, args, context] = executeTool.mock.calls[0]!;
    expect(name).toBe('browser');
    expect(args).toEqual({ action: 'snapshot' });
    expect((context as { signal: AbortSignal }).signal).toBe(signal);
  });

  it('formats string results with the default formatter', async () => {
    executeTool.mockResolvedValue('page text');
    await expect(callMcpTool('web_fetch', {}, new AbortController().signal)).resolves.toEqual({
      content: [{ type: 'text', text: 'page text' }],
      isError: false,
    });
  });

  it("uses the tool's own formatter and maps images, dropping extra fields", async () => {
    register({
      name: 'browser',
      formatResult: () => ({
        content: [
          { type: 'text', text: 'Screenshot captured', textSignature: 'sig' },
          { type: 'image', data: 'QUJD', mimeType: 'image/png' },
        ],
        details: {},
      }),
    });
    executeTool.mockResolvedValue({ __type: 'screenshot' });
    await expect(callMcpTool('browser', {}, new AbortController().signal)).resolves.toEqual({
      content: [
        { type: 'text', text: 'Screenshot captured' },
        { type: 'image', data: 'QUJD', mimeType: 'image/png' },
      ],
      isError: false,
    });
  });

  it('flags results that start with "Error:" as errors and keeps the message', async () => {
    executeTool.mockResolvedValue('Error: Invalid arguments for tool "browser"');
    await expect(callMcpTool('browser', {}, new AbortController().signal)).resolves.toEqual({
      content: [{ type: 'text', text: 'Error: Invalid arguments for tool "browser"' }],
      isError: true,
    });
  });

  it('does not flag web_fetch error objects, which carry the failure in the JSON text', async () => {
    executeTool.mockResolvedValue({ error: 'HTTP 404', text: 'not found' });
    const result = await callMcpTool('web_fetch', {}, new AbortController().signal);
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ error: 'HTTP 404', text: 'not found' }) },
    ]);
  });

  it('reports a thrown error as an error result', async () => {
    executeTool.mockRejectedValue(new Error('Tool "browser" timed out after 300000ms'));
    await expect(callMcpTool('browser', {}, new AbortController().signal)).resolves.toEqual({
      content: [{ type: 'text', text: 'Error: Tool "browser" timed out after 300000ms' }],
      isError: true,
    });
  });

  it('reports a non-Error throw as text', async () => {
    executeTool.mockRejectedValue('boom');
    const result = await callMcpTool('browser', {}, new AbortController().signal);
    expect(result).toEqual({ content: [{ type: 'text', text: 'Error: boom' }], isError: true });
  });

  it('refuses tools outside the whitelist without executing them', async () => {
    const result = await callMcpTool('web_search', {}, new AbortController().signal);
    expect(result.isError).toBe(true);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('refuses whitelisted tools the platform does not implement', async () => {
    implemented.delete('debugger');
    const result = await callMcpTool('debugger', {}, new AbortController().signal);
    expect(result.isError).toBe(true);
    expect(executeTool).not.toHaveBeenCalled();
  });
});
