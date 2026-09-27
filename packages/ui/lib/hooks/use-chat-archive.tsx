import { ArchivedChats } from '../components/archived-chats';
import { Button } from '../components/ui/button';
import { useT } from '@extension/i18n';
import { diagnostics } from '@extension/shared/lib/diagnostics.js';
import { getChat, setChatArchived } from '@extension/storage';
import { liveQuery } from 'dexie';
import { ArchiveIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

const ArchiveToast = ({
  chatId,
  toastId,
  onView,
}: {
  chatId: string;
  toastId: string | number;
  onView: () => void;
}) => {
  const t = useT();
  const [pending, setPending] = useState(false);
  const undo = async () => {
    setPending(true);
    try {
      await setChatArchived(chatId, false);
      toast.dismiss(toastId);
    } catch (error) {
      diagnostics.error('Failed to undo chat archive', error);
      toast.error(t('archive_actionFailed'));
      setPending(false);
    }
  };
  return (
    <div
      className="bg-background text-foreground flex w-fit max-w-full items-center gap-2 rounded-2xl border px-3 py-2.5 shadow-lg"
      role="status">
      <ArchiveIcon className="size-4 shrink-0" />
      <span className="whitespace-nowrap text-sm">{t('archive_title')}</span>
      <Button
        variant="secondary"
        size="sm"
        className="h-6 rounded-full px-2.5 text-xs"
        onClick={() => {
          toast.dismiss(toastId);
          onView();
        }}>
        {t('archive_view')}
      </Button>
      <Button
        size="sm"
        className="h-6 rounded-full px-2.5 text-xs"
        disabled={pending}
        onClick={() => void undo()}>
        {t('archive_undo')}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6 shrink-0"
        aria-label={t('archive_close')}
        onClick={() => toast.dismiss(toastId)}>
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
};

const useChatArchive = () => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const pendingIds = useRef(new Set<string>());
  const toastIds = useRef(new Set<string | number>());
  useEffect(() => {
    const ids = toastIds.current;
    return () => {
      ids.forEach(id => toast.dismiss(id));
    };
  }, []);
  const openArchive = () => setOpen(true);
  const archive = async (chatId: string) => {
    if (pendingIds.current.has(chatId)) return;
    pendingIds.current.add(chatId);
    try {
      await setChatArchived(chatId, true);
      const id = toast.custom(
        toastId => <ArchiveToast chatId={chatId} toastId={toastId} onView={openArchive} />,
        {
          duration: 10000,
          position: 'top-center',
          className: 'w-full',
          style: {
            display: 'flex',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            boxShadow: 'none',
          },
        },
      );
      toastIds.current.add(id);
    } catch (error) {
      diagnostics.error('Failed to archive chat', error);
      toast.error(t('archive_actionFailed'));
    } finally {
      pendingIds.current.delete(chatId);
    }
  };
  return {
    archive,
    openArchive,
    archiveDialog: <ArchivedChats open={open} onOpenChange={setOpen} />,
  };
};

/** Keep every open chat surface from continuing a session archived on another page. */
const useArchivedSession = (chatId: string, onNewChat: () => void) => {
  useEffect(() => {
    if (!chatId) return;
    const subscription = liveQuery(() => getChat(chatId)).subscribe({
      next: chat => {
        if (chat?.archivedAt !== undefined) onNewChat();
      },
      error: error => diagnostics.error('Failed to observe chat archive state', error),
    });
    return () => subscription.unsubscribe();
  }, [chatId, onNewChat]);
};

export { useChatArchive, useArchivedSession };
