import { createStorage, StorageEnum } from '../base/index.js';
import { nanoid } from 'nanoid';

interface McpBridgeConfig {
  enabled: boolean;
  port: number;
  /** Shared secret for the local MCP bridge. Kept out of full backups. */
  token: string;
}

const MCP_BRIDGE_STORAGE_KEY = 'mcp-bridge-config';
const DEFAULT_MCP_BRIDGE_PORT = 47821;
const MIN_MCP_BRIDGE_PORT = 1024;
const MAX_MCP_BRIDGE_PORT = 65535;

const defaultMcpBridgeConfig: McpBridgeConfig = {
  enabled: false,
  port: DEFAULT_MCP_BRIDGE_PORT,
  token: '',
};

const generateMcpBridgeToken = (): string => nanoid(32);

const assertMcpBridgeConfig: (value: unknown) => asserts value is McpBridgeConfig = value => {
  const config = value as Record<string, unknown> | null;
  if (
    typeof config !== 'object' ||
    config === null ||
    Object.keys(config).some(key => !['enabled', 'port', 'token'].includes(key)) ||
    typeof config.enabled !== 'boolean' ||
    typeof config.token !== 'string' ||
    !Number.isInteger(config.port) ||
    (config.port as number) < MIN_MCP_BRIDGE_PORT ||
    (config.port as number) > MAX_MCP_BRIDGE_PORT
  ) {
    throw new Error(
      `Invalid MCP bridge configuration: port must be an integer from ${MIN_MCP_BRIDGE_PORT} to ${MAX_MCP_BRIDGE_PORT}`,
    );
  }
};

const rawMcpBridgeConfigStorage = createStorage<McpBridgeConfig>(
  MCP_BRIDGE_STORAGE_KEY,
  defaultMcpBridgeConfig,
  { storageEnum: StorageEnum.Local, liveUpdate: true },
);

const mcpBridgeConfigStorage = {
  get: async (): Promise<McpBridgeConfig> => {
    const stored = await rawMcpBridgeConfigStorage.get();
    assertMcpBridgeConfig(stored);
    return stored;
  },
  set: async (value: McpBridgeConfig): Promise<void> => {
    assertMcpBridgeConfig(value);
    await rawMcpBridgeConfigStorage.set(value);
  },
  getSnapshot: rawMcpBridgeConfigStorage.getSnapshot.bind(rawMcpBridgeConfigStorage),
  subscribe: rawMcpBridgeConfigStorage.subscribe.bind(rawMcpBridgeConfigStorage),
};

export type { McpBridgeConfig };
export {
  mcpBridgeConfigStorage,
  generateMcpBridgeToken,
  DEFAULT_MCP_BRIDGE_PORT,
  MCP_BRIDGE_STORAGE_KEY,
};
