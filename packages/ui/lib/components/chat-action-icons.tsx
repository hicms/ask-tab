import { cn } from '../utils';
import type { SVGProps } from 'react';

type ChatActionIconProps = SVGProps<SVGSVGElement> & { size?: number };

/** Shared geometry for the chat's blue, softly rounded action icons. */
const ChatActionIcon = ({ size = 24, children, ...props }: ChatActionIconProps) => (
  <svg
    aria-hidden="true"
    fill="none"
    focusable="false"
    height={size}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    viewBox="0 0 24 24"
    width={size}
    {...props}>
    {children}
  </svg>
);

const ChatSendIcon = (props: ChatActionIconProps) => (
  <ChatActionIcon strokeWidth={2.6} {...props}>
    <path d="m5.75 10.5 6.25-6.25 6.25 6.25M12 4.75v15" />
  </ChatActionIcon>
);

const ChatAttachmentIcon = ({ className, ...props }: ChatActionIconProps) => (
  <ChatActionIcon className={cn('chat-action-icon', className)} {...props}>
    <g transform="rotate(18 12 12)">
      <rect
        fill="currentColor"
        fillOpacity={0.12}
        height={17.5}
        rx={5.5}
        stroke="none"
        width={11}
        x={6.5}
        y={3.5}
      />
      <path d="M9.5 8v7.5a2.5 2.5 0 0 0 5 0V7.5a4 4 0 0 0-8 0v8a5.5 5.5 0 0 0 11 0V9" />
    </g>
  </ChatActionIcon>
);

const ChatCopyIcon = ({ className, ...props }: ChatActionIconProps) => (
  <ChatActionIcon className={cn('chat-action-icon', className)} {...props}>
    <rect
      fill="currentColor"
      fillOpacity={0.18}
      height={14}
      rx={2.5}
      stroke="none"
      width={11}
      x={3.5}
      y={3.5}
    />
    <path d="M8 7.5h7.5l5 4.5v6.5a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-11ZM15.5 7.5V12h5M11.5 15.5H17" />
  </ChatActionIcon>
);

const ChatQueueIcon = ({ className, ...props }: ChatActionIconProps) => (
  <ChatActionIcon className={cn('chat-action-icon', className)} {...props}>
    <path d="M9.5 14.5v4.25" opacity={0.22} strokeWidth={3} />
    <path d="M4.75 18.75V13a4.5 4.5 0 0 1 4.5-4.5h10m-4.75-4.75 4.75 4.75-4.75 4.75" />
  </ChatActionIcon>
);

const ChatOptionsIcon = (props: ChatActionIconProps) => (
  <ChatActionIcon strokeWidth={2.4} {...props}>
    <path d="m6.5 9.5 5.5 5 5.5-5" />
  </ChatActionIcon>
);

export { ChatSendIcon, ChatAttachmentIcon, ChatCopyIcon, ChatQueueIcon, ChatOptionsIcon };
export type { ChatActionIconProps };
