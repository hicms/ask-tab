import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui';
import { getLocale, useT } from '@extension/i18n';
import { diagnostics } from '@extension/shared/lib/diagnostics.js';
import {
  deleteArchivedChats,
  listArchivedChats,
  listAgents,
  setChatArchived,
} from '@extension/storage';
import { liveQuery } from 'dexie';
import { ArchiveIcon, FolderIcon, SearchIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { AgentConfig, DbChat } from '@extension/storage';

const ArchivedChats = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const t = useT();
  const [chats, setChats] = useState<DbChat[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [agentId, setAgentId] = useState('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setLoadError(false);
    const subscription = liveQuery(() =>
      Promise.all([listArchivedChats(), listAgents()]),
    ).subscribe({
      next: ([savedChats, savedAgents]) => {
        setChats(savedChats);
        setAgents(savedAgents);
        setLoading(false);
      },
      error: error => {
        diagnostics.error('Failed to load archived chats', error);
        setLoadError(true);
        setLoading(false);
      },
    });
    return () => subscription.unsubscribe();
  }, [open, retry]);

  const runAction = async (action: () => Promise<void>) => {
    setPending(true);
    try {
      await action();
      setDeleteTarget(null);
    } catch (error) {
      diagnostics.error('Archived chat action failed', error);
      toast.error(t('archive_actionFailed'));
    } finally {
      setPending(false);
    }
  };

  const filtered = chats.filter(
    chat =>
      chat.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
      (source === 'all' || (chat.source || 'web') === source) &&
      (agentId === 'all' || (chat.agentId || 'none') === agentId),
  );
  const agentName = (id: string) =>
    agents.find(agent => agent.id === id)?.name || (id === 'none' ? t('archive_noAgent') : id);
  const groups = new Map<string, DbChat[]>();
  for (const chat of filtered) {
    const key = chat.agentId || 'none';
    const group = groups.get(key);
    if (group) group.push(chat);
    else groups.set(key, [chat]);
  }
  const sourceOptions = [...new Set(chats.map(chat => chat.source || 'web'))];
  const agentOptions = [...new Set(chats.map(chat => chat.agentId || 'none'))];

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!pending) onOpenChange(next);
      }}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[calc(100dvh-1.5rem)] max-h-[52rem] w-[calc(100vw-1.5rem)] max-w-4xl flex-col gap-4 rounded-2xl p-4 pt-10 sm:gap-6 sm:rounded-2xl sm:p-8 sm:pt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <DialogTitle className="text-2xl font-semibold">{t('archive_title')}</DialogTitle>
          <Button
            variant="ghost"
            size="sm"
            className="bg-destructive/10 text-destructive hover:bg-destructive/20 h-8 rounded-xl"
            disabled={loading || loadError || pending || chats.length === 0}
            onClick={() => setDeleteTarget(chats.map(chat => chat.id))}>
            <Trash2Icon />
            {t('common_deleteAll')}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_150px_170px]">
          <div className="relative col-span-2 sm:col-span-1">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute left-3 top-2.5 size-4" />
            <Input
              aria-label={t('archive_search')}
              placeholder={t('archive_search')}
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="h-9 rounded-full pl-9"
              type="search"
            />
          </div>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger aria-label={t('archive_source')} className="h-9 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('archive_allChats')}</SelectItem>
              {sourceOptions.map(value => (
                <SelectItem key={value} value={value}>
                  {value === 'web' ? t('archive_web') : value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger aria-label={t('archive_agent')} className="h-9 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('archive_allAgents')}</SelectItem>
              {agentOptions.map(value => (
                <SelectItem key={value} value={value}>
                  {agentName(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          data-testid="archived-chat-scroll"
          aria-busy={loading || pending}>
          {loading ? (
            <p className="text-muted-foreground py-10 text-center text-sm">{t('common_loading')}</p>
          ) : loadError ? (
            <div role="alert" className="py-10 text-center text-sm">
              <p>{t('archive_loadFailed')}</p>
              <Button variant="ghost" onClick={() => setRetry(value => value + 1)}>
                {t('archive_retry')}
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-3 py-16 text-center text-sm">
              <ArchiveIcon className="size-8" />
              <p>{chats.length ? t('session_noMatching') : t('archive_empty')}</p>
            </div>
          ) : (
            [...groups].map(([id, group]) => (
              <section key={id} className="mb-8" aria-label={agentName(id)}>
                <div className="mb-3 flex items-center gap-2 text-sm">
                  <FolderIcon className="size-4 shrink-0" />
                  <h3 className="min-w-0 flex-1 truncate font-medium">{agentName(id)}</h3>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {t('archive_count', String(group.length))}
                  </span>
                </div>
                <div className="divide-y rounded-2xl border px-4">
                  {group.map(chat => (
                    <div
                      key={chat.id}
                      className="flex items-center gap-2 py-3"
                      data-testid="archived-chat-row">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm" title={chat.title}>
                          {chat.title || t('session_newSession')}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {new Date(chat.updatedAt).toLocaleString(getLocale().replace('_', '-'), {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive shrink-0"
                        aria-label={t('archive_deleteChat', chat.title)}
                        title={t('archive_delete')}
                        disabled={pending}
                        onClick={() => setDeleteTarget([chat.id])}>
                        <Trash2Icon className="size-3.5" />
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 shrink-0 rounded-xl px-2.5 text-xs"
                        disabled={pending}
                        onClick={() => void runAction(() => setChatArchived(chat.id, false))}>
                        {t('archive_restore')}
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
        <AlertDialog
          open={deleteTarget !== null}
          onOpenChange={next => {
            if (!next && !pending) setDeleteTarget(null);
          }}>
          <AlertDialogContent className="max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl sm:rounded-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>{t('archive_delete')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('archive_deleteDescription', String(deleteTarget?.length ?? 0))}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>{t('common_cancel')}</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={event => {
                  event.preventDefault();
                  if (deleteTarget) void runAction(() => deleteArchivedChats(deleteTarget));
                }}>
                {t('common_delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
};

export { ArchivedChats };
