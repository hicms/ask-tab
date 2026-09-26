// ---------------------------------------------------------------------------
// Tool registry — collects tool definitions from individual tool files and
// builds AgentTool[] for the agent loop.
// ---------------------------------------------------------------------------

import { agentsListToolDef } from './agents-list';
import { browserToolDef } from './browser';
import { debuggerToolDef } from './debugger';
import { deepResearchToolDef } from './deep-research';
import { createDocumentToolDef } from './documents';
import { executeJsToolDef, executeCustomTool } from './execute-js';
import { calendarToolDefs } from './google-calendar';
import { driveToolDefs } from './google-drive';
import { gmailToolDefs } from './google-gmail';
import { memoryToolDefs } from './memory-tools';
import { schedulerToolDef } from './scheduler';
import { subagentToolDefs } from './subagent';
import { defaultFormatResult } from './tool-registration';
import { webFetchToolDef } from './web-fetch';
import { webSearchToolDef } from './web-search';
import { workspaceToolDefs } from './workspace';
import { createLogger } from '../logging/logger-buffer';
import { IS_FIREFOX } from '@extension/env';
import { toolConfigStorage, activeAgentStorage, getAgent } from '@extension/storage';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { ToolRegistration, ToolContext } from './tool-registration';
import type { AgentTool } from '../agents';
import type { ToolConfig, CustomToolDef } from '@extension/storage';
import type { TObject } from '@sinclair/typebox';

const toolLog = createLogger('tool');

const TOOL_TIMEOUT_MS = 300_000; // 5 minutes

