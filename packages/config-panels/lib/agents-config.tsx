import { AgentFilesTab } from './agent-files-tab.js';
import { AgentToolsTab } from './agent-tools-tab.js';
import { ConfirmDialog, emptyConfirm } from './confirm-dialog.js';
import { SkillConfig } from './skill-config.js';
import { t, useT } from '@extension/i18n';
import { backupAgent, backupFilename, parseAgentBackup } from '@extension/shared';
import {
  listSkillFiles,
  listWorkspaceFiles,
  updateWorkspaceFile,
  deleteWorkspaceFile,
  createWorkspaceFile,
  listAgents,
  createAgent,
  getAgent,
  updateAgent,
  deleteAgent,
  seedPredefinedWorkspaceFiles,
  copyGlobalSkillsToAgent,
  activeAgentStorage,
  chatDb,
} from '@extension/storage';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@extension/ui';
import {
  EllipsisVertical,
  HardDriveDownloadIcon,
  HardDriveUploadIcon,
  PlusIcon,
  TrashIcon,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ConfirmDialogState } from './confirm-dialog.js';
import type { DbHeartbeatState, DbWorkspaceFile, AgentConfig } from '@extension/storage';

// ── Inline dialogs ──────

// ── Helpers ──────────────────────────────────────────

const formatFileSize = (content: string): string => {
  const bytes = new TextEncoder().encode(content).byteLength;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
};

const formatTimeAgo = (timestamp: number): string => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return t('agents_justNow');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('agents_minutesAgo', String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('agents_hoursAgo', String(hours));
  const days = Math.floor(hours / 24);
  if (days < 30) return t('agents_daysAgo', String(days));
  const months = Math.floor(days / 30);
  return t('agents_monthsAgo', String(months));
};

const parseIdentityField = (content: string, field: string): string => {
  const regex = new RegExp(`\\*\\*${field}:\\*\\*\\s*(.+)`, 'i');
  const match = content.match(regex);
  if (!match) return t('agents_notSet');
  const value = match[1].trim();
  // Treat template placeholders as not set
  if (value.startsWith('_') && value.endsWith('_')) return t('agents_notSet');
  if (value.startsWith('_(') && value.endsWith(')_')) return t('agents_notSet');
  return value;
};

const truncateTitle = (title: string, max = 18): string =>
  title.length > max ? title.slice(0, max) + '...' : title;

// ── Sub-components ───────────────────────────────────

type AgentInfo = {
  id: string;
  name: string;
  emoji: string;
  isDefault: boolean;
};

