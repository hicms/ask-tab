import {
  BRIDGE_ENTRY_PLACEHOLDER,
  buildMcpClientConfig,
} from '../../packages/config-panels/lib/mcp-client-config';
import { describe, expect, it } from 'vitest';

describe('buildMcpClientConfig', () => {
  const parsed = () => JSON.parse(buildMcpClientConfig(48000, 'tok-123'));

  it('describes one stdio server that runs the bridge with the port and token', () => {
    expect(parsed()).toEqual({
      mcpServers: {
        'asktab-browser': {
          command: 'node',
          args: [BRIDGE_ENTRY_PLACEHOLDER],
          env: { ASKTAB_MCP_PORT: '48000', ASKTAB_MCP_TOKEN: 'tok-123' },
        },
      },
    });
  });

  it('points at the built bridge entry inside the repository', () => {
    expect(BRIDGE_ENTRY_PLACEHOLDER).toBe('<path-to-ask-tab>/packages/mcp-bridge/dist/index.mjs');
  });

  it('is pretty-printed so it can be pasted into a client config file', () => {
    expect(buildMcpClientConfig(48000, 'tok-123')).toContain('\n  "mcpServers"');
  });
});
