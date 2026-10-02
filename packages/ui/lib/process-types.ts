import type { ChatMessagePart, ToolPartState } from '@extension/shared';

type ToolDisplayState = ToolPartState | 'returned' | 'unknown';
type ToolCallPart = Extract<ChatMessagePart, { type: 'tool-call' }>;
type ToolResultPart = Extract<ChatMessagePart, { type: 'tool-result' }>;

type ProcessItem =
  | { kind: 'reasoning'; key: string; index: number; text: string; running: boolean }
  | {
      kind: 'tool';
      key: string;
      index: number;
      call: ToolCallPart;
      state: ToolDisplayState;
      skipped: boolean;
      hasResult: boolean;
      result: unknown;
    }
  | {
      kind: 'result';
      key: string;
      index: number;
      part: ToolResultPart;
      state: ToolDisplayState;
      skipped: boolean;
    };

type ContentItem = { kind: 'part'; key: string; index: number; part: ChatMessagePart };
type NormalizedPart = ProcessItem | ContentItem;
type ProcessGroup = { kind: 'process-group'; key: string; members: ProcessItem[]; closed: boolean };
type ProcessRenderItem = ProcessGroup | ContentItem;

type ProcessActivity =
  | 'read'
  | 'write'
  | 'edit'
  | 'files'
  | 'webSearch'
  | 'webFetch'
  | 'browser'
  | 'code'
  | 'memory'
  | 'subagents'
  | 'tools';

type ProcessSummary = {
  counts: { kind: ProcessActivity; count: number }[];
  running?: ProcessActivity;
  detail: string;
  errors: number;
  skipped: number;
  unknown: number;
  resultOnly: boolean;
};

export type {
  ToolDisplayState,
  ProcessItem,
  ContentItem,
  NormalizedPart,
  ProcessGroup,
  ProcessRenderItem,
  ProcessActivity,
  ProcessSummary,
};
