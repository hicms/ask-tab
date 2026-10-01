import { McpBridgeConfig } from './mcp-bridge-config.js';
import { IS_FIREFOX } from '@extension/env';
import { t, useT } from '@extension/i18n';
import { toolRegistryMeta } from '@extension/shared';
import {
  defaultWebSearchConfig,
  defaultDeepResearchConfig,
  toolConfigStorage,
} from '@extension/storage';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from '@extension/ui';
import {
  BrainIcon,
  CalendarClockIcon,
  CalendarIcon,
  CloudIcon,
  CodeIcon,
  FileTextIcon,
  GlobeIcon,
  HardDriveDownloadIcon,
  HardDriveIcon,
  LinkIcon,
  MailIcon,
  MessagesSquareIcon,
  MonitorIcon,
  SearchIcon,
  TelescopeIcon,
  UsersIcon,
  WrenchIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToolGroupMeta } from '@extension/shared';
import type {
  BrowserSearchEngine,
  DeepResearchConfig,
  ToolConfig as ToolConfigData,
  WebSearchProvider,
} from '@extension/storage';
import type { LucideIcon } from 'lucide-react';

// ── Icon mapping ──

const iconMap: Record<string, LucideIcon> = {
  CloudIcon,
  SearchIcon,
  LinkIcon,
  FileTextIcon,
  MonitorIcon,
  HardDriveIcon,
  BrainIcon,
  CalendarClockIcon,
  CalendarIcon,
  MessagesSquareIcon,
  TelescopeIcon,
  UsersIcon,
  CodeIcon,
  MailIcon,
  HardDriveDownloadIcon,
};

// ── Sub-config: Web Search ──

