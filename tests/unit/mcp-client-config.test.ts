import { buildMcpClientConfig } from '../../packages/config-panels/lib/mcp-client-config';
import { describe, expect, it } from 'vitest';

const env = { ASKTAB_MCP_PORT: '48000', ASKTAB_MCP_TOKEN: 'tok-123' };

describe('buildMcpClientConfig', () => {
  it('runs the published bridge with npx and passes the port and token', () => {
    expect(JSON.parse(buildMcpClientConfig(48000, 'tok-123', 'other'))).toEqual({
      mcpServers: {
        'asktab-browser': { command: 'npx', args: ['-y', 'asktab-mcp'], env },
      },
    });
  });

  it('wraps npx in cmd /c on Windows, where clients cannot start npx directly', () => {
    expect(JSON.parse(buildMcpClientConfig(48000, 'tok-123', 'windows'))).toEqual({
      mcpServers: {
        'asktab-browser': { command: 'cmd', args: ['/c', 'npx', '-y', 'asktab-mcp'], env },
      },
    });
  });

  it('is pretty-printed so it can be pasted into a client config file', () => {
    expect(buildMcpClientConfig(48000, 'tok-123', 'other')).toContain('\n  "mcpServers"');
  });
});
