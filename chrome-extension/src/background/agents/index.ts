// Barrel export for agents module
//
// WARNING: Importing from this barrel loads agent-setup.ts which pulls in
// @extension/storage and other heavy modules at module level. In tests,
// import npm types directly from '@mariozechner/pi-agent-core' or
// '@mariozechner/pi-ai' instead of from this barrel to avoid triggering
// chrome/storage initialization.
//
// Local — AskTab error guard wrappers
export { Agent } from './agent';
export type { AgentOptions } from './agent';
export { agentLoop, agentLoopContinue } from './agent-loop';

// Agent lifecycle
export { runAgent } from './agent-setup';
export type { RunAgentOpts, RunAgentResult } from './agent-setup';

// Tool loop detection
export {
  createToolLoopState,
  detectToolCallLoop,
  recordToolCall,
  recordToolCallOutcome,
} from './tool-loop-detection';
export type {
  ToolLoopConfig,
  ToolLoopState,
  ToolCallRecord,
  LoopDetectionResult,
} from './tool-loop-detection';

// Streaming
export { handleLLMStream } from './stream-handler';
export { createStreamFn, completeText } from './stream-bridge';
export { chatMessagesToPiMessages, convertToLlm } from './message-adapter';
export { chatModelToPiModel } from './model-adapter';

// Agent types from npm
export type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentState,
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
  StreamFn,
  ThinkingLevel,
} from '@mariozechner/pi-agent-core';

// AI types from npm
export type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  ImageContent,
  Message,
  Model,
  SimpleStreamOptions,
  StopReason,
  TextContent,
  ThinkingBudgets,
  ThinkingContent,
  Tool,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from '@mariozechner/pi-ai';

// Values from npm
export {
  EventStream,
  createAssistantMessageEventStream,
  validateToolArguments,
  validateToolCall,
} from '@mariozechner/pi-ai';

// Re-exported as type-only (pi-ai's types.d.ts uses `export type`)
export type { AssistantMessageEventStream } from '@mariozechner/pi-ai';
