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

interface TelegramChannelConfig {
  channelId: string;
  enabled: boolean;
  allowedSenderIds: string[];
  status: string;
  lastError?: string;
  lastActivityAt?: number;
  modelId?: string;
  credentials: Record<string, string>;
}

const TelegramConfig = () => {
  const t = useT();
  const [config, setConfig] = useState<TelegramChannelConfig | null>(null);
  const [botToken, setBotToken] = useState('');
  const [validating, setValidating] = useState(false);
  const [botIdentity, setBotIdentity] = useState<string | null>(null);
  const [isValidated, setIsValidated] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [newUserId, setNewUserId] = useState('');
  const [saved, setSaved] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // F22: Load config on mount with error handling
  useEffect(() => {
    chrome.runtime
      .sendMessage({ type: 'CHANNEL_GET_CONFIG', channelId: 'telegram' })
      .then((response: Record<string, unknown>) => {
        const cfg = response.config as TelegramChannelConfig;
        setConfig(cfg);
        setBotToken(cfg.credentials?.botToken ?? '');
        if (cfg.credentials?.botUsername) {
          setBotIdentity(`@${cfg.credentials.botUsername}`);
          setIsValidated(true);
        }
      })
      .catch(err => {
        setLoadError(err instanceof Error ? err.message : t('telegram_loadFailed'));
      });
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [t]);

  const handleValidate = useCallback(async () => {
    if (!botToken.trim()) return;
    setValidating(true);
    setValidationError(null);
    setBotIdentity(null);
    setIsValidated(false);

    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'CHANNEL_VALIDATE_AUTH',
        channelId: 'telegram',
        credentials: { botToken },
      })) as { valid: boolean; identity?: string; error?: string };

      if (response.valid) {
        // F15b: Store identity separately from validation gate
        setBotIdentity(response.identity ?? null);
        setIsValidated(true);
        setValidationError(null);
      } else {
        setValidationError(response.error ?? t('telegram_invalidToken'));
      }
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : t('telegram_validationFailed'));
    } finally {
      setValidating(false);
    }
  }, [botToken, t]);

  const triggerSaved = useCallback(() => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, []);

  const doSave = useCallback(
    async (cfg: TelegramChannelConfig, token: string, identity: string | null) => {
      try {
        await chrome.runtime.sendMessage({
          type: 'CHANNEL_SAVE_CONFIG',
          channelId: 'telegram',
          config: {
            credentials: { botToken: token, botUsername: identity?.replace('@', '') ?? '' },
            allowedSenderIds: cfg.allowedSenderIds,
            modelId: cfg.modelId,
          },
        });
        triggerSaved();
      } catch (err) {
        setValidationError(err instanceof Error ? err.message : t('telegram_saveFailed'));
      }
    },
    [t, triggerSaved],
  );

  const debouncedSave = useCallback(
    (cfg: TelegramChannelConfig, token: string, identity: string | null) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        doSave(cfg, token, identity);
      }, 500);
    },
    [doSave],
  );

  const handleAddUserId = useCallback(() => {
    const trimmed = newUserId.trim();
    if (!trimmed || !config) return;
    // F15: Validate that the input is a numeric Telegram user ID
    if (!/^\d+$/.test(trimmed)) return;
    if (config.allowedSenderIds.includes(trimmed)) return;

    const updated = { ...config, allowedSenderIds: [...config.allowedSenderIds, trimmed] };
    setConfig(updated);
    setNewUserId('');
    doSave(updated, botToken, botIdentity);
  }, [newUserId, config, doSave, botToken, botIdentity]);

  const handleRemoveUserId = useCallback(
    (id: string) => {
      if (!config) return;
      const updated = {
        ...config,
        allowedSenderIds: config.allowedSenderIds.filter(s => s !== id),
      };
      setConfig(updated);
      doSave(updated, botToken, botIdentity);
    },
    [config, doSave, botToken, botIdentity],
  );

  // R7: Wrap toggle in try/catch, only update UI state on success
  const handleToggle = useCallback(
    async (enabled: boolean) => {
      if (!config) return;

      try {
        await doSave(config, botToken, botIdentity);

        await chrome.runtime.sendMessage({
          type: 'CHANNEL_TOGGLE',
          channelId: 'telegram',
          enabled,
        });

        setConfig(prev =>
          prev ? { ...prev, enabled, status: enabled ? 'passive' : 'idle' } : prev,
        );
      } catch (err) {
        setValidationError(err instanceof Error ? err.message : t('telegram_toggleFailed'));
      }
    },
    [config, doSave, botToken, botIdentity, t],
  );

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

  const statusColor: Record<string, string> = {
    idle: 'bg-gray-400',
    passive: 'bg-yellow-400',
    active: 'bg-green-400',
    error: 'bg-red-400',
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <SendIcon className="h-5 w-5 text-blue-500" />
          <CardTitle>{t('telegram_title')}</CardTitle>
          <div
            data-testid="tg-status-dot"
            className={`h-2.5 w-2.5 rounded-full ${statusColor[config.status] ?? 'bg-gray-400'}`}
            title={`Status: ${config.status}`}
          />
        </div>
        <CardDescription>{t('telegram_description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between">
          <Label>{t('telegram_enableBot')}</Label>
          <Button
            data-testid="tg-enable-toggle"
            onClick={() => handleToggle(!config.enabled)}
            disabled={!botToken.trim() || !isValidated || config.allowedSenderIds.length === 0}
            variant={config.enabled ? 'default' : 'outline'}
            size="sm">
            {config.enabled ? t('common_enabled') : t('common_disabled')}
          </Button>
        </div>

        {/* Bot Token */}
        <div className="space-y-2">
          <Label htmlFor="tg-token">{t('telegram_botToken')}</Label>
          <div className="flex gap-2">
            <Input
              id="tg-token"
              data-testid="tg-token-input"
              type="password"
              placeholder="123456:ABC-DEF..."
              value={botToken}
              onChange={e => {
                const token = e.target.value;
                setBotToken(token);
                setBotIdentity(null);
                setIsValidated(false);
                setValidationError(null);
                if (config) debouncedSave(config, token, null);
              }}
              className="flex-1"
            />
            <Button
              data-testid="tg-validate-btn"
              onClick={handleValidate}
              disabled={!botToken.trim() || validating}
              variant="outline"
              size="sm">
              {validating ? (
                <LoaderIcon className="h-4 w-4 animate-spin" />
              ) : (
                t('telegram_validate')
              )}
            </Button>
          </div>
          {botIdentity && (
            <p
              data-testid="tg-bot-identity"
              className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2Icon className="h-3.5 w-3.5" />
              {botIdentity}
            </p>
          )}
          {isValidated && !botIdentity && (
            <p className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2Icon className="h-3.5 w-3.5" />
              {t('telegram_tokenValid')}
            </p>
          )}
          {validationError && (
            <p
              data-testid="tg-validation-error"
              className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400">
              <AlertCircleIcon className="h-3.5 w-3.5" />
              {validationError}
            </p>
          )}
        </div>

        {/* Allowed User IDs */}
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
              disabled={!newUserId.trim() || !/^\d+$/.test(newUserId.trim())}
              variant="outline"
              size="sm">
              <PlusIcon className="h-4 w-4" />
            </Button>
          </div>
          {config.allowedSenderIds.length > 0 && (
            <div data-testid="tg-user-badges" className="flex flex-wrap gap-1.5 pt-1">
              {config.allowedSenderIds.map(id => (
                <Badge key={id} variant="secondary" className="gap-1">
                  {id}
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
            <p
              data-testid="tg-no-users-warning"
              className="text-xs text-amber-600 dark:text-amber-400">
              {t('telegram_noUsers')}
            </p>
          )}
        </div>

        {/* Error display */}
        {config.status === 'error' && config.lastError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            <strong>Error:</strong> {config.lastError}
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
