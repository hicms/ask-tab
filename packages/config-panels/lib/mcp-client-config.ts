type ClientPlatform = 'windows' | 'other';

const detectClientPlatform = (): ClientPlatform =>
  navigator.userAgent.includes('Windows') ? 'windows' : 'other';

// Pinned to the extension's own release so the bridge always speaks the same protocol.
const bridgePackageUrl = (extensionVersion: string): string =>
  `https://github.com/hicms/ask-tab/releases/download/v${extensionVersion}/asktab-mcp-v${extensionVersion}.tgz`;

/** A `mcpServers` entry for Claude Desktop, Cursor, Claude Code and other stdio MCP clients. */
const buildMcpClientConfig = (
  port: number,
  token: string,
  platform: ClientPlatform,
  extensionVersion: string,
): string => {
  const npx = ['npx', '-y', bridgePackageUrl(extensionVersion)];
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