const WebSearchSubConfig = ({
  config,
  onProviderChange,
  onBrowserEngineChange,
}: {
  config: ToolConfigData;
  onProviderChange: (provider: WebSearchProvider) => void;
  onBrowserEngineChange: (engine: BrowserSearchEngine) => void;
}) => {
  const searchConfig = config.webSearchConfig ?? defaultWebSearchConfig;

  return (
    <div className="grid gap-3 pl-8">
      <div className="grid gap-2">
        <Label htmlFor="search-provider">{t('tool_searchProvider')}</Label>
        <Select
          onValueChange={v => onProviderChange(v as WebSearchProvider)}
          value={searchConfig.provider}>
          <SelectTrigger id="search-provider">
            <SelectValue placeholder={t('tool_selectProvider')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="server">{t('tool_searchServer')}</SelectItem>
            <SelectItem value="browser">Browser</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {searchConfig.provider === 'server' && (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <CloudIcon className="size-3" />
          {t('tool_searchServerHint')}
        </p>
      )}

      {searchConfig.provider === 'browser' && (
        <div className="grid gap-2">
          <Label htmlFor="search-engine">{t('tool_searchEngine')}</Label>
          <Select
            onValueChange={v => onBrowserEngineChange(v as BrowserSearchEngine)}
            value={searchConfig.browser.engine}>
            <SelectTrigger id="search-engine">
              <SelectValue placeholder={t('tool_selectEngine')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="google">Google</SelectItem>
              <SelectItem value="bing">Bing</SelectItem>
              <SelectItem value="duckduckgo">DuckDuckGo</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <GlobeIcon className="size-3" />
            {t('tool_noApiKey')}
          </p>
        </div>
      )}
    </div>
  );
};

// ── Sub-config: Deep Research ──

const DeepResearchSubConfig = ({
  config,
  onChange,
}: {
  config: ToolConfigData;
  onChange: (updates: Partial<DeepResearchConfig>) => void;
}) => {
  const drConfig = { ...defaultDeepResearchConfig, ...(config.deepResearchConfig ?? {}) };

  return (
    <div className="grid grid-cols-2 gap-3 pl-8">
      <div className="grid gap-1.5">
        <Label className="text-xs" htmlFor="dr-max-depth">
          {t('tool_subTopics')}
        </Label>
        <Input
          id="dr-max-depth"
          max={6}
          min={1}
          onChange={e => onChange({ maxDepth: Number(e.target.value) })}
          type="number"
          value={drConfig.maxDepth}
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs" htmlFor="dr-max-iterations">
          {t('tool_iterationsPerTopic')}
        </Label>
        <Input
          id="dr-max-iterations"
          max={4}
          min={1}
          onChange={e => onChange({ maxIterations: Number(e.target.value) })}
          type="number"
          value={drConfig.maxIterations}
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs" htmlFor="dr-max-sources">
          {t('tool_sourcesPerSearch')}
        </Label>
        <Input
          id="dr-max-sources"
          max={10}
          min={1}
          onChange={e => onChange({ maxSources: Number(e.target.value) })}
          type="number"
          value={drConfig.maxSources}
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs" htmlFor="dr-timeout">
          {t('tool_timeout')}
        </Label>
        <Input
          id="dr-timeout"
          max={600}
          min={30}
          onChange={e => onChange({ timeoutMs: Number(e.target.value) * 1000 })}
          type="number"
          value={Math.round(drConfig.timeoutMs / 1000)}
        />
      </div>
    </div>
  );
};

// ── Sub-config: Google Account ──

const GOOGLE_GROUPS = new Set(['gmail', 'calendar', 'drive']);

const GoogleSubConfig = ({
  config,
  onClientIdChange,
  onConnectionChange,
}: {
  config: ToolConfigData;
  onClientIdChange: (value: string) => void;
  onConnectionChange: (connected: boolean) => void;
}) => {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customClientId = config.googleClientId ?? '';

  /** Get a token — uses launchWebAuthFlow if custom client ID is set, otherwise getAuthToken. */
  const acquireToken = useCallback(
    async (interactive: boolean): Promise<string | null> => {
      if (customClientId) {
        const redirectUrl = chrome.identity.getRedirectURL();
        const params = new URLSearchParams({
          client_id: customClientId,
          redirect_uri: redirectUrl,
          response_type: 'token',
          scope: 'https://www.googleapis.com/auth/userinfo.email',
        });
        if (!interactive) params.set('prompt', 'none');
        const responseUrl = await chrome.identity.launchWebAuthFlow({
          url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
          interactive,
        });
        if (!responseUrl) return null;
        const fragment = responseUrl.split('#')[1];
        if (!fragment) return null;
        return new URLSearchParams(fragment).get('access_token');
      }
      const result = await chrome.identity.getAuthToken({ interactive });
      return result.token || null;
    },
    [customClientId],
  );

  const handleConnect = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await acquireToken(true);
      if (!token) throw new Error('Auth failed');
      const res = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const info = (await res.json()) as { email: string };
        setEmail(info.email);
        onConnectionChange(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tool_failedToConnect'));
    } finally {
      setLoading(false);
    }
  }, [acquireToken, onConnectionChange]);

  const handleDisconnect = useCallback(async () => {
    try {
      if (!customClientId && typeof chrome.identity?.getAuthToken === 'function') {
        const result = await chrome.identity.getAuthToken({ interactive: false });
        if (result.token && typeof chrome.identity?.removeCachedAuthToken === 'function') {
          await chrome.identity.removeCachedAuthToken({ token: result.token });
        }
      }
    } catch {
      // No token cached
    }
    setEmail(null);
    onConnectionChange(false);
  }, [customClientId, onConnectionChange]);

  // Check if already connected on mount (only for default path — webAuthFlow tokens aren't persisted)
  useEffect(() => {
    if (customClientId) return; // webAuthFlow tokens aren't cached across page loads
    if (typeof chrome.identity?.getAuthToken !== 'function') return; // Not available on Firefox
    chrome.identity
      .getAuthToken({ interactive: false })
      .then(result => {
        if (!result.token) return;
        return fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
          headers: { Authorization: `Bearer ${result.token}` },
        })
          .then(res => (res.ok ? (res.json() as Promise<{ email: string }>) : null))
          .then(info => {
            if (info) {
              setEmail(info.email);
              onConnectionChange(true);
            }
          });
      })
      .catch(() => {});
  }, [customClientId, onConnectionChange]);

  // Get the redirect URI that must be registered in Google Cloud Console
  const redirectUri =
    typeof chrome !== 'undefined' && chrome.identity?.getRedirectURL
      ? chrome.identity.getRedirectURL()
      : '';

  return (
    <div className="grid gap-2 pl-4">
      <div className="grid gap-1.5">
        <Label className="text-xs" htmlFor="google-client-id">
          {t('tool_clientId')}
        </Label>
        <Input
          className="text-xs"
          id="google-client-id"
          onChange={e => onClientIdChange(e.target.value)}
          placeholder="Google OAuth client ID"
          value={customClientId}
        />
        {customClientId && redirectUri && (
          <div className="text-muted-foreground space-y-1 text-xs">
            <p>
              Add this redirect URI to your Google Cloud Console OAuth client (Credentials &rarr;
              OAuth 2.0 Client ID &rarr; Authorized redirect URIs):
            </p>
            <code className="bg-muted block select-all break-all rounded px-2 py-1 text-[11px]">
              {redirectUri}
            </code>
          </div>
        )}
      </div>
      {email ? (
        <div className="flex items-center gap-2">
          <p className="text-muted-foreground text-xs">
            {t('tool_connectedAs')} <span className="text-foreground font-medium">{email}</span>
          </p>
          <button
            className="text-destructive hover:text-destructive/80 text-xs underline"
            onClick={handleDisconnect}
            type="button">
            {t('tool_disconnect')}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <button
            className="bg-primary text-primary-foreground hover:bg-primary/90 w-fit rounded-md px-3 py-1.5 text-xs font-medium"
            disabled={loading}
            onClick={handleConnect}
            type="button">
            {loading ? t('tool_connecting') : t('tool_connectGoogle')}
          </button>
          {error && <p className="text-destructive text-xs">{error}</p>}
        </div>
      )}
    </div>
  );
};

