/**
 * Background-only tool registration types.
 *
 * Each tool file exports a `ToolRegistration` (or array of them) that pairs
 * the tool's metadata (name, label, description, schema) with its executor.
 * The central registry in tools/index.ts collects these and builds AgentTool[].
 */

import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import type { TObject } from '@sinclair/typebox';

interface ToolContext {
  chatId?: string;
  signal?: AbortSignal;
}

interface ToolResult {
  content: AgentToolResult<unknown>['content'];
  details: unknown;
}

interface ToolRegistration {
  /** LLM-facing tool name, e.g. 'web_search' */
  name: string;
  /** Human-readable label shown in UI */
  label: string;
  /** Tool description shown to the LLM */
  description: string;
  /** TypeBox input schema */
  schema: TObject;
  /** If true, this tool is excluded when running in headless mode */
  excludeInHeadless?: boolean;
  /** If true, this tool is Chrome-only and excluded on Firefox */
  chromeOnly?: boolean;
  /** If true, executor receives chat and agent-run cancellation context */
  needsContext?: boolean;
  /** Raw executor: (args, context?) → result */
  execute: (args: unknown, context?: ToolContext) => Promise<unknown>;
  /**
   * Format raw executor result into content blocks for the LLM.
   * When omitted, the default formatter is used:
   * - string → { type: 'text', text: result }
   * - other  → { type: 'text', text: JSON.stringify(result) }
   */
  formatResult?: (result: unknown) => ToolResult;
}

/** Default result formatter: stringify to text content block */
const defaultFormatResult = (result: unknown): ToolResult => {
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  return { content: [{ type: 'text', text }], details: { output: result } };
};

/** JSON result formatter: stringify to text, details = raw result (for API tools) */
const jsonFormatResult = (result: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(result) }],
  details: result,
});

export { defaultFormatResult, jsonFormatResult };
export type { ToolContext, ToolRegistration, ToolResult };