const AgentCard = ({
  agent,
  selected,
  onSelect,
  onDelete,
  onBackup,
  onRestore,
}: {
  agent: AgentInfo;
  selected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onBackup?: () => void;
  onRestore?: () => void;
}) => (
  <div
    className={cn(
      'group flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors',
      selected ? 'border-primary bg-primary/5' : 'hover:bg-muted border-transparent',
    )}>
    <button className="flex min-w-0 flex-1 items-center gap-2" onClick={onSelect} type="button">
      <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-full text-base">
        {agent.emoji || '\u{1F916}'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{truncateTitle(agent.name)}</div>
        <div className="text-muted-foreground truncate text-xs">{agent.id}</div>
      </div>
    </button>
    {agent.isDefault && (
      <Badge className="shrink-0 text-[10px]" variant="secondary">
        DEFAULT
      </Badge>
    )}
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="text-muted-foreground hover:bg-accent shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
          onClick={e => e.stopPropagation()}
          type="button">
          <EllipsisVertical size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>
        {onBackup && (
          <DropdownMenuItem onClick={onBackup}>
            <HardDriveDownloadIcon className="size-3.5" />
            <span className="ml-2">{t('agents_backupAgent')}</span>
          </DropdownMenuItem>
        )}
        {onRestore && (
          <DropdownMenuItem onClick={onRestore}>
            <HardDriveUploadIcon className="size-3.5" />
            <span className="ml-2">{t('agents_restoreAgent')}</span>
          </DropdownMenuItem>
        )}
        {onDelete && (
          <DropdownMenuItem onClick={onDelete}>
            <TrashIcon className="size-3.5" />
            <span className="ml-2">{t('common_delete')}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

const AgentListPanel = ({
  agents,
  selectedId,
  onSelect,
  onDelete,
  onCreate,
  onBackup,
  onRestore,
}: {
  agents: AgentInfo[];
  selectedId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
  onBackup: (id: string) => void;
  onRestore: (id: string) => void;
}) => (
  <div className="flex w-60 shrink-0 flex-col border-r">
    <div className="flex items-center justify-between border-b px-4 py-3">
      <h3 className="text-sm font-medium">{t('agents_title')}</h3>
      <Button onClick={onCreate} size="sm" title={t('agents_newAgent')} variant="ghost">
        <PlusIcon className="size-4" />
      </Button>
    </div>
    <ScrollArea className="flex-1">
      <div className="space-y-1 p-2">
        {agents.map(agent => (
          <AgentCard
            agent={agent}
            key={agent.id}
            onBackup={() => onBackup(agent.id)}
            onRestore={() => onRestore(agent.id)}
            onDelete={!agent.isDefault ? () => onDelete(agent.id) : undefined}
            onSelect={() => onSelect(agent.id)}
            selected={agent.id === selectedId}
          />
        ))}
      </div>
    </ScrollArea>
  </div>
);

const AgentDetailHeader = ({
  agent,
  onNameChange,
  onEmojiChange,
  onBackup,
  onRestore,
}: {
  agent: AgentInfo;
  onNameChange: (name: string) => void;
  onEmojiChange: (emoji: string) => void;
  onBackup: () => void;
  onRestore: () => void;
}) => {
  const [editingName, setEditingName] = useState(false);
  const [editingEmoji, setEditingEmoji] = useState(false);
  const [nameValue, setNameValue] = useState(agent.name);
  const [emojiValue, setEmojiValue] = useState(agent.emoji);

  useEffect(() => {
    setNameValue(agent.name);
    setEmojiValue(agent.emoji);
  }, [agent.id, agent.name, agent.emoji]);

  return (
    <div className="flex items-center gap-4 border-b px-6 py-4">
      {editingEmoji ? (
        <Input
          // eslint-disable-next-line jsx-a11y/no-autofocus -- focus the input the user just opened
          autoFocus
          className="size-14 text-center text-2xl"
          onBlur={() => {
            setEditingEmoji(false);
            if (emojiValue !== agent.emoji) onEmojiChange(emojiValue);
          }}
          onChange={e => setEmojiValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              setEditingEmoji(false);
              if (emojiValue !== agent.emoji) onEmojiChange(emojiValue);
            }
          }}
          value={emojiValue}
        />
      ) : (
        <button
          className="bg-muted flex size-14 shrink-0 items-center justify-center rounded-full text-2xl hover:opacity-80"
          onClick={() => setEditingEmoji(true)}
          title="Click to edit emoji"
          type="button">
          {agent.emoji || '\u{1F916}'}
        </button>
      )}
      <div className="min-w-0 flex-1">
        {editingName ? (
          <Input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- focus the input the user just opened
            autoFocus
            className="text-lg font-semibold"
            onBlur={() => {
              setEditingName(false);
              if (nameValue.trim() && nameValue !== agent.name) onNameChange(nameValue.trim());
            }}
            onChange={e => setNameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                setEditingName(false);
                if (nameValue.trim() && nameValue !== agent.name) onNameChange(nameValue.trim());
              }
            }}
            value={nameValue}
          />
        ) : (
          <button
            className="text-left text-lg font-semibold hover:underline"
            onClick={() => setEditingName(true)}
            title="Click to edit name"
            type="button">
            {agent.name}
          </button>
        )}
        <p className="text-muted-foreground text-sm">{agent.id}</p>
      </div>
      <TooltipProvider delayDuration={300}>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={onBackup} size="sm" variant="outline">
                <HardDriveDownloadIcon className="mr-1 size-3.5" />
                {t('agents_backupAgent')}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('agents_backupAgent')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={onRestore} size="sm" variant="outline">
                <HardDriveUploadIcon className="mr-1 size-3.5" />
                {t('agents_restoreAgent')}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('agents_restoreAgent')}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
};

type OverviewField = { label: string; value: string };

