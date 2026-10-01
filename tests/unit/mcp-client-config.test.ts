import { buildMcpClientConfig } from '../../packages/config-panels/lib/mcp-client-config';
import { describe, expect, it } from 'vitest';

const env = { ASKTAB_MCP_PORT: '48000', ASKTAB_MCP_TOKEN: 'tok-123' };
const bridgeUrl = 'https://github.com/hicms/ask-tab/releases/download/v1.2.3/asktab-mcp-v1.2.3.tgz';

describe('buildMcpClientConfig', () => {
  it('runs the bridge released with this extension version through npx', () => {
    expect(JSON.parse(buildMcpClientConfig(48000, 'tok-123', 'other', '1.2.3'))).toEqual({
      mcpServers: {
        'asktab-browser': { command: 'npx', args: ['-y', bridgeUrl], env },
      },
    });
  });

  it('wraps npx in cmd /c on Windows, where clients cannot start npx directly', () => {
    expect(JSON.parse(buildMcpClientConfig(48000, 'tok-123', 'windows', '1.2.3'))).toEqual({
      mcpServers: {
        'asktab-browser': { command: 'cmd', args: ['/c', 'npx', '-y', bridgeUrl], env },
      },
    });
  });

  it('is pretty-printed so it can be pasted into a client config file', () => {
    expect(buildMcpClientConfig(48000, 'tok-123', 'other', '1.2.3')).toContain('\n  "mcpServers"');
  });
});
