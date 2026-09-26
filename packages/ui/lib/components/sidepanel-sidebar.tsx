import { PlusIcon, CrossIcon } from './icons';
import { SessionList } from './session-list';
import { Button } from './ui';
import { cn } from '../utils';
import { useT } from '@extension/i18n';
import { useCallback, useRef } from 'react';
import type { Chat } from '@extension/shared';

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 288; // w-72

/** Clamp a width value to the sidebar's min/max bounds */
const clampSidebarWidth = (w: number): number =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, w));

type ChatSidebarProps = {
  isOpen: boolean;
  onClose: () => void;
  onNewChat: () => void;
  onSelectChat: (chat: Chat) => void;
  currentChatId: string;
  onClearAll?: () => void;
  mode?: 'push' | 'overlay';
  width?: number;
  onWidthChange?: (width: number) => void;
  agentId?: string;
};

const ChatSidebar = ({
  isOpen,
  onClose,
  onNewChat,
  onSelectChat,
  currentChatId,
  onClearAll,
  mode = 'overlay',
  width = SIDEBAR_DEFAULT_WIDTH,
  onWidthChange,
  agentId,
}: ChatSidebarProps) => {
  const t = useT();
  const isDragging = useRef(false);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (mode !== 'push' || !onWidthChange) return;
      e.preventDefault();
      isDragging.current = true;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDragging.current) return;
        const newWidth = clampSidebarWidth(moveEvent.clientX);
        onWidthChange(newWidth);
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [mode, onWidthChange],
  );

  // In push mode, selecting a chat doesn't close the sidebar
  const handleSelectChatItem = useCallback(
    (chat: Chat) => {
      onSelectChat(chat);
      if (mode === 'overlay') {
        onClose();
      }
    },
    [onSelectChat, onClose, mode],
  );

  const handleNewChatClick = useCallback(() => {
    onNewChat();
    if (mode === 'overlay') {
      onClose();
    }
  }, [onNewChat, onClose, mode]);

  const header = (
    <div className="flex items-center justify-between border-b px-3 py-2">
      <span className="text-xs font-medium">{t('tab_sessions')}</span>
      <div className="flex items-center gap-1">
        <Button
          onClick={handleNewChatClick}
          size="sm"
          title={t('session_newSession')}
          variant="ghost">
          <PlusIcon />
        </Button>
        <Button onClick={onClose} size="sm" variant="ghost">
          <CrossIcon size={16} />
        </Button>
      </div>
    </div>
  );

  // Push mode: render as a flex child that pushes content aside
  if (mode === 'push') {
    if (!isOpen) return null;

    return (
      <div
        className="bg-background relative flex flex-shrink-0 flex-col border-r"
        data-testid="sidebar-push"
        style={{ width }}>
        {header}
        <SessionList
          agentId={agentId}
          currentChatId={currentChatId}
          isVisible={isOpen}
          onClearAll={onClearAll}
          onSelectChat={handleSelectChatItem}
        />
        {/* Resize handle */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          className="hover:bg-primary/20 active:bg-primary/30 absolute inset-y-0 right-0 w-1 cursor-col-resize"
          data-testid="sidebar-resize-handle"
          onMouseDown={handleResizeStart}
        />
      </div>
    );
  }

  // Overlay mode (default): fixed position with backdrop
  return (
    <>
      {/* Overlay backdrop */}
      {isOpen && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} role="presentation" />
      )}

      {/* Sidebar panel */}
      <div
        className={cn(
          'bg-background fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r transition-transform duration-200',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}>
        {header}
        <SessionList
          agentId={agentId}
          currentChatId={currentChatId}
          isVisible={isOpen}
          onClearAll={onClearAll}
          onSelectChat={handleSelectChatItem}
        />
      </div>
    </>
  );
};

export {
  ChatSidebar,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  clampSidebarWidth,
};
export type { ChatSidebarProps };
