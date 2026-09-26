import { getLocale, useT } from '@extension/i18n';
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@extension/ui';
import { CloudUploadIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

type Status = {
  signedIn: boolean;
  enabled: boolean;
  lastSuccessAt?: number;
  lastError?: string;
};
type History = { id: string; createdAt: number; size: number };
type Preview = {
  id: string;
  createdAt: number;
  agents: number;
  chats: number;
  tasks: number;
};

const send = async <T,>(type: string, data: Record<string, unknown> = {}): Promise<T> => {
  const result = (await chrome.runtime.sendMessage({ type, ...data })) as T & { error?: string };
  if (result.error) throw new Error(result.error);
  return result;
};

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const translations = {
  en: {
    title: 'Account backup',
    description:
      'Back up agents, credentials, chats, schedules, memory and settings to your AskTab account. Each backup is stored as one revision on the server.',
    legacy: 'The separate single-Agent ZIP export is not uploaded.',
    signedOut: 'Open the AskTab side panel and sign in to use account backup.',
    automatic: 'Daily automatic backup',
    backupNow: 'Back up now',
    backupDone: 'Backup completed.',
    history: 'Backup history',
    refresh: 'Refresh history',
    empty: 'No completed backups found.',
    preview: 'Preview restore',
    restore: 'Restore this backup',
    deleteRevision: 'Delete',
    keepLatest: 'Keep latest only',
    cancel: 'Cancel',
    deleteTitle: 'Delete backup history?',
    deleteOneWarning: 'This deletes the selected backup. This cannot be undone.',
    deleteLastWarning:
      'This deletes the only account backup and turns off automatic backup. This cannot be undone.',
    keepLatestWarning:
      'All older backups will be deleted after the latest one is checked. This cannot be undone.',
    deleteDone: 'Backup history deleted.',
    restoreWarning:
      'Restoring replaces current agents, chats, credentials, schedules and settings. Channels will be disabled after restore until you turn them on again.',
    lastSuccess: 'Last successful backup',
    busy: 'Working…',
  },
  zh: {
    title: '账号备份',
    description:
      '将 Agent、凭据、聊天、定时任务、记忆和设置备份到你的 AskTab 账号。每次备份在服务端保存为一个版本。',
    legacy: '原有的单 Agent ZIP 导出不会上传。',
    signedOut: '请打开 AskTab 侧边栏登录后，再使用账号备份。',
    automatic: '每天自动备份',
    backupNow: '立即备份',
    backupDone: '备份完成。',
    history: '备份历史',
    refresh: '刷新历史',
    empty: '暂无已完成的备份。',
    preview: '预览恢复',
    restore: '恢复此备份',
    deleteRevision: '删除',
    keepLatest: '只保留最新备份',
    cancel: '取消',
    deleteTitle: '删除备份历史？',
    deleteOneWarning: '所选备份将被删除。此操作无法撤销。',
    deleteLastWarning: '这会删除唯一的账号备份，并关闭自动备份。此操作无法撤销。',
    keepLatestWarning: '核对最新备份后，所有旧备份将被删除。此操作无法撤销。',
    deleteDone: '已删除备份历史。',
    restoreWarning:
      '恢复会替换当前 Agent、聊天、凭据、定时任务和设置。恢复后通道将先停用，需要手动重新开启。',
    lastSuccess: '最近成功备份',
    busy: '处理中…',
  },
};

const BackupConfig = () => {
  useT();
  const copy = getLocale().startsWith('zh') ? translations.zh : translations.en;
  const [status, setStatus] = useState<Status | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<History | 'older' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const next = await send<Status>('BACKUP_STATUS');
    setStatus(next);
    setHistory(next.signedIn ? (await send<{ history: History[] }>('BACKUP_HISTORY')).history : []);
  }, []);

  useEffect(() => {
    refresh().catch(err => setError(err instanceof Error ? err.message : String(err)));
  }, [refresh]);

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CloudUploadIcon className="size-5" />
          {copy.title}
        </CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-muted-foreground text-xs">{copy.legacy}</p>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-green-700">
            {notice}
          </p>
        )}
        {status?.lastError && <p className="text-sm text-red-600">{status.lastError}</p>}
        {status && !status.signedIn && (
          <p className="text-muted-foreground text-sm">{copy.signedOut}</p>
        )}

        {status?.signedIn && (
          <section className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={status.enabled}
                disabled={busy}
                onChange={e =>
                  act(async () =>
                    setStatus(
                      await send<Status>('BACKUP_SET_ENABLED', { enabled: e.target.checked }),
                    ),
                  )
                }
              />
              {copy.automatic}
            </label>
            <Button
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await send('BACKUP_RUN');
                  await refresh();
                  setNotice(copy.backupDone);
                })
              }>
              {busy ? copy.busy : copy.backupNow}
            </Button>
            {status.lastSuccessAt && (
              <p className="text-muted-foreground text-xs">
                {copy.lastSuccess}: {new Date(status.lastSuccessAt).toLocaleString()}
              </p>
            )}
          </section>
        )}

        {status?.signedIn && (
          <section className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{copy.history}</h3>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  disabled={busy || history.length < 2}
                  onClick={() => setDeleteTarget('older')}>
                  {copy.keepLatest}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => act(refresh)}>
                  {copy.refresh}
                </Button>
              </div>
            </div>
            {history.length === 0 && <p className="text-muted-foreground text-sm">{copy.empty}</p>}
            <ul className="space-y-2">
              {history.map(item => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
                  <span className="truncate" title={item.id}>
                    {new Date(item.createdAt).toLocaleString()} · {formatSize(item.size)}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        act(async () =>
                          setPreview({
                            id: item.id,
                            ...(await send<Omit<Preview, 'id'>>('BACKUP_RESTORE_PREVIEW', {
                              id: item.id,
                            })),
                          }),
                        )
                      }>
                      {copy.preview}
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => setDeleteTarget(item)}>
                      {copy.deleteRevision}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {preview && (
              <div className="space-y-3 rounded border p-3">
                <p className="text-sm">
                  {new Date(preview.createdAt).toLocaleString()} · Agent {preview.agents} · Chats{' '}
                  {preview.chats} · Tasks {preview.tasks}
                </p>
                <p className="text-sm text-red-600">{copy.restoreWarning}</p>
                <div className="flex items-center gap-2">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await send('BACKUP_RESTORE', { id: preview.id });
                        setPreview(null);
                      })
                    }>
                    {copy.restore}
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => setPreview(null)}>
                    {copy.cancel}
                  </Button>
                </div>
              </div>
            )}
            <AlertDialog
              onOpenChange={open => !open && setDeleteTarget(null)}
              open={deleteTarget !== null}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{copy.deleteTitle}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {deleteTarget && deleteTarget !== 'older' && (
                      <span className="mb-2 block font-medium">
                        {new Date(deleteTarget.createdAt).toLocaleString()} ·{' '}
                        {formatSize(deleteTarget.size)}
                      </span>
                    )}
                    {deleteTarget === 'older'
                      ? copy.keepLatestWarning
                      : history.length === 1
                        ? copy.deleteLastWarning
                        : copy.deleteOneWarning}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={busy}
                    onClick={() => {
                      if (!deleteTarget || history.length === 0) return;
                      const target = deleteTarget;
                      void act(async () => {
                        await send(
                          target === 'older' ? 'BACKUP_KEEP_LATEST' : 'BACKUP_DELETE_REVISION',
                          { id: target === 'older' ? history[0].id : target.id },
                        );
                        setPreview(null);
                        setDeleteTarget(null);
                        await refresh();
                        setNotice(copy.deleteDone);
                      });
                    }}>
                    {copy.deleteRevision}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </section>
        )}
      </CardContent>
    </Card>
  );
};

export { BackupConfig };