const withTimeout = <T>(promise: Promise<T>, ms: number, toolName: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Tool "${toolName}" timed out after ${ms}ms`)), ms),
    ),
  ]);

// ---------------------------------------------------------------------------
// Master registry — all built-in tools in a single flat array
// ---------------------------------------------------------------------------

const ALL_TOOLS: ToolRegistration[] = [
  webSearchToolDef,
  createDocumentToolDef,
  browserToolDef,
  ...workspaceToolDefs,
  schedulerToolDef,
  ...memoryToolDefs,
  webFetchToolDef,
  deepResearchToolDef,
  agentsListToolDef,
  executeJsToolDef,
  ...gmailToolDefs,
  ...calendarToolDefs,
  ...driveToolDefs,
  debuggerToolDef,
  ...subagentToolDefs,
];

// ── Auto-built lookup maps (derived from ALL_TOOLS) ──

const schemaLookup = new Map<string, TObject>(ALL_TOOLS.map(t => [t.name, t.schema]));

const registrationLookup = new Map<string, ToolRegistration>(ALL_TOOLS.map(t => [t.name, t]));

// ---------------------------------------------------------------------------
// Custom tool schema builder
// ---------------------------------------------------------------------------

/** Build a TypeBox schema from custom tool param definitions */
const buildCustomToolSchema = (params: CustomToolDef['params']) => {
  const props: Record<
    string,
    | ReturnType<typeof Type.String>
    | ReturnType<typeof Type.Number>
    | ReturnType<typeof Type.Boolean>
    | ReturnType<typeof Type.Unknown>
  > = {};
  for (const p of params) {
    switch (p.type) {
      case 'number':
        props[p.name] = Type.Number({ description: p.description });
        break;
      case 'boolean':
        props[p.name] = Type.Boolean({ description: p.description });
        break;
      case 'string':
        props[p.name] = Type.String({ description: p.description });
        break;
      default:
        props[p.name] = Type.Unknown({ description: p.description });
    }
  }
  return Type.Object(props);
};

// ---------------------------------------------------------------------------
// getAgentTools — builds AgentTool[] from the registry
// ---------------------------------------------------------------------------

/**
 * Build pi-agent AgentTool[] based on the user's tool config.
 * Iterates the tool registry and checks each tool against enabledTools[tool.name].
 * @param opts.headless - If true, excludes tools marked with excludeInHeadless: true.
 */
const getAgentTools = async (opts?: {
  headless?: boolean;
  chatId?: string;
}): Promise<AgentTool[]> => {
  const config = await toolConfigStorage.get();
  const tools: AgentTool[] = [];

  for (const def of ALL_TOOLS) {
    // Check if enabled
    if (!(config.enabledTools[def.name] ?? false)) continue;
    // Exclude Chrome-only tools on Firefox
    if (def.chromeOnly && IS_FIREFOX) continue;
    // Exclude headless-incompatible tools when in headless mode
    if (def.excludeInHeadless && opts?.headless) continue;

    const format = def.formatResult ?? defaultFormatResult;

    tools.push({
      name: def.name,
      label: def.label,
      description: def.description,
      parameters: def.schema,
      execute: async (_toolCallId, params, signal) => {
        const context: ToolContext | undefined = def.needsContext
          ? { chatId: opts?.chatId, signal }
          : undefined;
        const raw = await def.execute(params, context);
        return format(raw);
      },
    });
  }

  // Inject agent-specific custom tools
  try {
    const agentId = await activeAgentStorage.get();
    if (agentId) {
      const agent = await getAgent(agentId);
      const customTools = agent?.customTools ?? [];
      for (const ct of customTools) {
        if (!config.enabledTools[ct.name] && !agent?.toolConfig?.enabledTools[ct.name]) continue;
        tools.push({
          name: ct.name,
          label: ct.name,
          description: ct.description,
          parameters: buildCustomToolSchema(ct.params),
          execute: async (_toolCallId, params) => {
            const result = await executeCustomTool(ct, params as Record<string, unknown>, agentId);
            return defaultFormatResult(result);
          },
        });
      }
    }
  } catch (err) {
    toolLog.warn('Failed to load custom tools', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return tools;
};

// ---------------------------------------------------------------------------
// executeTool — execute a tool by name (used by the agent loop)
// ---------------------------------------------------------------------------

/**
 * Execute a tool by name with the given arguments.
 *
 * Convention: individual tool executors return error strings on failure (never throw).
 * This wrapper adds a try/catch as a safety net — if an executor does throw, the error
 * is logged and re-thrown so the caller can surface it to the LLM.
 */
const executeTool = async (
  toolName: string,
  args: unknown,
  context?: ToolContext,
): Promise<unknown> => {
  toolLog.info('Execute', { toolName });
  toolLog.trace('Execute args', { toolName, args });
  try {
    // Validate args against schema when available
    const schema = schemaLookup.get(toolName);
    if (schema) {
      try {
        if (!Value.Check(schema, args)) {
          const errors = [...Value.Errors(schema, args)];
          const details = errors.map(e => `${e.path}: ${e.message}`).join('; ');
          return `Error: Invalid arguments for tool "${toolName}": ${details}`;
        }
      } catch {
        // Schema may not be a valid TypeBox schema (e.g. in tests) — skip validation
      }
    }

    const reg = registrationLookup.get(toolName);
    if (reg) {
      const result = await withTimeout(reg.execute(args, context), TOOL_TIMEOUT_MS, toolName);
      toolLog.trace('Execute result', {
        toolName,
        resultType: typeof result,
        isArray: Array.isArray(result),
        length: Array.isArray(result) ? result.length : undefined,
      });
      toolLog.debug('Complete', { toolName });
      return result;
    }

    // Check if it's a custom tool for the active agent
    const agentId = await activeAgentStorage.get();
    if (agentId) {
      const agent = await getAgent(agentId);
      const ct = agent?.customTools?.find(t => t.name === toolName);
      if (ct) {
        const result = await withTimeout(
          executeCustomTool(ct, (args ?? {}) as Record<string, unknown>, agentId),
          TOOL_TIMEOUT_MS,
          toolName,
        );
        toolLog.debug('Complete (custom)', { toolName });
        return result;
      }
    }

    throw new Error(`Unknown tool: ${toolName}`);
  } catch (err) {
    toolLog.error('Failed', { toolName, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
};

// ---------------------------------------------------------------------------
// Utility exports
// ---------------------------------------------------------------------------

/**
 * Get the tool config.
 */
const getToolConfig = async (): Promise<ToolConfig> => toolConfigStorage.get();

/** Returns the set of tool names that have actual implementations (schemas + executors).
 *  Chrome-only tools are excluded on Firefox. */
const getImplementedToolNames = (): Set<string> => {
  if (IS_FIREFOX) {
    const names = new Set<string>();
    for (const def of ALL_TOOLS) {
      if (!def.chromeOnly) {
        names.add(def.name);
      }
    }
    return names;
  }
  return new Set(schemaLookup.keys());
};

export {
  getAgentTools,
  executeTool,
  getToolConfig,
  getImplementedToolNames,
  withTimeout,
  TOOL_TIMEOUT_MS,
};
