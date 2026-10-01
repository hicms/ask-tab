import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ExtensionLink } from './extension-link.js';

const createMcpServer = (
  link: Pick<ExtensionLink, 'listTools' | 'callTool'>,
  version: string,
): Server => {
  const server = new Server({ name: 'asktab-browser', version }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => ({
    tools: await link.listTools(extra.signal),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const { content, isError } = await link.callTool(
        request.params.name,
        request.params.arguments ?? {},
        extra.signal,
      );
      return { content, isError };
    } catch (error) {
      return {
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });

  return server;
};

export { createMcpServer };
