import { sendChannelMessage, STATUS_DOT_COLOR, useChannelState } from './use-channel-state';
import { useT } from '@extension/i18n';
import { diagnostics } from '@extension/shared/lib/diagnostics.js';
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
  MessageCircleIcon,
  PlusIcon,
  XIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  QrCodeIcon,
} from 'lucide-react';
import { toCanvas } from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChannelStatus, ChannelView } from './use-channel-state';
import type { MessageKeyType } from '@extension/i18n';

interface Direction {
  acceptFromMe: boolean;
  acceptFromOthers: boolean;
}

const STATUS_LABEL: Record<ChannelStatus, MessageKeyType> = {
  disabled: 'common_disabled',
  connecting: 'channels_statusConnecting',
  pairing: 'whatsapp_connecting',
  connected: 'whatsapp_connected',
  logged_out: 'whatsapp_loggedOut',
  error: 'channels_statusError',
};

/** The server runs a WhatsApp session for this account right now. */
const isLive = (view: ChannelView | null): boolean =>
  !!view &&
  view.enabled &&
  (view.status === 'connecting' || view.status === 'pairing' || view.status === 'connected');

/** 12345@s.whatsapp.net → +12345 */
const formatJid = (jid: string): string => `+${jid.split('@')[0]}`;

const WhatsAppConfig = () => {
  const t = useT();
  const { config, view, setView, signedIn, loadError, saveConfig } = useChannelState('whatsapp');
  const [direction, setDirection] = useState<Direction>({
    acceptFromMe: true,
    acceptFromOthers: false,
  });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newUserId, setNewUserId] = useState('');
  const [saved, setSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const serverAcceptFromMe = view?.acceptFromMe;
  const serverAcceptFromOthers = view?.acceptFromOthers;
  useEffect(() => {
    if (serverAcceptFromMe === undefined || serverAcceptFromOthers === undefined) return;
    setDirection({ acceptFromMe: serverAcceptFromMe, acceptFromOthers: serverAcceptFromOthers });
  }, [serverAcceptFromMe, serverAcceptFromOthers]);

  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    },
    [],
  );

  const qr = view?.status === 'pairing' ? view.qr : null;
  useEffect(() => {
    if (!qr || !canvasRef.current) return;
    toCanvas(canvasRef.current, qr, {
      width: 256,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    }).catch((err: unknown) => diagnostics.error('QR render failed:', err));
  }, [qr]);

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

  const connect = useCallback(async (next: Direction) => {
    const result = await sendChannelMessage<{ view: ChannelView }>('CHANNEL_CONNECT', {
      channelId: 'whatsapp',
      ...next,
    });
    return result.view;
  }, []);

  const handleConnect = useCallback(
    () =>
      runAction(async () => {
        // A disabled but still linked account resumes its session; anything else links anew.
        if (view && !view.enabled && view.identity) {
          let next = (
            await sendChannelMessage<{ view: ChannelView }>('CHANNEL_SET_ENABLED', {
              channelId: 'whatsapp',
              enabled: true,
            })
          ).view;
          if (
            next.acceptFromMe !== direction.acceptFromMe ||
            next.acceptFromOthers !== direction.acceptFromOthers
          ) {
            next = await connect(direction);
          }
          setView(next);
          return;
        }
        setView(await connect(direction));
      }, t('whatsapp_connectionFailed')),
    [connect, direction, runAction, setView, t, view],
  );

  const handleDisconnect = useCallback(
    () =>
      runAction(async () => {
        const result = await sendChannelMessage<{ view: ChannelView }>('CHANNEL_SET_ENABLED', {
          channelId: 'whatsapp',
          enabled: false,
        });
        setView(result.view);
      }, t('whatsapp_disconnectFailed')),
    [runAction, setView, t],
  );

  const handleUnlink = useCallback(
    () =>
      runAction(async () => {
        await sendChannelMessage('CHANNEL_REMOVE', { channelId: 'whatsapp' });
        setView(null);
      }, t('whatsapp_disconnectFailed')),
    [runAction, setView, t],
  );

  const handleDirectionChange = useCallback(
    (patch: Partial<Direction>) => {
      const next = { ...direction, ...patch };
      setDirection(next);
      // Only a running session accepts direction changes; otherwise they apply on connect.
      if (!isLive(view)) return;
      void runAction(async () => {
        setView(await connect(next));
        showSaved();
      }, t('whatsapp_saveFailed'));
    },
    [connect, direction, runAction, setView, showSaved, t, view],
  );

  const updateAllowedSenders = useCallback(
    async (allowedSenderIds: string[]) => {
      if (!config) return;
      try {
        await saveConfig({ ...config, allowedSenderIds });
        showSaved();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : t('whatsapp_saveFailed'));
      }
    },
    [config, saveConfig, showSaved, t],
  );

  const handleAddUserId = useCallback(() => {
    const trimmed = newUserId.trim();
    if (!config || !/^\+?\d{7,15}$/.test(trimmed)) return;
    const jid = `${trimmed.replace(/^\+/, '')}@s.whatsapp.net`;
    if (config.allowedSenderIds.includes(jid)) return;
    setNewUserId('');
    void updateAllowedSenders([...config.allowedSenderIds, jid]);
  }, [config, newUserId, updateAllowedSenders]);

  if (loadError) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-red-600 dark:text-red-400">
            {t('whatsapp_loadFailed')}: {loadError}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!config) return null;

  const live = isLive(view);
  const statusText = view ? t(STATUS_LABEL[view.status]) : t('channels_statusNotConnected');

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageCircleIcon className="h-5 w-5 text-green-500" />
          <CardTitle>{t('whatsapp_title')}</CardTitle>
          <div
            data-testid="wa-status-dot"
            className={`h-2.5 w-2.5 rounded-full ${view ? STATUS_DOT_COLOR[view.status] : 'bg-gray-400'}`}
            title={statusText}
          />
        </div>
        <CardDescription>{t('whatsapp_description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!signedIn && (
          <p
            data-testid="wa-sign-in-required"
            className="text-sm text-amber-600 dark:text-amber-400">
            {t('channels_signInRequired')}
          </p>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="space-y-0.5">
            <Label>{t('whatsapp_connection')}</Label>
            <p data-testid="wa-status-text" className="text-muted-foreground text-xs">
              {view?.identity && <span className="mr-1 font-medium">{view.identity}</span>}
              {statusText}
            </p>
          </div>
          <div className="flex gap-2">
            {live ? (
              <Button
                data-testid="wa-disconnect-btn"
                onClick={handleDisconnect}
                disabled={busy}
                variant="outline"
                size="sm">
                {t('whatsapp_disconnect')}
              </Button>
            ) : (
              <Button
                data-testid="wa-connect-btn"
                onClick={handleConnect}
                disabled={!signedIn || busy}
                variant="default"
                size="sm">
                {t('whatsapp_connect')}
              </Button>
            )}
            {view && (
              <Button
                data-testid="wa-unlink-btn"
                onClick={handleUnlink}
                disabled={busy}
                variant="outline"
                size="sm">
                {t('whatsapp_unlink')}
              </Button>
            )}
          </div>
        </div>

        {qr && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <QrCodeIcon className="h-4 w-4" />
              {t('whatsapp_scanQr')}
            </div>
            <canvas data-testid="wa-qr-canvas" ref={canvasRef} className="rounded-md" />
            <p className="text-muted-foreground text-center text-xs">
              {t('whatsapp_scanInstructions')}
            </p>
          </div>
        )}

        {view?.enabled && view.status === 'connected' && (
          <div className="flex items-center gap-2 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
            <CheckCircle2Icon className="h-4 w-4" />
            {t('whatsapp_connectedMsg')}
          </div>
        )}

        <div className="space-y-2">
          <Label>{t('whatsapp_allowedNumbers')}</Label>
          <p className="text-muted-foreground text-xs">{t('whatsapp_numbersHint')}</p>
          <div className="flex gap-2">
            <Input
              data-testid="wa-number-input"
              placeholder="e.g. +1234567890"
              value={newUserId}
              onChange={e => setNewUserId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddUserId()}
              className="flex-1"
            />
            <Button
              data-testid="wa-add-number-btn"
              onClick={handleAddUserId}
              disabled={!/^\+?\d{7,15}$/.test(newUserId.trim())}
              variant="outline"
              size="sm">
              <PlusIcon className="h-4 w-4" />
            </Button>
          </div>
          {config.allowedSenderIds.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {config.allowedSenderIds.map(id => (
                <Badge key={id} variant="secondary" className="gap-1">
                  {formatJid(id)}
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
            <p className="text-xs text-amber-600 dark:text-amber-400">{t('whatsapp_noNumbers')}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label>{t('whatsapp_messageDirection')}</Label>
          <p className="text-muted-foreground text-xs">{t('whatsapp_directionHint')}</p>
          <div className="space-y-2 pt-1">
            <label htmlFor="wa-accept-from-me" className="flex items-center gap-2 text-sm">
              <input
                checked={direction.acceptFromMe}
                className="accent-primary size-4"
                disabled={busy}
                id="wa-accept-from-me"
                onChange={e => handleDirectionChange({ acceptFromMe: e.target.checked })}
                type="checkbox"
              />
              {t('whatsapp_processMyMessages')}
            </label>
            <label htmlFor="wa-accept-from-others" className="flex items-center gap-2 text-sm">
              <input
                checked={direction.acceptFromOthers}
                className="accent-primary size-4"
                disabled={busy}
                id="wa-accept-from-others"
                onChange={e => handleDirectionChange({ acceptFromOthers: e.target.checked })}
                type="checkbox"
              />
              {t('whatsapp_processOthers')}
            </label>
          </div>
        </div>

        {view?.lastError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            <div className="flex items-center gap-1">
              <AlertCircleIcon className="h-3.5 w-3.5" />
              <strong>{t('channels_statusError')}:</strong>
            </div>
            <span className="ml-5">{view.lastError}</span>
          </div>
        )}

        {actionError && (
          <p
            data-testid="wa-action-error"
            className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400">
            <AlertCircleIcon className="h-3.5 w-3.5" />
            {actionError}
          </p>
        )}

        {saved && (
          <div className="flex justify-end">
            <span className="text-muted-foreground flex items-center gap-1 text-xs">
              <CheckCircle2Icon className="size-3" /> {t('common_saved')}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export { WhatsAppConfig };
