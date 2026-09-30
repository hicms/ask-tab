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
    <path d="m4.75 10.5 7.25-7.25 7.25 7.25M12 3.75V20.5" />
  </ChatActionIcon>
);

const ChatAttachmentIcon = ({ className, ...props }: ChatActionIconProps) => (
  <ChatActionIcon className={cn('chat-action-icon', className)} strokeWidth={2.2} {...props}>
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
    <path d="M8 7.5h7.5l5 4.5v6.5a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-11ZM15.5 7.5V12h5M11.5 15H17M11.5 18H17" />
  </ChatActionIcon>
);

const ChatQueueIcon = ({ className, ...props }: ChatActionIconProps) => (
  <ChatActionIcon className={cn('chat-action-icon', className)} strokeWidth={2.6} {...props}>
    <path d="M9.5 14.5V20" opacity={0.18} strokeWidth={3.5} />
    <path d="M3.5 20v-7a5 5 0 0 1 5-5h12m-5-5 5 5-5 5" />
  </ChatActionIcon>
);

const ChatOptionsIcon = (props: ChatActionIconProps) => (
  <ChatActionIcon strokeWidth={2.4} {...props}>
    <path d="m5.5 9 6.5 6 6.5-6" />
  </ChatActionIcon>
);

const ChatQueuedMessageIcon = (props: ChatActionIconProps) => (
  <ChatActionIcon {...props}>
    <path d="M6.5 3.5H15L19.5 8v9a2 2 0 0 1-2 2H9l-4.5 3V5.5a2 2 0 0 1 2-2ZM15 3.5V8h4.5M8 11.5h8M8 15h5" />
  </ChatActionIcon>
);

export {
  ChatSendIcon,
  ChatAttachmentIcon,
  ChatCopyIcon,
  ChatQueueIcon,
  ChatOptionsIcon,
  ChatQueuedMessageIcon,
};
export type { ChatActionIconProps };
