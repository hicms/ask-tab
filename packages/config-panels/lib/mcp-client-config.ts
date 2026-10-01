type ClientPlatform = 'windows' | 'other';

const BRIDGE_PACKAGE = 'asktab-mcp';

const detectClientPlatform = (): ClientPlatform =>
  navigator.userAgent.includes('Windows') ? 'windows' : 'other';

/** A `mcpServers` entry for Claude Desktop, Cursor, Claude Code and other stdio MCP clients. */
const buildMcpClientConfig = (port: number, token: string, platform: ClientPlatform): string => {
  const npx = ['npx', '-y', BRIDGE_PACKAGE];
  // On native Windows, npx is a .cmd script that MCP clients cannot spawn directly.
  const [command, ...args] = platform === 'windows' ? ['cmd', '/c', ...npx] : npx;
  return JSON.stringify(
    {
      mcpServers: {
        'asktab-browser': {
          command,
          args,
          env: { ASKTAB_MCP_PORT: String(port), ASKTAB_MCP_TOKEN: token },
        },
      },
    },
    null,
    2,
  );
};

export { buildMcpClientConfig, detectClientPlatform };
