import { MessageIcon } from './icons';
import { RunningChatIndicator } from './running-chat-indicator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  ScrollArea,
  Button,
} from './ui';
import { groupChatsByDate } from '../group-chats-by-date';
import { useChatArchive } from '../hooks/use-chat-archive';
import { cn } from '../utils';
import { useT } from '@extension/i18n';
import { useRunningChats } from '@extension/shared';
import { diagnostics } from '@extension/shared/lib/diagnostics.js';
import {
  listChats,
  clearAllChatHistory,
  searchChats,
  lastActiveSessionStorage,
  updateChatTitle,
} from '@extension/storage';
import { liveQuery } from 'dexie';
import { ArchiveIcon, EllipsisVertical, PencilIcon, SearchIcon, SendIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Chat } from '@extension/shared';

type SessionListProps = {
  agentId?: string;
  currentChatId: string;
  onSelectChat: (chat: Chat) => void;
  onClearAll?: () => void;
  isVisible: boolean;
  showSearch?: boolean;
};

const SessionSection = ({
  title,
  chats,
  currentChatId,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
  runningChatIds,
}: {
  title: string;
  chats: Chat[];
  currentChatId: string;
  onSelectChat: (chat: Chat) => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat: (chatId: string, newTitle: string) => void;
  runningChatIds: ReadonlySet<string>;
}) => {
  const t = useT();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const commitRename = (chatId: string, originalTitle: string) => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== originalTitle) {
      onRenameChat(chatId, trimmed);
    }
    setRenamingId(null);
  };

  if (chats.length === 0) return null;

  return (
    <div className="chat-history-section">
      <h3 className="chat-history-date flex items-center gap-3 text-xs font-semibold">{title}</h3>
      {chats.map(chat => {
        const displayTitle = chat.title || t('session_newSession');
        const isRenaming = renamingId === chat.id;
        const isActive = chat.id === currentChatId;

        return (
          <div
            className={cn(
              'chat-history-row group flex min-w-0 items-center gap-2 text-sm transition-colors',
              isActive && 'chat-history-row-active',
            )}
            key={chat.id}>
            {chat.source === 'telegram' && (
              <SendIcon aria-hidden className="chat-history-source size-4 shrink-0" />
            )}
            {isRenaming ? (
              <input
                ref={renameInputRef}
                className="chat-history-rename min-w-0 flex-1 rounded border px-1.5 py-0.5 text-sm outline-none"
                onBlur={() => commitRename(chat.id, displayTitle)}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename(chat.id, displayTitle);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setRenamingId(null);
                  }
                }}
                type="text"
                value={renameValue}
              />
            ) : (
              <>
                <button
                  aria-current={isActive ? 'page' : undefined}
                  className="chat-history-select min-w-0 flex-1 truncate text-left"
                  onClick={() => onSelectChat(chat)}
                  onDoubleClick={() => {
                    setRenameValue(displayTitle);
                    setRenamingId(chat.id);
                  }}
                  title={displayTitle}
                  type="button">
                  {displayTitle}
                </button>
                {runningChatIds.has(chat.id) && <RunningChatIndicator />}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label={t('archive_chatMenu', displayTitle)}
                      className="chat-history-more flex shrink-0 items-center justify-center transition-colors"
                      onClick={e => e.stopPropagation()}
                      type="button">
                      <EllipsisVertical aria-hidden size={18} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="chat-history-menu" sideOffset={4}>
                    <DropdownMenuItem
                      onClick={() => {
                        setRenameValue(displayTitle);
                        setRenamingId(chat.id);
                      }}>
                      <PencilIcon aria-hidden size={18} />
                      <span>{t('session_rename')}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onDeleteChat(chat.id)}>
                      <ArchiveIcon aria-hidden size={18} />
                      <span>{t('archive_action')}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};

const SessionList = ({
  agentId,
  currentChatId,
  onSelectChat,
  onClearAll,
  isVisible,
  showSearch = true,
}: SessionListProps) => {
  const t = useT();
  const [chats, setChats] = useState<Chat[]>([]);
  const runningChatIds = useRunningChats(isVisible);
  const [searchQuery, setSearchQuery] = useState('');
  const { archive, openArchive, archiveDialog } = useChatArchive();
  const [showClearAll, setShowClearAll] = useState(false);

  const loadChats = useCallback(async () => {
    const result = searchQuery
      ? await searchChats(searchQuery, agentId)
      : await listChats(100, 0, agentId, 'active');
    return result;
  }, [searchQuery, agentId]);

  useEffect(() => {
    if (!isVisible) return;
    const subscription = liveQuery(loadChats).subscribe({
      next: setChats,
      error: diagnostics.error,
    });
    return () => subscription.unsubscribe();
  }, [isVisible, loadChats]);

  const handleRename = useCallback(async (chatId: string, newTitle: string) => {
    await updateChatTitle(chatId, newTitle);
  }, []);

  const handleClearAll = useCallback(async () => {
    await clearAllChatHistory();
    await lastActiveSessionStorage.set('');
    setShowClearAll(false);
    setChats([]);
    if (onClearAll) onClearAll();
  }, [onClearAll]);

  const grouped = groupChatsByDate(chats);

  return (
    <>
      {/* Search */}
      {showSearch && (
        <div className="chat-history-search shrink-0">
          <div className="relative">
            <SearchIcon
              aria-hidden
              className="chat-history-search-icon pointer-events-none absolute size-[18px]"
            />
            <Input
              aria-label={t('session_searchPlaceholder')}
              className="chat-history-search-input"
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('session_searchPlaceholder')}
              type="search"
              value={searchQuery}
            />
          </div>
        </div>
      )}

      {/* Session list */}
      <ScrollArea className="chat-history-scroll min-h-0 flex-1 [&>[data-radix-scroll-area-viewport]>div]:!block">
        <div className="chat-history-list">
          {chats.length === 0 && (
            <div className="chat-history-empty flex flex-col items-center gap-3 px-3 py-8 text-center text-sm">
              <span className="chat-history-empty-icon flex size-12 items-center justify-center rounded-full">
                <MessageIcon size={32} />
              </span>
              <span>{searchQuery ? t('session_noMatching') : t('session_noSessions')}</span>
            </div>
          )}
          <SessionSection
            chats={grouped.today}
            runningChatIds={runningChatIds}
            currentChatId={currentChatId}
            onDeleteChat={archive}
            onRenameChat={handleRename}
            onSelectChat={onSelectChat}
            title={t('session_today')}
          />
          <SessionSection
            chats={grouped.yesterday}
            runningChatIds={runningChatIds}
            currentChatId={currentChatId}
            onDeleteChat={archive}
            onRenameChat={handleRename}
            onSelectChat={onSelectChat}
            title={t('session_yesterday')}
          />
          <SessionSection
            chats={grouped.lastWeek}
            runningChatIds={runningChatIds}
            currentChatId={currentChatId}
            onDeleteChat={archive}
            onRenameChat={handleRename}
            onSelectChat={onSelectChat}
            title={t('session_last7Days')}
          />
          <SessionSection
            chats={grouped.lastMonth}
            runningChatIds={runningChatIds}
            currentChatId={currentChatId}
            onDeleteChat={archive}
            onRenameChat={handleRename}
            onSelectChat={onSelectChat}
            title={t('session_last30Days')}
          />
          <SessionSection
            chats={grouped.older}
            runningChatIds={runningChatIds}
            currentChatId={currentChatId}
            onDeleteChat={archive}
            onRenameChat={handleRename}
            onSelectChat={onSelectChat}
            title={t('session_older')}
          />
        </div>
      </ScrollArea>

      <div className="chat-history-footer shrink-0 border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          className="chat-history-archive w-full justify-start"
          onClick={openArchive}>
          <ArchiveIcon aria-hidden />
          {t('archive_title')}
        </Button>
      </div>

      {archiveDialog}
      {/* Clear all confirmation */}
      <AlertDialog onOpenChange={setShowClearAll} open={showClearAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('session_deleteAllTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('session_deleteAllDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearAll}>{t('common_deleteAll')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export { SessionList };
export type { SessionListProps };
