import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from './elements/tool';
import { ToolResultView } from './tool-result-view';
import { getToolCategory, getToolIcon, summarizeToolCall } from '../tool-call-summary';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import type { ToolDisplayState } from '../process-types';

type ToolCallPartProps = {
  state: ToolDisplayState;
  toolName: string;
  args?: Record<string, unknown>;
  result: unknown;
  hasResult: boolean;
  skipped?: boolean;
};

const ToolCallPart = ({
  state,
  toolName,
  args,
  result,
  hasResult,
  skipped = false,
}: ToolCallPartProps) => {
  const [open, setOpen] = useState(false);
  const isRunning = state === 'input-streaming' || state === 'input-available';
  const handleCopy = useCallback(() => {
    const parts = [
      `Tool: ${toolName}`,
      args ? `Parameters: ${JSON.stringify(args, null, 2)}` : null,
      hasResult
        ? `Result: ${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}`
        : null,
    ];
    navigator.clipboard.writeText(parts.filter(Boolean).join('\n\n')).then(() => {
      toast.success('Copied to clipboard');
    });
  }, [toolName, args, result, hasResult]);
  const summary = summarizeToolCall(
    toolName,
    args,
    result,
    state === 'unknown' || state === 'returned' ? undefined : state,
  );

  return (
    <Tool data-testid="process-tool" onOpenChange={setOpen} open={open}>
      <ToolHeader
        category={getToolCategory(toolName)}
        icon={getToolIcon(toolName)}
        name={toolName}
        onCopy={!isRunning ? handleCopy : undefined}
        skipped={skipped}
        state={state}
        summary={state === 'unknown' ? toolName : summary}
      />
      <ToolContent forceMount hidden={!open}>
        {state !== 'input-streaming' && args && <ToolInput input={args} />}
        {hasResult && !skipped && (
          <ToolOutput
            errorText={
              state === 'output-error'
                ? typeof result === 'string'
                  ? result
                  : JSON.stringify(result)
                : undefined
            }
            output={
              state !== 'output-error' ? (
                <ToolResultView args={args} result={result} toolName={toolName} />
              ) : null
            }
          />
        )}
      </ToolContent>
    </Tool>
  );
};

export { ToolCallPart };
