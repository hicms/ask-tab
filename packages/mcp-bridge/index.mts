import { createRequire } from 'node:module';
// The import resolver cannot expand the SDK's `./*` export pattern; tsc and Node can.
// eslint-disable-next-line import-x/no-unresolved
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createExtensionLink } from './lib/extension-link.js';
import { createMcpServer } from './lib/mcp-server.js';

// stdout carries the MCP protocol, so every diagnostic goes to stderr.
const log = (message: string): void => {
  process.stderr.write(`[asktab-mcp] ${message}\n`);
};

const fail = (message: string): never => {
  log(message);
  process.exit(1);
};

const port = Number(process.env['ASKTAB_MCP_PORT']);
const token = process.env['ASKTAB_MCP_TOKEN'] ?? '';
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  fail('ASKTAB_MCP_PORT must be a TCP port number from 1 to 65535.');
}
if (!token) fail('ASKTAB_MCP_TOKEN is required. Copy it from AskTab settings → Tools → MCP.');

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

const link = await createExtensionLink({ port, token, log }).catch(error =>
  fail(error instanceof Error ? error.message : String(error)),
);
const server = createMcpServer(link, version);
await server.connect(new StdioServerTransport());
log(`Listening for the AskTab extension on ws://${link.address.host}:${link.address.port}`);

const shutdown = async (): Promise<void> => {
  await link.close();
  process.exit(0);
};
process.stdin.on('close', () => void shutdown());
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
