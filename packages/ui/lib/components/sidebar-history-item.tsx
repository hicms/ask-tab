import { MoreHorizontalIcon, TrashIcon } from './icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui';
import { memo } from 'react';
import type { Chat } from '@extension/shared';

const PureChatItem = ({
  chat,
  isActive,
  onDelete,
  onSelect,
}: {
  chat: Chat;
  isActive: boolean;
  onDelete: (chatId: string) => void;
  onSelect: (chat: Chat) => void;
}) => (
  <div
    className={`hover:bg-muted group flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
      isActive ? 'bg-muted' : ''
    }`}>
    <button
      className="min-w-0 flex-1 truncate text-left"
      onClick={() => onSelect(chat)}
      type="button">
      <span>{chat.title || 'New Chat'}</span>
    </button>

    <DropdownMenu modal={true}>
      <DropdownMenuTrigger asChild>
        <button
          className="hover:bg-muted-foreground/10 shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
          type="button">
          <MoreHorizontalIcon />
          <span className="sr-only">More</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" side="bottom">
        <DropdownMenuItem
          className="text-destructive focus:bg-destructive/15 focus:text-destructive cursor-pointer dark:text-red-500"
          onSelect={() => onDelete(chat.id)}>
          <TrashIcon />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

export const ChatItem = memo(PureChatItem, (prevProps, nextProps) => {
  if (prevProps.isActive !== nextProps.isActive) {
    return false;
  }
  return true;
});
