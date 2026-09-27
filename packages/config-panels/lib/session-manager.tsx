import { useT } from '@extension/i18n';
import { openSidePanel } from '@extension/shared';
import { diagnostics } from '@extension/shared/lib/diagnostics.js';
import { listChats, searchChats, lastActiveSessionStorage } from '@extension/storage';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Input,
  useChatArchive,
} from '@extension/ui';
import { liveQuery } from 'dexie';
import { ArchiveIcon, MessagesSquareIcon, SearchIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface SessionRow {
  id: string;
  title: string;
  source?: string;
  agentId?: string;
  model?: string;
  totalTokens: number;
  updatedAt: number;
}

const formatTokenCount = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const formatDate = (ts: number): string => {
  const now = Date.now();
  const diff = now - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const toRows = (
  chats: {
    id: string;
    title: string;
    source?: string;
    agentId?: string;
    model?: string;
    totalTokens?: number;
    updatedAt: number;
  }[],
): SessionRow[] =>
  chats
    .map(c => ({
      id: c.id,
      title: c.title,
      source: c.source,
      agentId: c.agentId,
      model: c.model,
      totalTokens: c.totalTokens ?? 0,
      updatedAt: c.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);

const SessionManager = ({ onOpenSession }: { onOpenSession?: (chatId: string) => void }) => {
  const t = useT();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { archive, openArchive, archiveDialog } = useChatArchive();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSessionId, setActiveSessionId] = useState('');

  useEffect(() => {
    lastActiveSessionStorage.get().then(setActiveSessionId);
    const unsub = lastActiveSessionStorage.subscribe(() => {
      lastActiveSessionStorage.get().then(setActiveSessionId);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const subscription = liveQuery(() =>
      searchQuery.trim() ? searchChats(searchQuery.trim()) : listChats(500, 0, undefined, 'active'),
    ).subscribe({
      next: chats => {
        setSessions(toRows(chats));
        setLoading(false);
      },
      error: error => {
        diagnostics.error('Failed to load sessions', error);
        setLoading(false);
      },
    });
    return () => subscription.unsubscribe();
  }, [searchQuery]);

  const handleClick = useCallback(async (chatId: string) => {
    await lastActiveSessionStorage.set(chatId);
  }, []);

  const handleDoubleClick = useCallback(
    async (chatId: string) => {
      if (onOpenSession) {
        onOpenSession(chatId);
      } else {
        await lastActiveSessionStorage.set(chatId);
        await openSidePanel();
      }
    },
    [onOpenSession],
  );

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <MessagesSquareIcon className="size-5" />
            {t('sessionMgr_title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{t('common_loading')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <MessagesSquareIcon className="size-5" />
            {t('sessionMgr_title')}
            <Button variant="ghost" size="sm" className="ml-auto text-xs" onClick={openArchive}>
              <ArchiveIcon className="size-4" />
              {t('archive_title')}
            </Button>
          </CardTitle>
          <CardDescription>
            {sessions.length} session{sessions.length !== 1 ? 's' : ''}
            {searchQuery.trim() ? ` matching "${searchQuery.trim()}"` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative mb-3">
            <SearchIcon className="text-muted-foreground absolute left-2.5 top-2.5 size-4" />
            <Input
              placeholder={t('sessionMgr_searchPlaceholder')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          {sessions.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {searchQuery.trim() ? t('sessionMgr_noMatching') : t('sessionMgr_noSessions')}
            </p>
          ) : (
            <div className="divide-y rounded-md border">
              {sessions.map(s => (
                <div
                  className={`hover:bg-muted/50 flex cursor-pointer select-none items-center gap-3 px-3 py-2 transition-colors${s.id === activeSessionId ? 'bg-muted' : ''}`}
                  key={s.id}
                  title={
                    onOpenSession
                      ? t('sessionMgr_clickToSelect')
                      : t('sessionMgr_clickToSelectSidePanel')
                  }
                  onClick={() => handleClick(s.id)}
                  onDoubleClick={() => handleDoubleClick(s.id)}
                  onKeyDown={e => {
                    // Ignore keys bubbling from the nested delete button.
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleClick(s.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.title}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {s.source && (
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                          {s.source}
                        </Badge>
                      )}
                      {s.agentId && (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          {s.agentId}
                        </Badge>
                      )}
                      {s.model && <span className="text-muted-foreground text-xs">{s.model}</span>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs">
                    <span className="font-mono font-medium">{formatTokenCount(s.totalTokens)}</span>
                    <p className="text-muted-foreground">{formatDate(s.updatedAt)}</p>
                  </div>
                  <Button
                    aria-label={t('archive_archiveChat', s.title)}
                    title={t('archive_action')}
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive size-7 shrink-0"
                    onClick={e => {
                      e.stopPropagation();
                      void archive(s.id);
                    }}>
                    <ArchiveIcon className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {archiveDialog}
    </>
  );
};

export { SessionManager };
