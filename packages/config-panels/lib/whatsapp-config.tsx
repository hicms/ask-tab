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
  LoaderIcon,
  QrCodeIcon,
} from 'lucide-react';
import { toCanvas } from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';

interface WhatsAppChannelConfig {
  channelId: string;
  enabled: boolean;
  allowedSenderIds: string[];
  status: string;
  lastError?: string;
  lastActivityAt?: number;
  modelId?: string;
  acceptFromMe?: boolean;
  acceptFromOthers?: boolean;
  credentials: Record<string, string>;
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'logged_out';

const WhatsAppConfig = () => {
  const t = useT();
  const [config, setConfig] = useState<WhatsAppChannelConfig | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [qrData, setQrData] = useState<string | null>(null);
  const [newUserId, setNewUserId] = useState('');
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Load config on mount
  useEffect(() => {
    chrome.runtime
      .sendMessage({ type: 'CHANNEL_GET_CONFIG', channelId: 'whatsapp' })
      .then((response: Record<string, unknown>) => {
        const cfg = response.config as WhatsAppChannelConfig;
        setConfig(cfg);
        if (cfg.status === 'active') {
          setConnectionStatus('connected');
        } else if (cfg.status === 'error') {
          setConnectionStatus('disconnected');
        }
      })
      .catch(err => {
        setLoadError(err instanceof Error ? err.message : t('whatsapp_loadFailed'));
      });
  }, [t]);

  // Listen for QR code and connection status messages from SW
  useEffect(() => {
    const handler = (message: Record<string, unknown>) => {
      if (message.type === 'WA_QR_CODE') {
        setQrData(message.qr as string);
        setConnectionStatus('connecting');
      } else if (message.type === 'WA_CONNECTION_STATUS') {
        const status = message.status as ConnectionStatus;
        setConnectionStatus(status);
        if (status === 'connected') {
          setQrData(null); // Clear QR on successful connection
          // Update local config status
          setConfig(prev => (prev ? { ...prev, status: 'active' } : prev));
        } else if (status === 'logged_out') {
          setQrData(null);
          setConfig(prev =>
            prev ? { ...prev, status: 'error', lastError: 'Logged out — re-scan QR code' } : prev,
          );
        }
      }
    };

    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  // Render QR code to canvas when qrData changes
  useEffect(() => {
    if (!qrData || !canvasRef.current) return;

    toCanvas(canvasRef.current, qrData, {
      width: 256,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    }).catch((err: unknown) => {
      diagnostics.error('QR render failed:', err);
    });
  }, [qrData]);

  const triggerSaved = useCallback(() => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, []);

  const doSave = useCallback(
    async (cfg: WhatsAppChannelConfig) => {
      try {
        await chrome.runtime.sendMessage({
          type: 'CHANNEL_SAVE_CONFIG',
          channelId: 'whatsapp',
          config: {
            credentials: {},
            allowedSenderIds: cfg.allowedSenderIds,
            modelId: cfg.modelId,
            acceptFromMe: cfg.acceptFromMe,
            acceptFromOthers: cfg.acceptFromOthers,
          },
        });
        triggerSaved();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : t('whatsapp_saveFailed'));
      }
    },
    [t, triggerSaved],
  );

  const handleConnect = useCallback(async () => {
    setActionError(null);
    try {
      // Save config first (allowlist)
      if (config) {
        await doSave(config);
      }

      // Enable the channel — this starts the offscreen document with Baileys
      await chrome.runtime.sendMessage({
        type: 'CHANNEL_TOGGLE',
        channelId: 'whatsapp',
        enabled: true,
      });

      setConnectionStatus('connecting');
      setConfig(prev => (prev ? { ...prev, enabled: true } : prev));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('whatsapp_connectionFailed'));
    }
  }, [config, doSave, t]);

  const handleDisconnect = useCallback(async () => {
    setActionError(null);
    try {
      await chrome.runtime.sendMessage({
        type: 'CHANNEL_TOGGLE',
        channelId: 'whatsapp',
        enabled: false,
      });

      setConnectionStatus('disconnected');
      setQrData(null);
      setConfig(prev => (prev ? { ...prev, enabled: false, status: 'idle' } : prev));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('whatsapp_disconnectFailed'));
    }
  }, [t]);

  const handleAddUserId = useCallback(() => {
    const trimmed = newUserId.trim();
    if (!trimmed || !config) return;
    // WhatsApp phone numbers: accept digits, optionally with + prefix
    if (!/^\+?\d{7,15}$/.test(trimmed)) return;
    // Store as JID format: number@s.whatsapp.net
    const jid = trimmed.replace(/^\+/, '') + '@s.whatsapp.net';
    if (config.allowedSenderIds.includes(jid)) return;

    const updated = { ...config, allowedSenderIds: [...config.allowedSenderIds, jid] };
    setConfig(updated);
    setNewUserId('');
    doSave(updated);
  }, [newUserId, config, doSave]);

  const handleRemoveUserId = useCallback(
    (id: string) => {
      if (!config) return;
      const updated = {
        ...config,
        allowedSenderIds: config.allowedSenderIds.filter(s => s !== id),
      };
      setConfig(updated);
      doSave(updated);
    },
    [config, doSave],
  );

