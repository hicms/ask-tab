// ---------------------------------------------------------------------------
// MCP tool surface — which tools external MCP clients can use, and how a tool
// result becomes MCP content. Tool definitions stay owned by tools/index.ts.
// ---------------------------------------------------------------------------

import { executeTool, getImplementedToolNames, getToolRegistration } from '../tools';
import { defaultFormatResult } from '../tools/tool-registration';
import type { BridgeContent, BridgeTool } from 'asktab-mcp/protocol';

/** Tools exposed to MCP clients once MCP is enabled. */
const MCP_TOOL_NAMES = ['browser', 'debugger', 'execute_javascript', 'web_fetch'] as const;

interface McpToolResult {
  content: BridgeContent[];
  isError: boolean;
}

const errorResult = (message: string): McpToolResult => ({
  content: [{ type: 'text', text: `Error: ${message}` }],
  isError: true,
});

/** Tool executors report failure by returning a string that starts with "Error:". */
const isErrorString = (raw: unknown): boolean =>
  typeof raw === 'string' && raw.startsWith('Error:');

const availableToolNames = (): string[] => {
  const implemented = getImplementedToolNames();
  return MCP_TOOL_NAMES.filter(name => implemented.has(name));
};

const listMcpTools = (): BridgeTool[] =>
  availableToolNames().flatMap(name => {
    const def = getToolRegistration(name);
    // TypeBox schemas are JSON Schema objects.
    return def
      ? [{ name, description: def.description, inputSchema: def.schema as Record<string, unknown> }]
      : [];
  });

const callMcpTool = async (
  name: string,
  args: unknown,
  signal: AbortSignal,
): Promise<McpToolResult> => {
  const def = availableToolNames().includes(name) ? getToolRegistration(name) : undefined;
  if (!def) return errorResult(`Tool "${name}" is not available over MCP`);

  try {
    const raw = await executeTool(name, args, { signal });
    const formatted = (def.formatResult ?? defaultFormatResult)(raw);
    const content = formatted.content.flatMap((part): BridgeContent[] => {
      if (part.type === 'text') return [{ type: 'text', text: part.text }];
      if (part.type === 'image') {
        return [{ type: 'image', data: part.data, mimeType: part.mimeType }];
      }
      return [];
    });
    return { content, isError: isErrorString(raw) };
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
};

export { MCP_TOOL_NAMES, listMcpTools, callMcpTool };
