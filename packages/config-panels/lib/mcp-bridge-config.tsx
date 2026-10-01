import { buildMcpClientConfig } from './mcp-client-config.js';
import { useT } from '@extension/i18n';
import {
  DEFAULT_MCP_BRIDGE_PORT,
  generateMcpBridgeToken,
  mcpBridgeConfigStorage,
} from '@extension/storage';
import { Button, Input, Label } from '@extension/ui';
import { CopyIcon, PlugIcon, RefreshCwIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { McpBridgeConfig as McpBridgeConfigData } from '@extension/storage';

const fallbackConfig: McpBridgeConfigData = {
  enabled: false,
  port: DEFAULT_MCP_BRIDGE_PORT,
  token: '',
};

const McpBridgeConfig = () => {
  const t = useT();
  const [config, setConfig] = useState<McpBridgeConfigData | null>(null);
  const [portInput, setPortInput] = useState('');
  const [portError, setPortError] = useState(false);

  useEffect(() => {
    const load = (initial: boolean) =>
      mcpBridgeConfigStorage
        .get()
        .catch(() => fallbackConfig)
        .then(stored => {
          setConfig(stored);
          if (initial) setPortInput(String(stored.port));
        });
    void load(true);
    return mcpBridgeConfigStorage.subscribe(() => void load(false));
  }, []);

  const save = useCallback(async (next: McpBridgeConfigData): Promise<boolean> => {
    setConfig(next);
    try {
      await mcpBridgeConfigStorage.set(next);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setConfig(await mcpBridgeConfigStorage.get().catch(() => fallbackConfig));
      return false;
    }
  }, []);

  const copy = useCallback(
    (text: string) => {
      navigator.clipboard
        .writeText(text)
        .then(() => toast.success(t('mcp_copied')))
        .catch(err => toast.error(err instanceof Error ? err.message : String(err)));
    },
    [t],
  );

  if (!config) return null;

  const handleToggle = (enabled: boolean) =>
    // The first activation creates the token so the user can copy it straight away.
    void save({ ...config, enabled, token: config.token || generateMcpBridgeToken() });

  const handlePortCommit = async () => {
    const port = Number(portInput);
    if (!Number.isInteger(port)) {
      setPortError(true);
      return;
    }
    setPortError(!(await save({ ...config, port })));
  };

  const handleRegenerate = async () => {
    if (await save({ ...config, token: generateMcpBridgeToken() })) {
      toast.success(t('mcp_regenerated'));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <PlugIcon className="text-muted-foreground size-5" />
        <span className="text-sm font-medium">{t('mcp_title')}</span>
      </div>
      <p className="text-muted-foreground pl-8 text-xs">{t('mcp_description')}</p>

      <div className="flex items-center justify-between pl-8">
        <Label className="text-sm" htmlFor="mcp-bridge-enabled">
          {t('mcp_enable')}
        </Label>
        <input
          checked={config.enabled}
          className="accent-primary size-4"
          id="mcp-bridge-enabled"
          onChange={e => handleToggle(e.target.checked)}
          type="checkbox"
        />
      </div>

      {config.enabled && (
        <div className="space-y-3 pl-8">
          <div className="space-y-1">
            <Label className="text-sm" htmlFor="mcp-bridge-port">
              {t('mcp_port')}
            </Label>
            <Input
              aria-invalid={portError}
              className="w-32"
              id="mcp-bridge-port"
              inputMode="numeric"
              onBlur={() => void handlePortCommit()}
              onChange={e => {
                setPortInput(e.target.value);
                setPortError(false);
              }}
              value={portInput}
            />
            {portError && <p className="text-destructive text-xs">{t('mcp_invalidPort')}</p>}
          </div>

          <div className="space-y-1">
            <Label className="text-sm" htmlFor="mcp-bridge-token">
              {t('mcp_token')}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                className="font-mono"
                id="mcp-bridge-token"
                readOnly
                type="password"
                value={config.token}
              />
              <Button
                aria-label={t('mcp_copyToken')}
                onClick={() => copy(config.token)}
                size="icon"
                title={t('mcp_copyToken')}
                variant="outline">
                <CopyIcon className="size-4" />
              </Button>
              <Button
                aria-label={t('mcp_regenerateToken')}
                onClick={() => void handleRegenerate()}
                size="icon"
                title={t('mcp_regenerateToken')}
                variant="outline">
                <RefreshCwIcon className="size-4" />
              </Button>
            </div>
          </div>

          <Button
            onClick={() => copy(buildMcpClientConfig(config.port, config.token))}
            size="sm"
            variant="outline">
            <CopyIcon className="size-4" />
            {t('mcp_copyConfig')}
          </Button>
          <p className="text-muted-foreground text-xs">{t('mcp_securityNote')}</p>
        </div>
      )}
    </div>
  );
};

export { McpBridgeConfig };