const HeartbeatStatusCard = ({ agentId }: { agentId: string }) => {
  const [state, setState] = useState<DbHeartbeatState | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const row = await chatDb.heartbeatState.get(agentId);
      setState(row ?? null);
    } catch {
      setState(null);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
    const listener = (msg: Record<string, unknown>) => {
      if (msg?.type === 'HEARTBEAT_EVENT' && msg.agentId === agentId) {
        void load();
      }
    };
    try {
      chrome.runtime.onMessage.addListener(listener);
    } catch {
      /* ignore */
    }
    return () => {
      try {
        chrome.runtime.onMessage.removeListener(listener);
      } catch {
        /* ignore */
      }
    };
  }, [agentId, load]);

  const runNow = useCallback(async () => {
    setBusy(true);
    try {
      await chrome.runtime.sendMessage({ type: 'HEARTBEAT_RUN_NOW', agentId });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }, [agentId]);

  const formatTime = (ms?: number) =>
    typeof ms === 'number' ? new Date(ms).toLocaleString() : '—';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Heartbeat</CardTitle>
        <Button size="sm" variant="outline" disabled={busy} onClick={runNow}>
          {busy ? 'Running…' : 'Run now'}
        </Button>
      </CardHeader>
      <CardContent className="text-muted-foreground space-y-1 text-sm">
        <div>Last run: {formatTime(state?.lastRunAtMs)}</div>
        <div>
          Status: {state?.lastStatus ?? '—'}
          {state?.lastReason ? ` (${state.lastReason})` : ''}
        </div>
        {state?.lastResultSummary && (
          <div className="truncate">Summary: {state.lastResultSummary}</div>
        )}
      </CardContent>
    </Card>
  );
};

const AgentOverview = ({ identityContent }: { identityContent: string }) => {
  const t = useT();
  const fields: OverviewField[] = useMemo(
    () => [
      { label: 'Name', value: parseIdentityField(identityContent, 'Name') },
      { label: 'Emoji', value: parseIdentityField(identityContent, 'Emoji') },
      { label: 'Creature', value: parseIdentityField(identityContent, 'Creature') },
      { label: 'Vibe', value: parseIdentityField(identityContent, 'Vibe') },
    ],
    [identityContent],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t('agents_identity')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {fields.map(f => (
            <div key={f.label}>
              <div className="text-muted-foreground text-xs font-medium">{f.label}</div>
              <div
                className={cn(
                  'text-sm',
                  f.value === t('agents_notSet') && 'text-muted-foreground italic',
                )}>
                {f.value}
              </div>
            </div>
          ))}
        </div>
        <p className="text-muted-foreground mt-4 text-xs">{t('agents_identityHint')}</p>
      </CardContent>
    </Card>
  );
};

type SubTab = 'overview' | 'files' | 'tools' | 'skills';

// ── Agent Tools Tab ──────────────────────────────────

