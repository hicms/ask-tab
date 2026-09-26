import { cn } from '../../utils';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '../ui';
import { Loader2Icon, SendIcon, SquareIcon, XIcon } from 'lucide-react';
import { Children } from 'react';
import type { ComponentProps, HTMLAttributes, KeyboardEventHandler } from 'react';

export type PromptInputProps = HTMLAttributes<HTMLFormElement>;
export const PromptInput = ({ className, ...props }: PromptInputProps) => (
  <form
    className={cn('bg-background shadow-xs w-full overflow-hidden rounded-xl border', className)}
    {...props}
  />
);

export type PromptInputTextareaProps = ComponentProps<typeof Textarea> & {
  minHeight?: number;
  maxHeight?: number;
  disableAutoResize?: boolean;
  resizeOnNewLinesOnly?: boolean;
};
export const PromptInputTextarea = ({
  onChange,
  className,
  placeholder = 'What would you like to know?',
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  minHeight = 48,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  maxHeight = 164,
  disableAutoResize = false,
  resizeOnNewLinesOnly = false,
  ...props
}: PromptInputTextareaProps) => {
  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = e => {
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing || e.shiftKey) return;
      e.preventDefault();
      const form = e.currentTarget.form;
      const submitButton = form?.querySelector('button[type="submit"]') as HTMLButtonElement | null;
      if (submitButton?.disabled) return;
      form?.requestSubmit();
    }
  };
  return (
    <Textarea
      className={cn(
        'outline-hidden w-full resize-none rounded-none border-none p-3 shadow-none ring-0',
        disableAutoResize
          ? 'field-sizing-fixed'
          : resizeOnNewLinesOnly
            ? 'field-sizing-fixed'
            : 'field-sizing-content max-h-[6lh]',
        'bg-transparent dark:bg-transparent',
        'focus-visible:ring-0',
        className,
      )}
      name="message"
      onChange={e => {
        onChange?.(e);
      }}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      {...props}
    />
  );
};

export const PromptInputToolbar = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex items-center justify-between p-1', className)} {...props} />
);

export const PromptInputTools = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex items-center gap-1', '[&_button:first-child]:rounded-bl-xl', className)}
    {...props}
  />
);

export const PromptInputButton = ({
  variant = 'ghost',
  className,
  size,
  ...props
}: ComponentProps<typeof Button>) => {
  const newSize = (size ?? Children.count(props.children) > 1) ? 'default' : 'icon';
  return (
    <Button
      className={cn(
        'shrink-0 gap-1.5 rounded-lg',
        variant === 'ghost' && 'text-muted-foreground',
        newSize === 'default' && 'px-3',
        className,
      )}
      size={newSize as 'default' | 'icon'}
      type="button"
      variant={variant}
      {...props}
    />
  );
};

export type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';

export type PromptInputSubmitProps = ComponentProps<typeof Button> & { status?: ChatStatus };
export const PromptInputSubmit = ({
  className,
  variant = 'default',
  size = 'icon',
  status,
  children,
  ...props
}: PromptInputSubmitProps) => {
  let Icon = <SendIcon className="size-4" />;
  if (status === 'submitted') Icon = <Loader2Icon className="size-4 animate-spin" />;
  else if (status === 'streaming') Icon = <SquareIcon className="size-4" />;
  else if (status === 'error') Icon = <XIcon className="size-4" />;
  return (
    <Button
      className={cn('gap-1.5 rounded-lg', className)}
      size={size}
      type="submit"
      variant={variant}
      {...props}>
      {children ?? Icon}
    </Button>
  );
};

export const PromptInputModelSelect = (props: ComponentProps<typeof Select>) => (
  <Select {...props} />
);
export const PromptInputModelSelectTrigger = ({
  className,
  ...props
}: ComponentProps<typeof SelectTrigger>) => (
  <SelectTrigger
    className={cn(
      'text-muted-foreground border-none bg-transparent font-medium shadow-none transition-colors',
      'hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground',
      'h-auto px-2 py-1.5',
      className,
    )}
    {...props}
  />
);
export const PromptInputModelSelectContent = ({
  className,
  ...props
}: ComponentProps<typeof SelectContent>) => <SelectContent className={cn(className)} {...props} />;
export const PromptInputModelSelectItem = ({
  className,
  ...props
}: ComponentProps<typeof SelectItem>) => <SelectItem className={cn(className)} {...props} />;
export const PromptInputModelSelectValue = ({
  className,
  ...props
}: ComponentProps<typeof SelectValue>) => <SelectValue className={cn(className)} {...props} />;
