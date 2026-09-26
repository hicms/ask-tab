import { toolRegistryMeta } from '@extension/shared';
import { diagnostics } from '@extension/shared/lib/diagnostics.js';
import {
  getAgent,
  updateAgent,
  activeAgentStorage,
  toolConfigStorage,
  createAgentToolConfig,
} from '@extension/storage';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  ScrollArea,
  Separator,
  cn,
} from '@extension/ui';
import {
  BrainIcon,
  CalendarClockIcon,
  CalendarIcon,
  CloudIcon,
  CodeIcon,
  FileTextIcon,
  HardDriveDownloadIcon,
  HardDriveIcon,
  LinkIcon,
  MailIcon,
  MessagesSquareIcon,
  MonitorIcon,
  SearchIcon,
  TelescopeIcon,
  TrashIcon,
  UsersIcon,
  WrenchIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { AgentConfig, ToolConfig as ToolConfigData } from '@extension/storage';
import type { LucideIcon } from 'lucide-react';

const agentToolIconMap: Record<string, LucideIcon> = {
  CloudIcon,
  SearchIcon,
  LinkIcon,
  FileTextIcon,
  MonitorIcon,
  HardDriveIcon,
  BrainIcon,
  CalendarClockIcon,
  MessagesSquareIcon,
  TelescopeIcon,
  UsersIcon,
  CodeIcon,
  MailIcon,
  CalendarIcon,
  HardDriveDownloadIcon,
};

const GOOGLE_GROUPS = new Set(['gmail', 'calendar', 'drive']);

const AgentToolsTab = ({ agentId, onReload }: { agentId: string; onReload: () => void }) => {
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [globalConfig, setGlobalConfig] = useState<ToolConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);

  // Check Google connection status on mount (mirrors tool-config.tsx pattern)
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.identity?.getAuthToken) return;
    chrome.identity
      .getAuthToken({ interactive: false })
      .then(result => {
        if (result.token) setIsGoogleConnected(true);
      })
      .catch(() => {});
  }, []);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const [agent, global] = await Promise.all([getAgent(agentId), toolConfigStorage.get()]);
      if (agent) setAgentConfig(agent);
      setGlobalConfig(global);
    } catch (err) {
      diagnostics.error('Failed to load tool config', err);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleToggle = useCallback(
    async (toolName: string, value: boolean) => {
      if (!agentConfig) return;

      const currentToolConfig = agentConfig.toolConfig ?? createAgentToolConfig();
      const nextToolConfig = {
        ...currentToolConfig,
        enabledTools: { ...currentToolConfig.enabledTools, [toolName]: value },
      };

      await updateAgent(agentId, { toolConfig: nextToolConfig });

      // If this agent is currently active, also update global config so changes take effect immediately
      const activeId = await activeAgentStorage.get();
      if (activeId === agentId && globalConfig) {
        const nextGlobal = {
          ...globalConfig,
          enabledTools: { ...globalConfig.enabledTools, [toolName]: value },
        };
        await toolConfigStorage.set(nextGlobal);
        setGlobalConfig(nextGlobal);
      }

      setAgentConfig(prev =>
        prev ? { ...prev, toolConfig: nextToolConfig, updatedAt: Date.now() } : null,
      );
      onReload();
    },
    [agentConfig, agentId, globalConfig, onReload],
  );

  const handleRemoveCustomTool = useCallback(
    async (toolName: string) => {
      if (!agentConfig) return;
      const customTools = (agentConfig.customTools ?? []).filter(ct => ct.name !== toolName);
      const currentToolConfig = agentConfig.toolConfig ?? createAgentToolConfig();
      const nextEnabledTools = { ...currentToolConfig.enabledTools };
      delete nextEnabledTools[toolName];
      const nextToolConfig = { ...currentToolConfig, enabledTools: nextEnabledTools };

      await updateAgent(agentId, { customTools, toolConfig: nextToolConfig });
      setAgentConfig(prev =>
        prev ? { ...prev, customTools, toolConfig: nextToolConfig, updatedAt: Date.now() } : null,
      );
      toast.success(`Removed custom tool "${toolName}"`);
      onReload();
    },
    [agentConfig, agentId, onReload],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground text-sm">Loading tools…</p>
      </div>
    );
  }

  if (!agentConfig || !globalConfig) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground text-sm">Unable to load tool configuration.</p>
      </div>
    );
  }

  const agentEnabledTools = agentConfig.toolConfig?.enabledTools ?? {};

  /** Resolve enabled state: agent override > global config > registry default */
  const isEnabled = (toolName: string, defaultEnabled: boolean): boolean => {
    if (toolName in agentEnabledTools) return agentEnabledTools[toolName];
    if (toolName in globalConfig.enabledTools) return globalConfig.enabledTools[toolName];
    return defaultEnabled;
  };

  const customTools = agentConfig.customTools ?? [];

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-4 p-6">
        {/* Built-in tools */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <WrenchIcon className="size-4" />
              Built-in Tools
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Non-Google tools */}
            {toolRegistryMeta
              .filter(g => !GOOGLE_GROUPS.has(g.groupKey))
              .map((group, idx) => {
                const Icon = agentToolIconMap[group.iconName];
                return (
                  <div key={group.groupKey}>
                    {idx > 0 && <Separator className="mb-4" />}
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        {Icon && <Icon className="text-muted-foreground size-4" />}
                        <span className="text-sm font-medium">{group.label}</span>
                      </div>
                      {group.tools.map(t => {
                        const checkboxId = `agent-tool-${t.name}`;
                        return (
                          <div key={t.name} className="flex items-center justify-between pl-7">
                            <div>
                              <Label className="text-sm" htmlFor={checkboxId}>
                                {t.label}
                              </Label>
                              <p className="text-muted-foreground text-xs">{t.description}</p>
                            </div>
                            <input
                              checked={isEnabled(t.name, t.defaultEnabled)}
                              className="accent-primary size-4"
                              id={checkboxId}
                              onChange={e => handleToggle(t.name, e.target.checked)}
                              type="checkbox"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

            {/* Google Services */}
            <Separator className="mb-4" />
            <div className="space-y-3">
              <span className="text-sm font-medium">Google Services</span>
              {!isGoogleConnected && (
                <p className="text-muted-foreground text-xs">
                  Connect your Google account in the Tools tab to enable these tools
                </p>
              )}
            </div>
            {toolRegistryMeta
              .filter(g => GOOGLE_GROUPS.has(g.groupKey))
              .map(group => {
                const Icon = agentToolIconMap[group.iconName];
                return (
                  <div key={group.groupKey} className="space-y-3">
                    <div className="flex items-center gap-3 pl-4">
                      {Icon && <Icon className="text-muted-foreground size-4" />}
                      <span className="text-sm font-medium">{group.label}</span>
                    </div>
                    {group.tools.map(t => {
                      const checkboxId = `agent-tool-${t.name}`;
                      return (
                        <div
                          key={t.name}
                          className={cn(
                            'flex items-center justify-between pl-8',
                            !isGoogleConnected && 'opacity-50',
                          )}>
                          <div>
                            <Label className="text-sm" htmlFor={checkboxId}>
                              {t.label}
                            </Label>
                            <p className="text-muted-foreground text-xs">{t.description}</p>
                          </div>
                          <input
                            checked={isEnabled(t.name, t.defaultEnabled)}
                            className={cn(
                              'accent-primary size-4',
                              !isGoogleConnected && 'pointer-events-none',
                            )}
                            disabled={!isGoogleConnected}
                            id={checkboxId}
                            onChange={e => handleToggle(t.name, e.target.checked)}
                            type="checkbox"
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
          </CardContent>
        </Card>

        {/* Custom tools */}
        {customTools.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <CodeIcon className="size-4" />
                Custom Tools
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {customTools.map(ct => {
                const checkboxId = `agent-custom-tool-${ct.name}`;
                return (
                  <div key={ct.name} className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm" htmlFor={checkboxId}>
                          {ct.name}
                        </Label>
                        <Badge className="text-[10px]" variant="outline">
                          {ct.path}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground text-xs">{ct.description}</p>
                      {ct.params.length > 0 && (
                        <p className="text-muted-foreground text-xs">
                          Params: {ct.params.map(p => p.name).join(', ')}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <input
                        checked={isEnabled(ct.name, true)}
                        className="accent-primary size-4"
                        id={checkboxId}
                        onChange={e => handleToggle(ct.name, e.target.checked)}
                        type="checkbox"
                      />
                      <button
                        className="text-muted-foreground hover:text-destructive rounded p-1"
                        onClick={() => handleRemoveCustomTool(ct.name)}
                        title="Remove custom tool"
                        type="button">
                        <TrashIcon className="size-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
};

// ── Main component ───────────────────────────────────

export { AgentToolsTab };