const AgentsConfig = () => {
  const t = useT();
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('main');
  const [allFiles, setAllFiles] = useState<DbWorkspaceFile[]>([]);
  const [skillFiles, setSkillFiles] = useState<DbWorkspaceFile[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('overview');
  const [loading, setLoading] = useState(true);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(emptyConfirm);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const restoreTargetRef = useRef<string | null>(null);

  const loadAgents = useCallback(async () => {
    let agentList = await listAgents();
    // Auto-create the default agent if the DB is empty (fresh install / cleared DB)
    if (agentList.length === 0) {
      const now = Date.now();
      await createAgent({
        id: 'main',
        name: 'Main Agent',
        identity: { emoji: '' },
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });
      await seedPredefinedWorkspaceFiles('main');
      await copyGlobalSkillsToAgent('main');
      agentList = await listAgents();
    }
    setAgents(agentList);
    // Ensure selectedAgentId is valid
    setSelectedAgentId(prev => {
      if (!agentList.find(a => a.id === prev)) {
        const defaultAgent = agentList.find(a => a.isDefault) ?? agentList[0];
        return defaultAgent?.id ?? prev;
      }
      return prev;
    });
  }, []);

  const loadFiles = useCallback(async () => {
    const [files, skills] = await Promise.all([
      listWorkspaceFiles(selectedAgentId),
      listSkillFiles(selectedAgentId),
    ]);
    setAllFiles(files);
    setSkillFiles(skills);
    setLoading(false);
  }, [selectedAgentId]);

  useEffect(() => {
    loadAgents().then(() => loadFiles());
  }, [loadAgents, loadFiles]);

  const selectedAgent = useMemo(
    () => agents.find(a => a.id === selectedAgentId),
    [agents, selectedAgentId],
  );

  // Build agent info from IDENTITY.md
  const identityFile = useMemo(() => allFiles.find(f => f.name === 'IDENTITY.md'), [allFiles]);
  const identityContent = identityFile?.content ?? '';

  const agentInfo: AgentInfo = useMemo(
    () => ({
      id: selectedAgent?.id ?? 'main',
      name: selectedAgent?.name ?? 'Main Agent',
      emoji: selectedAgent?.identity?.emoji ?? '',
      isDefault: selectedAgent?.isDefault ?? true,
    }),
    [selectedAgent],
  );

  const agentInfoList: AgentInfo[] = useMemo(
    () =>
      agents.map(a => ({
        id: a.id,
        name: a.name,
        emoji: a.identity?.emoji ?? '',
        isDefault: a.isDefault,
      })),
    [agents],
  );

  const handleCreateAgent = useCallback(async () => {
    const id = nanoid(8);
    const now = Date.now();
    const newAgent: AgentConfig = {
      id,
      name: 'New Agent',
      identity: { emoji: '' },
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    };
    await createAgent(newAgent);
    await seedPredefinedWorkspaceFiles(id);
    await copyGlobalSkillsToAgent(id);
    setSelectedAgentId(id);
    await loadAgents();
    await loadFiles();
    toast.success(t('agents_agentCreated'));
  }, [loadAgents, loadFiles, t]);

  const handleDeleteAgent = useCallback(
    (id: string) => {
      setConfirmDialog({
        open: true,
        title: t('agents_deleteAgent'),
        description: t('agents_deleteAgentConfirm'),
        destructive: true,
        onConfirm: async () => {
          try {
            const currentActive = await activeAgentStorage.get();
            if (currentActive === id) {
              await activeAgentStorage.set('main');
            }
            await deleteAgent(id);
            // Best effort: the agent is already gone locally, and a failure here only leaves server-side memory behind.
            chrome.runtime
              .sendMessage({ type: 'MEMORY_FORGET_AGENT', agentId: id })
              .catch(() => {});
            setSelectedAgentId('main');
            await loadAgents();
            toast.success(t('agents_agentDeleted'));
          } catch (err) {
            toast.error(err instanceof Error ? err.message : t('agents_deleteAgentFailed'));
          }
        },
      });
    },
    [loadAgents, t],
  );

  const handleNameChange = useCallback(
    async (name: string) => {
      await updateAgent(selectedAgentId, { name });
      await loadAgents();
    },
    [selectedAgentId, loadAgents],
  );

  const handleEmojiChange = useCallback(
    async (emoji: string) => {
      const current = selectedAgent?.identity;
      await updateAgent(selectedAgentId, { identity: { ...current, emoji } });
      await loadAgents();
    },
    [selectedAgentId, selectedAgent, loadAgents],
  );

  const handleBackupAgent = useCallback(
    async (agentId: string) => {
      try {
        const agent = await getAgent(agentId);
        if (!agent) return;
        const files = await listWorkspaceFiles(agentId);
        const blob = await backupAgent(agent, files);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = backupFilename(agent.name);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success(t('agents_backupSuccess'));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('agents_backupFailed'));
      }
    },
    [t],
  );

  const handleRestoreAgent = useCallback((agentId: string) => {
    restoreTargetRef.current = agentId;
    restoreInputRef.current?.click();
  }, []);

  const handleRestoreFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;

      const agentId = restoreTargetRef.current;
      restoreTargetRef.current = null;
      if (!agentId) return;

      let backup;
      try {
        backup = await parseAgentBackup(file);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('agents_invalidBackup'));
        return;
      }

      const agent = await getAgent(agentId);
      if (!agent) return;

      setConfirmDialog({
        open: true,
        title: t('agents_restoreAgent'),
        description: t('agents_restoreConfirm', [agent.name, backup.meta.name]),
        destructive: true,
        onConfirm: async () => {
          try {
            // 1. Update agent config
            await updateAgent(agentId, {
              name: backup.meta.name,
              identity: backup.meta.identity,
              model: backup.meta.model,
              toolConfig: backup.meta.toolConfig,
              customTools: backup.meta.customTools,
              compactionConfig: backup.meta.compactionConfig,
            });

            // 2. Get existing workspace files for this agent
            const existingFiles = await listWorkspaceFiles(agentId);

            // 3. Delete all non-predefined workspace files
            for (const f of existingFiles) {
              if (!f.predefined) {
                await deleteWorkspaceFile(f.id);
              }
            }

            // 4. Apply backup files
            const predefinedFiles = existingFiles.filter(f => f.predefined);
            for (const backupFile of backup.files) {
              const existing = predefinedFiles.find(f => f.name === backupFile.name);
              if (existing) {
                // Update predefined file content
                await updateWorkspaceFile(existing.id, { content: backupFile.content });
              } else {
                // Create new file
                const now = Date.now();
                await createWorkspaceFile({
                  id: nanoid(),
                  name: backupFile.name,
                  content: backupFile.content,
                  enabled: true,
                  owner: 'user',
                  predefined: false,
                  createdAt: now,
                  updatedAt: now,
                  agentId,
                });
              }
            }

            await loadAgents();
            await loadFiles();
            toast.success(t('agents_restoreSuccess'));
          } catch (err) {
            toast.error(err instanceof Error ? err.message : t('agents_restoreFailed'));
          }
        },
      });
    },
    [loadAgents, loadFiles, t],
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <p className="text-muted-foreground text-sm">Loading agents...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex h-[600px]">
          {/* Agent list panel */}
          <AgentListPanel
            agents={agentInfoList}
            onBackup={handleBackupAgent}
            onCreate={handleCreateAgent}
            onDelete={handleDeleteAgent}
            onRestore={handleRestoreAgent}
            onSelect={id => {
              setSelectedAgentId(id);
              setActiveSubTab('overview');
            }}
            selectedId={selectedAgentId}
          />

          {/* Agent detail panel */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <AgentDetailHeader
              agent={agentInfo}
              onBackup={() => handleBackupAgent(selectedAgentId)}
              onEmojiChange={handleEmojiChange}
              onNameChange={handleNameChange}
              onRestore={() => handleRestoreAgent(selectedAgentId)}
            />

            {/* Sub-tab buttons */}
            <div className="flex items-center gap-1 border-b px-6 py-2">
              <button
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  activeSubTab === 'overview'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
                onClick={() => setActiveSubTab('overview')}
                type="button">
                {t('agents_overview')}
              </button>
              <button
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  activeSubTab === 'files'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
                onClick={() => setActiveSubTab('files')}
                type="button">
                {t('agents_files')}
              </button>
              <button
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  activeSubTab === 'tools'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
                onClick={() => setActiveSubTab('tools')}
                type="button">
                {t('agents_tools')}
              </button>
              <button
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  activeSubTab === 'skills'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
                onClick={() => setActiveSubTab('skills')}
                type="button">
                {t('agents_skills')}
              </button>
            </div>

            {/* Sub-tab content */}
            {activeSubTab === 'overview' && (
              <ScrollArea className="flex-1">
                <div className="space-y-4 p-6">
                  <AgentOverview identityContent={identityContent} />
                  <HeartbeatStatusCard agentId={selectedAgentId} />
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">{t('agents_workspaceFiles')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-muted-foreground text-sm">
                        {allFiles.length} file{allFiles.length !== 1 ? 's' : ''}
                        {skillFiles.length > 0 &&
                          `, ${skillFiles.length} skill${skillFiles.length !== 1 ? 's' : ''}`}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </ScrollArea>
            )}
            {activeSubTab === 'files' && (
              <AgentFilesTab files={allFiles} agentId={selectedAgentId} onReload={loadFiles} />
            )}
            {activeSubTab === 'tools' && (
              <AgentToolsTab agentId={selectedAgentId} onReload={loadAgents} />
            )}
            {activeSubTab === 'skills' && (
              <SkillConfig agentId={selectedAgentId} onMutate={loadFiles} />
            )}
          </div>
        </div>
      </Card>

      <ConfirmDialog state={confirmDialog} onClose={() => setConfirmDialog(emptyConfirm)} />

      <input
        accept=".zip"
        className="hidden"
        ref={restoreInputRef}
        onChange={handleRestoreFileSelected}
        type="file"
      />
    </>
  );
};

export { AgentsConfig, formatFileSize, formatTimeAgo, parseIdentityField };
