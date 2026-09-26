import { sendChannelMessage, STATUS_DOT_COLOR, useChannelState } from './use-channel-state';
import { useT } from '@extension/i18n';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Badge,
} from '@extension/ui';
import {
  SendIcon,
  PlusIcon,
  XIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  LoaderIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChannelStatus, ChannelView } from './use-channel-state';
import type { MessageKeyType } from '@extension/i18n';

const STATUS_LABEL: Record<ChannelStatus, MessageKeyType> = {
  disabled: 'common_disabled',
  connecting: 'channels_statusConnecting',
  pairing: 'channels_statusConnecting',
  connected: 'channels_statusConnected',
  logged_out: 'channels_statusError',
  error: 'channels_statusError',
};

const TelegramConfig = () => {
  const t = useT();
  const { config, view, setView, signedIn, loadError, saveConfig } = useChannelState('telegram');
  const [botToken, setBotToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newUserId, setNewUserId] = useState('');
  const [saved, setSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    },
    [],
  );

  const showSaved = useCallback(() => {
    setSaved(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
  }, []);

  const runAction = useCallback(async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleConnect = useCallback(
    () =>
      runAction(async () => {
        const result = await sendChannelMessage<{ view: ChannelView }>('CHANNEL_CONNECT', {
          channelId: 'telegram',
          botToken: botToken.trim(),
        });
        setView(result.view);
        setBotToken('');
      }, t('telegram_connectFailed')),
    [botToken, runAction, setView, t],
  );

  const handleToggle = useCallback(() => {
    if (!view) return;
    void runAction(async () => {
      const result = await sendChannelMessage<{ view: ChannelView }>('CHANNEL_SET_ENABLED', {
        channelId: 'telegram',
        enabled: !view.enabled,
      });
      setView(result.view);
    }, t('telegram_toggleFailed'));
  }, [runAction, setView, t, view]);

  const handleRemove = useCallback(
    () =>
      runAction(async () => {
        await sendChannelMessage('CHANNEL_REMOVE', { channelId: 'telegram' });
        setView(null);
      }, t('telegram_saveFailed')),
    [runAction, setView, t],
  );

  const updateAllowedSenders = useCallback(
    async (allowedSenderIds: string[]) => {
      if (!config) return;
      try {
        await saveConfig({ ...config, allowedSenderIds });
        showSaved();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : t('telegram_saveFailed'));
      }
    },
    [config, saveConfig, showSaved, t],
  );

  const handleAddUserId = useCallback(() => {
    const trimmed = newUserId.trim();
    if (!config || !/^\d+$/.test(trimmed) || config.allowedSenderIds.includes(trimmed)) return;
    setNewUserId('');
    void updateAllowedSenders([...config.allowedSenderIds, trimmed]);
  }, [config, newUserId, updateAllowedSenders]);

  if (loadError) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-red-600 dark:text-red-400">
            {t('telegram_loadFailed')}: {loadError}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!config) return null;

  const statusText = view ? t(STATUS_LABEL[view.status]) : t('channels_statusNotConnected');

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <SendIcon className="h-5 w-5 text-blue-500" />
          <CardTitle>{t('telegram_title')}</CardTitle>
          <div
            data-testid="tg-status-dot"
            className={`h-2.5 w-2.5 rounded-full ${view ? STATUS_DOT_COLOR[view.status] : 'bg-gray-400'}`}
            title={statusText}
          />
        </div>
        <CardDescription>{t('telegram_description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!signedIn && (
          <p
            data-testid="tg-sign-in-required"
            className="text-sm text-amber-600 dark:text-amber-400">
            {t('channels_signInRequired')}
          </p>
        )}

        {view && (
          <div className="flex items-center justify-between gap-2">
            <div className="space-y-0.5">
              <Label>{t('telegram_enableBot')}</Label>
              <p data-testid="tg-status-text" className="text-muted-foreground text-xs">
                {view.identity && (
                  <span data-testid="tg-bot-identity" className="mr-1 font-medium">
                    {view.identity}
                  </span>
                )}
                {statusText}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                data-testid="tg-enable-toggle"
                onClick={handleToggle}
                disabled={busy}
                variant={view.enabled ? 'default' : 'outline'}
                size="sm">
                {view.enabled ? t('common_enabled') : t('common_disabled')}
              </Button>
              <Button
                data-testid="tg-remove-btn"
                onClick={handleRemove}
                disabled={busy}
                variant="outline"
                size="sm">
                {t('actions_remove')}
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="tg-token">{t('telegram_botToken')}</Label>
          <p className="text-muted-foreground text-xs">{t('telegram_tokenHint')}</p>
          <div className="flex gap-2">
            <Input
              id="tg-token"
              data-testid="tg-token-input"
              type="password"
              placeholder="123456:ABC-DEF..."
              value={botToken}
              onChange={e => {
                setBotToken(e.target.value);
                setActionError(null);
              }}
              onKeyDown={e => e.key === 'Enter' && botToken.trim() && !busy && handleConnect()}
              className="flex-1"
            />
            <Button
              data-testid="tg-connect-btn"
              onClick={handleConnect}
              disabled={!signedIn || !botToken.trim() || busy}
              variant="outline"
              size="sm">
              {busy ? <LoaderIcon className="h-4 w-4 animate-spin" /> : t('telegram_connect')}
            </Button>
          </div>
          {actionError && (
            <p
              data-testid="tg-action-error"
              className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400">
              <AlertCircleIcon className="h-3.5 w-3.5" />
              {actionError}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>{t('telegram_allowedUserIds')}</Label>
          <p className="text-muted-foreground text-xs">{t('telegram_userIdsHint')}</p>
          <div className="flex gap-2">
            <Input
              data-testid="tg-user-id-input"
              placeholder="e.g. 123456789"
              value={newUserId}
              onChange={e => setNewUserId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddUserId()}
              className="flex-1"
            />
            <Button
              data-testid="tg-add-user-btn"
              onClick={handleAddUserId}
              disabled={!/^\d+$/.test(newUserId.trim())}
              variant="outline"
              size="sm">
              <PlusIcon className="h-4 w-4" />
            </Button>
          </div>
          {config.allowedSenderIds.length > 0 ? (
            <div data-testid="tg-user-badges" className="flex flex-wrap gap-1.5 pt-1">
              {config.allowedSenderIds.map(id => (
                <Badge key={id} variant="secondary" className="gap-1">
                  {id}
                  <button
                    onClick={() =>
                      void updateAllowedSenders(config.allowedSenderIds.filter(s => s !== id))
                    }
                    className="hover:text-destructive ml-0.5"
                    type="button">
                    <XIcon className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : (
            <p
              data-testid="tg-no-users-warning"
              className="text-xs text-amber-600 dark:text-amber-400">
              {t('telegram_noUsers')}
            </p>
          )}
        </div>

        {view?.lastError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            <strong>{t('channels_statusError')}:</strong> {view.lastError}
          </div>
        )}

        {saved && (
          <div className="flex justify-end">
            <span
              data-testid="tg-saved-indicator"
              className="text-muted-foreground flex items-center gap-1 text-xs">
              <CheckCircle2Icon className="size-3" /> {t('common_saved')}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export { TelegramConfig };