  /** Format a JID for display: 12345@s.whatsapp.net → +12345 */
  const formatJid = (jid: string): string => {
    const num = jid.split('@')[0];
    return `+${num}`;
  };

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

  const statusColor: Record<string, string> = {
    idle: 'bg-gray-400',
    passive: 'bg-yellow-400',
    active: 'bg-green-400',
    error: 'bg-red-400',
  };

  const statusLabel: Record<ConnectionStatus, string> = {
    disconnected: t('whatsapp_disconnected'),
    connecting: t('whatsapp_connecting'),
    connected: t('whatsapp_connected'),
    reconnecting: t('whatsapp_reconnecting'),
    logged_out: t('whatsapp_loggedOut'),
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageCircleIcon className="h-5 w-5 text-green-500" />
          <CardTitle>{t('whatsapp_title')}</CardTitle>
          <div
            className={`h-2.5 w-2.5 rounded-full ${statusColor[config.status] ?? 'bg-gray-400'}`}
            title={`Status: ${config.status}`}
          />
        </div>
        <CardDescription>{t('whatsapp_description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Connection Status */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>{t('whatsapp_connection')}</Label>
            <p className="text-muted-foreground text-xs">{statusLabel[connectionStatus]}</p>
          </div>
          {!config.enabled ||
          connectionStatus === 'disconnected' ||
          connectionStatus === 'logged_out' ? (
            <Button
              onClick={handleConnect}
              disabled={config.allowedSenderIds.length === 0}
              variant="default"
              size="sm">
              {t('whatsapp_connect')}
            </Button>
          ) : (
            <Button onClick={handleDisconnect} variant="outline" size="sm">
              {t('whatsapp_disconnect')}
            </Button>
          )}
        </div>

        {/* QR Code Display */}
        {qrData && (connectionStatus === 'connecting' || connectionStatus === 'reconnecting') && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <QrCodeIcon className="h-4 w-4" />
              {t('whatsapp_scanQr')}
            </div>
            <canvas ref={canvasRef} className="rounded-md" />
            <p className="text-muted-foreground text-center text-xs">
              {t('whatsapp_scanInstructions')}
            </p>
          </div>
        )}

        {/* Connected indicator */}
        {connectionStatus === 'connected' && (
          <div className="flex items-center gap-2 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
            <CheckCircle2Icon className="h-4 w-4" />
            {t('whatsapp_connectedMsg')}
          </div>
        )}

        {/* Reconnecting indicator */}
        {connectionStatus === 'reconnecting' && (
          <div className="flex items-center gap-2 rounded-md bg-yellow-50 p-3 text-sm text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
            <LoaderIcon className="h-4 w-4 animate-spin" />
            {t('whatsapp_reconnectingMsg')}
          </div>
        )}

        {/* Allowed Phone Numbers */}
        <div className="space-y-2">
          <Label>{t('whatsapp_allowedNumbers')}</Label>
          <p className="text-muted-foreground text-xs">{t('whatsapp_numbersHint')}</p>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. +1234567890"
              value={newUserId}
              onChange={e => setNewUserId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddUserId()}
              className="flex-1"
            />
            <Button
              onClick={handleAddUserId}
              disabled={!newUserId.trim() || !/^\+?\d{7,15}$/.test(newUserId.trim())}
              variant="outline"
              size="sm">
              <PlusIcon className="h-4 w-4" />
            </Button>
          </div>
          {config.allowedSenderIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {config.allowedSenderIds.map(id => (
                <Badge key={id} variant="secondary" className="gap-1">
                  {formatJid(id)}
                  <button
                    onClick={() => handleRemoveUserId(id)}
                    className="hover:text-destructive ml-0.5"
                    type="button">
                    <XIcon className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          {config.allowedSenderIds.length === 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t('whatsapp_noNumbers')}</p>
          )}
        </div>

        {/* Message Direction */}
        <div className="space-y-2">
          <Label>{t('whatsapp_messageDirection')}</Label>
          <p className="text-muted-foreground text-xs">{t('whatsapp_directionHint')}</p>
          <div className="space-y-2 pt-1">
            <label htmlFor="wa-accept-from-me" className="flex items-center gap-2 text-sm">
              <input
                checked={config.acceptFromMe ?? true}
                className="accent-primary size-4"
                id="wa-accept-from-me"
                onChange={e => {
                  const updated = { ...config, acceptFromMe: e.target.checked };
                  setConfig(updated);
                  doSave(updated);
                }}
                type="checkbox"
              />
              {t('whatsapp_processMyMessages')}
            </label>
            <label htmlFor="wa-accept-from-others" className="flex items-center gap-2 text-sm">
              <input
                checked={config.acceptFromOthers ?? false}
                className="accent-primary size-4"
                id="wa-accept-from-others"
                onChange={e => {
                  const updated = { ...config, acceptFromOthers: e.target.checked };
                  setConfig(updated);
                  doSave(updated);
                }}
                type="checkbox"
              />
              {t('whatsapp_processOthers')}
            </label>
          </div>
        </div>

        {/* Error display */}
        {config.status === 'error' && config.lastError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            <div className="flex items-center gap-1">
              <AlertCircleIcon className="h-3.5 w-3.5" />
              <strong>Error:</strong>
            </div>
            <span className="ml-5">{config.lastError}</span>
          </div>
        )}

        {/* Action error */}
        {actionError && (
          <p className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400">
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
