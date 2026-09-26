import { Response } from './response';
import { cn } from '../../utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui';
import { useControllableState } from '@radix-ui/react-use-controllable-state';
import { BrainIcon, ChevronDownIcon } from 'lucide-react';
import { createContext, memo, useContext, useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';

type ReasoningContextValue = {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number;
};

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

const useReasoning = () => {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error('Reasoning components must be used within Reasoning');
  }
  return context;
};

type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
};

const AUTO_CLOSE_DELAY = 500;
const MS_IN_S = 1000;

const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen = true,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }: ReasoningProps) => {
    const [isOpen, setIsOpen] = useControllableState({
      prop: open,
      defaultProp: defaultOpen,
      onChange: onOpenChange,
    });
    const [duration, setDuration] = useControllableState({
      prop: durationProp,
      defaultProp: 0,
    });

    const [hasAutoClosedRef, setHasAutoClosedRef] = useState(false);
    const [startTime, setStartTime] = useState<number | null>(null);

    useEffect(() => {
      if (isStreaming) {
        if (startTime === null) {
          setStartTime(Date.now());
        }
      } else if (startTime !== null) {
        setDuration(Math.round((Date.now() - startTime) / MS_IN_S));
        setStartTime(null);
      }
    }, [isStreaming, startTime, setDuration]);

    useEffect(() => {
      if (defaultOpen && !isStreaming && isOpen && !hasAutoClosedRef) {
        const timer = setTimeout(() => {
          setIsOpen(false);
          setHasAutoClosedRef(true);
        }, AUTO_CLOSE_DELAY);

        return () => clearTimeout(timer);
      }
      return undefined;
    }, [isStreaming, isOpen, defaultOpen, setIsOpen, hasAutoClosedRef]);

    const handleOpenChange = (newOpen: boolean) => {
      setIsOpen(newOpen);
    };

    return (
      <ReasoningContext.Provider
        value={{ isStreaming, isOpen: isOpen ?? false, setIsOpen, duration: duration ?? 0 }}>
        <Collapsible
          className={cn('not-prose', className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}>
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  },
);

type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger>;

const ReasoningTrigger = memo(({ className, children, ...props }: ReasoningTriggerProps) => {
  const { isStreaming, isOpen, duration } = useReasoning();

  return (
    <CollapsibleTrigger
      className={cn(
        'text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors',
        className,
      )}
      {...props}>
      {children ?? (
        <>
          {/* Purple = the model's own cognition; shared with the memory tool category. */}
          <BrainIcon
            className={cn(
              'size-3 text-purple-600 dark:text-purple-400',
              isStreaming && 'animate-pulse',
            )}
          />
          {isStreaming ? (
            <span>Thinking…</span>
          ) : duration > 0 ? (
            <span>Thought for {duration}s</span>
          ) : (
            <span>Thought</span>
          )}
          <ChevronDownIcon
            className={cn('size-2.5 transition-transform', isOpen ? 'rotate-180' : 'rotate-0')}
          />
        </>
      )}
    </CollapsibleTrigger>
  );
});

type ReasoningContentProps = ComponentProps<typeof CollapsibleContent> & {
  children: string;
};

const ReasoningContent = memo(({ className, children, ...props }: ReasoningContentProps) => {
  const { isStreaming } = useReasoning();
  const scrollRef = useRef<HTMLDivElement>(null);

  // The box is height-capped, so keep the newest thinking in view while it streams.
  useEffect(() => {
    const el = scrollRef.current;
    if (isStreaming && el) el.scrollTop = el.scrollHeight;
  }, [children, isStreaming]);

  return (
    <CollapsibleContent
      className={cn(
        'text-muted-foreground mt-1.5 text-[11px] leading-relaxed',
        'data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-hidden',
        className,
      )}
      {...props}>
      <div
        className="border-border/50 bg-muted/30 max-h-48 overflow-y-auto rounded-md border p-2.5"
        ref={scrollRef}>
        <Response className="grid gap-1 text-[11px] [&_li]:my-0 [&_ol]:my-1 [&_p]:my-0 [&_ul]:my-1">
          {children}
        </Response>
      </div>
    </CollapsibleContent>
  );
});

Reasoning.displayName = 'Reasoning';
ReasoningTrigger.displayName = 'ReasoningTrigger';
ReasoningContent.displayName = 'ReasoningContent';

export { Reasoning, ReasoningTrigger, ReasoningContent };
export type { ReasoningProps, ReasoningTriggerProps, ReasoningContentProps };
