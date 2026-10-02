import { cn } from '../../utils';
import { ChatCopyIcon } from '../chat-action-icons';
import { FormattedOrRawView } from '../tool-result-view';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui';
import { useT } from '@extension/i18n';
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  CircleHelpIcon,
  Loader2Icon,
  MinusCircleIcon,
  WrenchIcon,
  XCircleIcon,
} from 'lucide-react';
import type { ToolDisplayState } from '../../process-types';
import type { ToolCategory } from '../../tool-call-summary';
import type { ToolPartState } from '@extension/shared';
import type { LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

/**
 * Icon colour per tool category. Green and red are reserved for the success/error status
 * icons, so no category uses them. Related categories share a hue family on purpose:
 * web retrieval (sky) and browser control (indigo) are both "the web"; memory shares
 * purple with the reasoning block as the model's own cognition.
 */
const toolCategoryIconClass: Record<ToolCategory, string> = {
  web: 'text-sky-600 dark:text-sky-400',
  browser: 'text-indigo-600 dark:text-indigo-400',
  code: 'text-orange-600 dark:text-orange-400',
  files: 'text-amber-500 dark:text-amber-400',
  google: 'text-teal-600 dark:text-teal-400',
  agents: 'text-pink-600 dark:text-pink-400',
  memory: 'text-purple-600 dark:text-purple-400',
  other: 'text-muted-foreground',
};

type ToolProps = ComponentProps<typeof Collapsible>;

const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn('not-prose w-full min-w-0 max-w-full rounded-md', className)}
    {...props}
  />
);

type ToolHeaderProps = {
  /** Fallback label when no summary is provided (usually the raw tool name). */
  name: string;
  /** One-line human-readable summary shown instead of the raw tool name. */
  summary?: ReactNode;
  /** Icon representing the tool's category (defaults to a generic wrench). */
  icon?: LucideIcon;
  /** Semantic category, used to colour the icon. */
  category?: ToolCategory;
  state: ToolDisplayState;
  /** Shown as a neutral status instead of the error it is stored as. */
  skipped?: boolean;
  /** Copy handler — when provided, a copy button is shown in the header. */
  onCopy?: () => void;
  className?: string;
};

const statusLabels: Record<ToolPartState, string> = {
  'input-streaming': 'Pending',
  'input-available': 'Running',
  'output-available': 'Completed',
  'output-error': 'Error',
};

const statusIcons: Record<ToolPartState, ReactNode> = {
  'input-streaming': <CircleIcon className="size-3.5" />,
  'input-available': <Loader2Icon className="size-3.5 animate-spin" />,
  'output-available': <CheckCircleIcon className="size-3.5 text-green-600" />,
  'output-error': <XCircleIcon className="size-3.5 text-red-600" />,
};

const ToolHeader = ({
  className,
  name,
  summary,
  icon: Icon = WrenchIcon,
  category = 'other',
  state,
  skipped = false,
  onCopy,
  ...props
}: ToolHeaderProps) => {
  const t = useT();
  return (
    <CollapsibleTrigger
      className={cn(
        'hover:bg-muted/50 group flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1',
        skipped && 'text-muted-foreground',
        className,
      )}
      data-skipped={skipped || undefined}
      {...props}>
      <Icon className={cn('size-3.5 shrink-0', toolCategoryIconClass[category])} />
      <span className="min-w-0 flex-1 truncate text-left text-xs">{summary ?? name}</span>
      {skipped ? (
        <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
          {t('chat_toolSkipped')}
          <MinusCircleIcon className="size-3.5" />
        </span>
      ) : state === 'unknown' || state === 'returned' ? (
        <span
          className="text-muted-foreground flex shrink-0 items-center gap-1 text-[11px]"
          title={t(state === 'unknown' ? 'process_toolUnknown' : 'process_toolReturned')}>
          {state === 'unknown' ? (
            <CircleHelpIcon className="size-3.5" />
          ) : (
            <CircleIcon className="size-3.5" />
          )}
          {t(state === 'unknown' ? 'process_toolUnknown' : 'process_toolReturned')}
        </span>
      ) : (
        <span className="text-muted-foreground shrink-0" title={statusLabels[state]}>
          {statusIcons[state]}
        </span>
      )}
      {onCopy && (
        <Button
          className="chat-action-button size-7 shrink-0 rounded-lg opacity-0 group-hover:opacity-100 [&_svg]:size-[18px]"
          onClick={e => {
            e.stopPropagation();
            onCopy();
          }}
          size="icon"
          variant="ghost">
          <ChatCopyIcon className="size-[18px]" />
        </Button>
      )}
      {!onCopy && <span aria-hidden="true" className="size-7 shrink-0" />}
      <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
};

type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      'data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground border-border/60 outline-hidden ml-1.5 mt-1 border-l pl-3',
      className,
    )}
    {...props}
  />
);

type ToolInputProps = ComponentProps<'div'> & {
  input: Record<string, unknown>;
};

const ToolInput = ({ className, input, ...props }: ToolInputProps) => {
  if (!input || Object.keys(input).length === 0) return null;
  return (
    <div className={cn('space-y-1 overflow-hidden pb-2', className)} {...props}>
      <h4 className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
        Parameters
      </h4>
      <FormattedOrRawView data={input} />
    </div>
  );
};

type ToolOutputProps = ComponentProps<'div'> & {
  output: ReactNode;
  errorText?: string;
};

const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  return (
    <div className={cn('space-y-1 pb-2', className)} {...props}>
      <h4 className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
        {errorText ? 'Error' : 'Result'}
      </h4>
      <div
        className={cn(
          'max-w-full overflow-hidden rounded-md text-xs [&_table]:w-full',
          errorText ? 'bg-destructive/10 text-destructive' : 'bg-muted/30 text-foreground',
        )}>
        {errorText && <div className="whitespace-pre-wrap p-2">{errorText}</div>}
        {output && <div>{output}</div>}
      </div>
    </div>
  );
};

export { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput, toolCategoryIconClass };
export type { ToolProps, ToolHeaderProps, ToolContentProps, ToolInputProps, ToolOutputProps };
