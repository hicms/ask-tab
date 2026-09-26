import { DocumentPreview } from './document-preview';
import { Response } from './elements/response';
import { toolCategoryIconClass } from './elements/tool';
import { Badge, Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui';
import { cn } from '../utils';
import {
  CheckCircleIcon,
  ChevronDownIcon,
  Loader2Icon,
  BotIcon,
  XCircleIcon,
  SquareIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SubagentProgressInfo, SubagentProgressStep } from '@extension/shared';

type SubagentProgressCardProps = {
  info: SubagentProgressInfo;
  className?: string;
  onStop?: (runId: string) => void;
};

const formatElapsed = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
};

const formatJson = (raw: string): string => {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
};

const StepDetails = ({ step }: { step: SubagentProgressStep }) => {
  if (!step.args && !step.result) return null;

  return (
    <Collapsible>
      <CollapsibleTrigger className="text-muted-foreground ml-5 text-[10px] underline decoration-dotted hover:no-underline">
        details
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-5 mt-1 space-y-1">
        {step.args && (
          <div>
            <p className="text-muted-foreground text-[10px] font-medium">Args</p>
            <pre className="bg-muted max-h-32 overflow-auto rounded p-1.5 text-[10px] leading-tight">
              {formatJson(step.args)}
            </pre>
          </div>
        )}
        {step.result && (
          <div>
            <p className="text-muted-foreground text-[10px] font-medium">Result</p>
            <pre
              className={cn(
                'max-h-32 overflow-auto rounded p-1.5 text-[10px] leading-tight',
                step.status === 'error'
                  ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                  : 'bg-muted',
              )}>
              {formatJson(step.result)}
            </pre>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};

const SubagentProgressCard = ({ info, className, onStop }: SubagentProgressCardProps) => {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - info.startedAt) / 1000));

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - info.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [info.startedAt]);

  return (
    <Collapsible
      className={cn('not-prose mb-4 w-full rounded-md border', className)}
      defaultOpen={true}>
      <CollapsibleTrigger className="flex w-full min-w-0 items-center justify-between gap-2 p-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <BotIcon className={cn('size-4 shrink-0 animate-pulse', toolCategoryIconClass.agents)} />
          <span className="truncate text-sm font-medium">
            {info.task.length > 60 ? info.task.slice(0, 60) + '…' : info.task}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge className="flex items-center gap-1 rounded-full text-xs" variant="secondary">
            <Loader2Icon className="size-3 animate-spin" />
            <span>{formatElapsed(elapsed)}</span>
          </Badge>
          {onStop && (
            <button
              aria-label="Stop subagent"
              className="text-muted-foreground hover:text-foreground hover:bg-muted rounded p-0.5 transition-colors"
              onClick={e => {
                e.stopPropagation();
                onStop(info.runId);
              }}
              type="button">
              <SquareIcon className="size-3.5" />
            </button>
          )}
          <ChevronDownIcon className="text-muted-foreground size-4 transition-transform group-data-[state=open]:rotate-180" />
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent className="text-popover-foreground outline-hidden">
        <div className="space-y-1 px-4 pb-3">
          <p className="text-muted-foreground mb-2 whitespace-pre-wrap text-xs">
            {info.task.length > 300 ? info.task.slice(0, 300) + '…' : info.task}
          </p>
          {info.steps.length === 0 && (
            <p className="text-muted-foreground animate-pulse text-xs">Starting...</p>
          )}
          {info.steps.map((step, i) => (
            <div key={step.toolCallId || `${step.toolName}-${i}`} className="space-y-0.5">
              <div className="flex items-center gap-2 text-xs">
                {step.status === 'running' && (
                  <Loader2Icon className="text-muted-foreground size-3 animate-spin" />
                )}
                {step.status === 'done' && <CheckCircleIcon className="size-3 text-green-600" />}
                {step.status === 'error' && <XCircleIcon className="size-3 text-red-600" />}
                <span className={cn(step.status === 'error' && 'text-red-600')}>
                  {step.toolName}
                </span>
                {step.endedAt && step.startedAt && (
                  <span className="text-muted-foreground text-[10px]">
                    {formatElapsed(Math.floor((step.endedAt - step.startedAt) / 1000))}
                  </span>
                )}
              </div>
              <StepDetails step={step} />
            </div>
          ))}
          {info.stepCount > 0 && (
            <p className="text-muted-foreground mt-1 text-xs">Turn {info.stepCount}</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

type SubagentResultCardProps = {
  runId: string;
  task: string;
  findings: string;
  artifactId?: string;
};

const SubagentResultCard = ({ task, findings, artifactId }: SubagentResultCardProps) => (
  <div className="not-prose mb-4 w-full space-y-3">
    <div className="flex min-w-0 items-center gap-2">
      <BotIcon className={cn('size-4 shrink-0', toolCategoryIconClass.agents)} />
      <span className="truncate text-sm font-medium">{task}</span>
      <Badge className="shrink-0 rounded-full text-xs" variant="secondary">
        <CheckCircleIcon className="mr-1 size-3 text-green-600" />
        Done
      </Badge>
    </div>
    {artifactId ? (
      <DocumentPreview result={{ id: artifactId, title: task, kind: 'text' }} />
    ) : (
      <Collapsible className="w-full rounded-md border" defaultOpen={true}>
        <CollapsibleTrigger className="text-muted-foreground flex w-full items-center gap-1 px-3 py-2 text-xs hover:underline">
          <ChevronDownIcon className="size-3 transition-transform group-data-[state=open]:rotate-180" />
          Findings
        </CollapsibleTrigger>
        <CollapsibleContent className="outline-hidden">
          <div className="max-w-none px-4 pb-3">
            <Response>{findings}</Response>
          </div>
        </CollapsibleContent>
      </Collapsible>
    )}
  </div>
);

export { SubagentProgressCard, SubagentResultCard };
export type { SubagentProgressCardProps, SubagentResultCardProps };
