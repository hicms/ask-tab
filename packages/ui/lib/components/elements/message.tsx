import { cn } from '../../utils';
import { Avatar, AvatarFallback, AvatarImage } from '../ui';
import type { ChatMessage } from '@extension/shared';
import type { ComponentProps, HTMLAttributes } from 'react';

type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: ChatMessage['role'];
};

const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      'group flex w-full items-end justify-end gap-2 py-4',
      from === 'user' ? 'is-user' : 'is-assistant flex-row-reverse justify-end',
      '[&>div]:max-w-[80%]',
      className,
    )}
    {...props}
  />
);

type MessageContentProps = HTMLAttributes<HTMLDivElement>;

const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      'text-foreground flex flex-col gap-2 overflow-hidden rounded-lg px-4 py-3 text-sm',
      'group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground',
      'group-[.is-assistant]:bg-secondary group-[.is-assistant]:text-foreground',
      className,
    )}
    {...props}>
    {children}
  </div>
);

type MessageAvatarProps = ComponentProps<typeof Avatar> & {
  src: string;
  name?: string;
};

const MessageAvatar = ({ src, name, className, ...props }: MessageAvatarProps) => (
  <Avatar className={cn('ring-border size-8 ring-1', className)} {...props}>
    <AvatarImage alt="" className="my-0" src={src} />
    <AvatarFallback>{name?.slice(0, 2) || 'ME'}</AvatarFallback>
  </Avatar>
);

export { Message, MessageContent, MessageAvatar };
export type { MessageProps, MessageContentProps, MessageAvatarProps };
