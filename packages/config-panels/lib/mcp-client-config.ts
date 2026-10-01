/** The bridge runs from a repository build, so the user fills in where the repository lives. */
const BRIDGE_ENTRY_PLACEHOLDER = '<path-to-ask-tab>/packages/mcp-bridge/dist/index.mjs';

/** A `mcpServers` entry for Claude Desktop, Cursor, Claude Code and other stdio MCP clients. */
const buildMcpClientConfig = (port: number, token: string): string =>
  JSON.stringify(
    {
      mcpServers: {
        'asktab-browser': {
          command: 'node',
          args: [BRIDGE_ENTRY_PLACEHOLDER],
          env: { ASKTAB_MCP_PORT: String(port), ASKTAB_MCP_TOKEN: token },
        },
      },
    },
    null,
    2,
  );

export { BRIDGE_ENTRY_PLACEHOLDER, buildMcpClientConfig };
