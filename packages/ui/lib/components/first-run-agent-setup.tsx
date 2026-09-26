import {
  Button,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui';
import { parseAgentBackup } from '@extension/shared';
import {
  getDefaultAgent,
  createAgent,
  updateAgent,
  seedPredefinedWorkspaceFiles,
  copyGlobalSkillsToAgent,
  updateWorkspaceFile,
  deleteWorkspaceFile,
  createWorkspaceFile,
  listWorkspaceFiles,
} from '@extension/storage';
import { ChevronLeftIcon, Loader2Icon, HardDriveUploadIcon } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useCallback, useRef, useState } from 'react';
import type { TFunction } from '@extension/i18n';
import type { DbWorkspaceFile } from '@extension/storage';

const AGENT_TEMPLATES = [
  { id: 'ask', name: 'Ask', emoji: '\u{1F4AC}', keyPrefix: 'agent_tpl_ask' },
  { id: 'sage', name: 'Sage', emoji: '\u{1F9ED}', keyPrefix: 'agent_tpl_sage' },
  { id: 'slate', name: 'Slate', emoji: '\u25FC\uFE0F', keyPrefix: 'agent_tpl_slate' },
] as const;

const Step3AgentSetup = ({
  onNext,
  onBack,
  t,
}: {
  onNext: () => void;
  onBack: () => void;
  t: TFunction;
}) => {
  const tplKey = useCallback(
    (prefix: string, field: string) => t(`${prefix}_${field}` as Parameters<typeof t>[0]),
    [t],
  );

  const [selectedTemplate, setSelectedTemplate] = useState<string>(AGENT_TEMPLATES[0].id);
  const [agentName, setAgentName] = useState<string>(AGENT_TEMPLATES[0].name);
  const [agentEmoji, setAgentEmoji] = useState<string>(AGENT_TEMPLATES[0].emoji);
  const [creature, setCreature] = useState<string>(
    tplKey(AGENT_TEMPLATES[0].keyPrefix, 'creature'),
  );
  const [vibe, setVibe] = useState<string>(tplKey(AGENT_TEMPLATES[0].keyPrefix, 'vibe'));
  const [strengths, setStrengths] = useState<string>(
    tplKey(AGENT_TEMPLATES[0].keyPrefix, 'strengths'),
  );
  const [boundaries, setBoundaries] = useState<string>(
    tplKey(AGENT_TEMPLATES[0].keyPrefix, 'boundaries'),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const restoreInputRef = useRef<HTMLInputElement>(null);

  const selectTemplate = useCallback(
    (tpl: (typeof AGENT_TEMPLATES)[number]) => {
      setSelectedTemplate(tpl.id);
      setAgentName(tpl.name);
      setAgentEmoji(tpl.emoji);
      setCreature(tplKey(tpl.keyPrefix, 'creature'));
      setVibe(tplKey(tpl.keyPrefix, 'vibe'));
      setStrengths(tplKey(tpl.keyPrefix, 'strengths'));
      setBoundaries(tplKey(tpl.keyPrefix, 'boundaries'));
    },
    [tplKey],
  );

  const handleNext = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      let agent = await getDefaultAgent();
      if (!agent) {
        agent = {
          id: 'main',
          name: agentName.trim() || 'Main Agent',
          identity: { emoji: agentEmoji || '\u{1F916}' },
          isDefault: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await createAgent(agent);
        await seedPredefinedWorkspaceFiles('main');
        await copyGlobalSkillsToAgent('main');
      } else {
        await updateAgent(agent.id, {
          name: agentName.trim() || agent.name,
          identity: { ...agent.identity, emoji: agentEmoji || agent.identity.emoji },
        });
      }

      // Write identity to IDENTITY.md workspace file using user-editable values
      const identityContent = `# IDENTITY.md - Who Am I?

- **Name:** ${agentName.trim()}
- **Creature:** ${creature}
- **Vibe:** ${vibe}
- **Emoji:** ${agentEmoji}

## Profile
- **Strengths:** ${strengths}
- **Boundaries:** ${boundaries}
`;
      const files = await listWorkspaceFiles('main');
      const identityFile = files.find(f => f.name === 'IDENTITY.md');
      if (identityFile) {
        await updateWorkspaceFile(identityFile.id, { content: identityContent });
      }

      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('firstRun_saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [agentName, agentEmoji, creature, vibe, strengths, boundaries, onNext, t]);

  const handleRestore = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;

      setSaving(true);
      setError('');
      try {
        const backup = await parseAgentBackup(file);

        // Ensure default agent exists
        let agent = await getDefaultAgent();
        if (!agent) {
          agent = {
            id: 'main',
            name: backup.meta.name,
            identity: backup.meta.identity ?? { emoji: '\u{1F916}' },
            isDefault: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          await createAgent(agent);
          await seedPredefinedWorkspaceFiles('main');
          await copyGlobalSkillsToAgent('main');
        }

        // Update agent config from backup
        await updateAgent(agent.id, {
          name: backup.meta.name,
          identity: backup.meta.identity,
          model: backup.meta.model,
          toolConfig: backup.meta.toolConfig,
          customTools: backup.meta.customTools,
          compactionConfig: backup.meta.compactionConfig,
        });

        // Replace workspace files
        const existingFiles = await listWorkspaceFiles(agent.id);
        for (const f of existingFiles) {
          if (!f.predefined) await deleteWorkspaceFile(f.id);
        }
        const predefinedFiles = existingFiles.filter(f => f.predefined);
        for (const bf of backup.files) {
          const existing = predefinedFiles.find(f => f.name === bf.name);
          if (existing) {
            await updateWorkspaceFile(existing.id, { content: bf.content });
          } else {
            const now = Date.now();
            const wsFile: DbWorkspaceFile = {
              id: nanoid(),
              name: bf.name,
              content: bf.content,
              enabled: true,
              owner: 'user',
              predefined: false,
              createdAt: now,
              updatedAt: now,
              agentId: agent.id,
            };
            await createWorkspaceFile(wsFile);
          }
        }

        // Update form fields from backup
        setAgentName(backup.meta.name);
        setAgentEmoji(backup.meta.identity?.emoji ?? '\u{1F916}');
        // Extract fields from IDENTITY.md if present
        const identityFile = backup.files.find(f => f.name === 'IDENTITY.md');
        if (identityFile) {
          const extract = (field: string): string => {
            const regex = new RegExp(`\\*\\*${field}:\\*\\*\\s*(.+)`, 'i');
            const match = identityFile.content.match(regex);
            return match?.[1]?.trim() ?? '';
          };
          setCreature(extract('Creature'));
          setVibe(extract('Vibe'));
          setStrengths(extract('Strengths'));
          setBoundaries(extract('Boundaries'));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('firstRun_restoreFailed'));
      } finally {
        setSaving(false);
      }
    },
    [t],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">{t('firstRun_step3Title')}</CardTitle>
        <CardDescription>{t('firstRun_step3Description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {error && (
          <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="grid gap-2">
          <Label>{t('firstRun_agentTemplate')}</Label>
          <Select
            value={selectedTemplate}
            onValueChange={v => {
              const tpl = AGENT_TEMPLATES.find(tp => tp.id === v);
              if (tpl) selectTemplate(tpl);
            }}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGENT_TEMPLATES.map(tpl => (
                <SelectItem key={tpl.id} value={tpl.id}>
                  {tpl.emoji} {tpl.name} — {t(`${tpl.keyPrefix}_vibe` as Parameters<typeof t>[0])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-[1fr_80px] gap-2">
          <div className="grid gap-1">
            <Label htmlFor="setup-agent-name">{t('firstRun_agentName')}</Label>
            <Input
              data-testid="setup-agent-name"
              id="setup-agent-name"
              onChange={e => setAgentName(e.target.value)}
              placeholder={t('firstRun_defaultAgentName')}
              value={agentName}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="setup-agent-emoji">{t('firstRun_agentEmoji')}</Label>
            <Input
              className="text-center text-xl"
              data-testid="setup-agent-emoji"
              id="setup-agent-emoji"
              maxLength={2}
              onChange={e => setAgentEmoji(e.target.value)}
              value={agentEmoji}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label htmlFor="setup-agent-creature">{t('firstRun_agentCreature')}</Label>
            <Input
              id="setup-agent-creature"
              onChange={e => setCreature(e.target.value)}
              value={creature}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="setup-agent-vibe">{t('firstRun_agentVibe')}</Label>
            <Input id="setup-agent-vibe" onChange={e => setVibe(e.target.value)} value={vibe} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label htmlFor="setup-agent-strengths">{t('firstRun_agentStrengths')}</Label>
            <Input
              id="setup-agent-strengths"
              onChange={e => setStrengths(e.target.value)}
              value={strengths}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="setup-agent-boundaries">{t('firstRun_agentBoundaries')}</Label>
            <Input
              id="setup-agent-boundaries"
              onChange={e => setBoundaries(e.target.value)}
              value={boundaries}
            />
          </div>
        </div>

        <div className="mt-auto flex items-center justify-between">
          <Button data-testid="setup-back-button" onClick={onBack} variant="link">
            <ChevronLeftIcon className="mr-1 size-4" />
            {t('firstRun_back')}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              disabled={saving}
              onClick={() => restoreInputRef.current?.click()}
              variant="outline">
              <HardDriveUploadIcon className="mr-1 size-4" />
              {t('agents_restoreAgent')}
            </Button>
            <Button data-testid="setup-next-button" disabled={saving} onClick={handleNext}>
              {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              {t('firstRun_next')}
            </Button>
          </div>
        </div>

        <input
          accept=".zip"
          className="hidden"
          ref={restoreInputRef}
          onChange={handleRestore}
          type="file"
        />
      </CardContent>
    </div>
  );
};

export { Step3AgentSetup };
