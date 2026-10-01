/**
 * Wire protocol between the local MCP bridge and the AskTab extension.
 * The extension imports these types only; this file is the single definition.
 *
 * Handshake (both sides prove they know the shared token; the token is never sent):
 *   bridge → `challenge { nonce }`
 *   extension → `hello { nonce, proof: HMAC(token, "extension:" + bridgeNonce) }`
 *   bridge → `welcome { proof: HMAC(token, "bridge:" + extensionNonce) }`
 * Nonces and proofs are 64 lowercase hex characters. The extension acts on no
 * request until it has verified `welcome`.
 */

type BridgeTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type BridgeContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

type BridgeToExtension =
  | { type: 'challenge'; nonce: string }
  | { type: 'welcome'; proof: string }
  | { type: 'list_tools'; id: string }
  | { type: 'call_tool'; id: string; name: string; args: unknown };

type ExtensionToBridge =
  | { type: 'hello'; nonce: string; proof: string }
  | { type: 'keepalive' }
  | { type: 'tools'; id: string; tools: BridgeTool[] }
  | { type: 'tool_result'; id: string; content: BridgeContent[]; isError: boolean };

/** Close code used for every authentication or handshake failure. */
const AUTH_FAILED_CLOSE_CODE = 4401;

export { AUTH_FAILED_CLOSE_CODE };
export type { BridgeContent, BridgeTool, BridgeToExtension, ExtensionToBridge };