// ── Main component ──

const ToolConfig = () => {
  const t = useT();
  const [config, setConfig] = useState<ToolConfigData | null>(null);
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    toolConfigStorage.get().then(c => {
      if (!c.webSearchConfig) {
        c.webSearchConfig = { ...defaultWebSearchConfig };
      }
      setConfig(c);
    });
  }, []);

  const handleToggle = useCallback((toolName: string, value: boolean) => {
    setConfig(prev => {
      if (!prev) return null;
      const next: ToolConfigData = {
        ...prev,
        enabledTools: { ...prev.enabledTools, [toolName]: value },
      };
      toolConfigStorage.set(next);
      return next;
    });
  }, []);

  const handleProviderChange = useCallback((provider: WebSearchProvider) => {
    setConfig(prev => {
      if (!prev) return null;
      const next = {
        ...prev,
        webSearchConfig: {
          ...prev.webSearchConfig,
          provider,
        },
      };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      toolConfigStorage.set(next);
      return next;
    });
  }, []);

  const handleBrowserEngineChange = useCallback((engine: BrowserSearchEngine) => {
    setConfig(prev => {
      if (!prev) return null;
      const next = {
        ...prev,
        webSearchConfig: {
          ...prev.webSearchConfig,
          browser: { engine },
        },
      };
      toolConfigStorage.set(next);
      return next;
    });
  }, []);

  const handleDeepResearchChange = useCallback((updates: Partial<DeepResearchConfig>) => {
    setConfig(prev => {
      if (!prev) return null;
      const next = {
        ...prev,
        deepResearchConfig: {
          ...defaultDeepResearchConfig,
          ...(prev.deepResearchConfig ?? {}),
          ...updates,
        },
      };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        toolConfigStorage.set(next);
      }, 500);
      return next;
    });
  }, []);

  const handleGoogleClientIdChange = useCallback((value: string) => {
    setConfig(prev => {
      if (!prev) return null;
      const next = {
        ...prev,
        googleClientId: value || undefined,
      };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        toolConfigStorage.set(next);
      }, 500);
      return next;
    });
  }, []);

  if (!config) return null;

  /** Check if a sub-config group's tools are enabled */
  const isGroupEnabled = (group: ToolGroupMeta): boolean =>
    group.hasSubConfig === true && group.tools.some(tool => config.enabledTools[tool.name]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <WrenchIcon className="size-5" />
          {t('tool_title')}
        </CardTitle>
        <CardDescription>{t('tool_description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          {/* Non-Google tool groups */}
          {toolRegistryMeta
            .filter(g => !GOOGLE_GROUPS.has(g.groupKey))
            .filter(g => !IS_FIREFOX || !g.tools.every(t => t.chromeOnly))
            .map((group, idx) => {
              const Icon = iconMap[group.iconName];
              return (
                <div key={group.groupKey}>
                  {idx > 0 && <Separator className="mb-4" />}
                  <div className="space-y-3">
                    {/* Group header */}
                    <div className="flex items-center gap-3">
                      {Icon && <Icon className="text-muted-foreground size-5" />}
                      <span className="text-sm font-medium">{group.label}</span>
                    </div>

                    {/* Per-tool checkboxes */}
                    {group.tools.map(tool => {
                      const checkboxId = `tool-${tool.name}`;
                      return (
                        <div key={tool.name} className="flex items-center justify-between pl-8">
                          <div>
                            <Label className="text-sm" htmlFor={checkboxId}>
                              {tool.label}
                            </Label>
                            <p className="text-muted-foreground text-xs">{tool.description}</p>
                          </div>
                          <input
                            checked={config.enabledTools[tool.name] ?? tool.defaultEnabled}
                            className="accent-primary size-4"
                            id={checkboxId}
                            onChange={e => handleToggle(tool.name, e.target.checked)}
                            type="checkbox"
                          />
                        </div>
                      );
                    })}

                    {/* Web search sub-config */}
                    {isGroupEnabled(group) && group.groupKey === 'webSearch' && (
                      <WebSearchSubConfig
                        config={config}
                        onBrowserEngineChange={handleBrowserEngineChange}
                        onProviderChange={handleProviderChange}
                      />
                    )}

                    {/* Deep research sub-config */}
                    {isGroupEnabled(group) && group.groupKey === 'deepResearch' && (
                      <DeepResearchSubConfig config={config} onChange={handleDeepResearchChange} />
                    )}
                  </div>
                </div>
              );
            })}

          {/* ── Google Services unified section ── */}
          <div>
            <Separator className="mb-4" />
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <GlobeIcon className="text-muted-foreground size-5" />
                <span className="text-sm font-medium">{t('tool_googleServices')}</span>
              </div>

              <GoogleSubConfig
                config={config}
                onClientIdChange={handleGoogleClientIdChange}
                onConnectionChange={setIsGoogleConnected}
              />

              {!isGoogleConnected && (
                <p className="text-muted-foreground pl-4 text-xs">{t('tool_enableGoogleHint')}</p>
              )}

              {toolRegistryMeta
                .filter(g => GOOGLE_GROUPS.has(g.groupKey))
                .map(group => {
                  const Icon = iconMap[group.iconName];
                  return (
                    <div key={group.groupKey} className="space-y-3">
                      <div className="flex items-center gap-3 pl-4">
                        {Icon && <Icon className="text-muted-foreground size-4" />}
                        <span className="text-sm font-medium">{group.label}</span>
                      </div>
                      {group.tools.map(tool => {
                        const checkboxId = `tool-${tool.name}`;
                        return (
                          <div
                            key={tool.name}
                            className={cn(
                              'flex items-center justify-between pl-8',
                              !isGoogleConnected && 'opacity-50',
                            )}>
                            <div>
                              <Label className="text-sm" htmlFor={checkboxId}>
                                {tool.label}
                              </Label>
                              <p className="text-muted-foreground text-xs">{tool.description}</p>
                            </div>
                            <input
                              checked={config.enabledTools[tool.name] ?? tool.defaultEnabled}
                              className={cn(
                                'accent-primary size-4',
                                !isGoogleConnected && 'pointer-events-none',
                              )}
                              disabled={!isGoogleConnected}
                              id={checkboxId}
                              onChange={e => handleToggle(tool.name, e.target.checked)}
                              type="checkbox"
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
            </div>
          </div>

          <div>
            <Separator className="mb-4" />
            <McpBridgeConfig />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export { ToolConfig };
