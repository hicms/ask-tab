import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpBridgeConfig } from '../../packages/storage/lib/impl/mcp-bridge-config-storage';

let storedData: McpBridgeConfig | undefined;
vi.mock('../../packages/storage/lib/base/index.js', () => ({
  createStorage: <T>(_key: string, defaultValue: T) => ({
    get: vi.fn(async () => storedData ?? defaultValue),
    set: vi.fn(async (value: T) => {
      storedData = value as McpBridgeConfig;
    }),
    getSnapshot: vi.fn(() => storedData ?? defaultValue),
    subscribe: vi.fn(),
  }),
  StorageEnum: { Local: 'local', Session: 'session' },
}));

const {
  mcpBridgeConfigStorage,
  generateMcpBridgeToken,
  DEFAULT_MCP_BRIDGE_PORT,
  MCP_BRIDGE_STORAGE_KEY,
} = await import('../../packages/storage/lib/impl/mcp-bridge-config-storage');
const { captureFullBackup } = await import('../../packages/storage/lib/impl/full-backup');

beforeEach(() => {
  storedData = undefined;
});

describe('MCP bridge configuration', () => {
  it('is disabled with the default port and no token on a fresh install', async () => {
    expect(await mcpBridgeConfigStorage.get()).toEqual({
      enabled: false,
      port: DEFAULT_MCP_BRIDGE_PORT,
      token: '',
    });
    expect(DEFAULT_MCP_BRIDGE_PORT).toBe(47821);
  });

  it('stores a valid configuration', async () => {
    const config = { enabled: true, port: 50000, token: 'abc' };
    await mcpBridgeConfigStorage.set(config);
    expect(await mcpBridgeConfigStorage.get()).toEqual(config);
  });

  it.each([1023, 65536, 1.5, Number.NaN, '4000'])('rejects the port %s', async port => {
    const invalid = { enabled: true, port, token: 'abc' } as unknown as McpBridgeConfig;
    await expect(mcpBridgeConfigStorage.set(invalid)).rejects.toThrow('Invalid MCP bridge');
    expect(storedData).toBeUndefined();
  });

  it.each([
    { enabled: 'yes', port: 47821, token: '' },
    { enabled: true, port: 47821, token: 1 },
    { enabled: true, port: 47821, token: '', extra: 'x' },
  ])('rejects a malformed configuration %#', async invalid => {
    await expect(mcpBridgeConfigStorage.set(invalid as unknown as McpBridgeConfig)).rejects.toThrow(
      'Invalid MCP bridge',
    );
  });

  it('rejects a malformed stored value at the read boundary', async () => {
    storedData = { enabled: true, port: 80, token: 'abc' };
    await expect(mcpBridgeConfigStorage.get()).rejects.toThrow('Invalid MCP bridge');
  });
});

describe('generateMcpBridgeToken', () => {
  it('returns a 32 character URL-safe token that differs on every call', () => {
    const first = generateMcpBridgeToken();
    const second = generateMcpBridgeToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(second).not.toBe(first);
  });
});

describe('full backup', () => {
  it('does not include the MCP bridge token', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({
            [MCP_BRIDGE_STORAGE_KEY]: { enabled: true, port: 47821, token: 'secret-token' },
            'log-config': { level: 'info' },
          })),
        },
      },
    });

    const backup = await captureFullBackup().catch(() => null);

    expect(MCP_BRIDGE_STORAGE_KEY).toBe('mcp-bridge-config');
    expect(backup).not.toBeNull();
    expect(Object.keys(backup!.local)).not.toContain(MCP_BRIDGE_STORAGE_KEY);
    expect(JSON.stringify(backup)).not.toContain('secret-token');
  });
});
