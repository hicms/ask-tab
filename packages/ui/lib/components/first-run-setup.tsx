import { accountErrorMessage, accountRequest, validateAccountInput } from './account-form';
import { Step3AgentSetup } from './first-run-agent-setup';
import { Step6SpeechSetup } from './first-run-speech-setup';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from './ui';
import { IS_FIREFOX } from '@extension/env';
import { useT } from '@extension/i18n';
import { toolRegistryMeta, parseSkillFrontmatter } from '@extension/shared';
import {
  toolConfigStorage,
  defaultWebSearchConfig,
  getDefaultAgent,
  createAgent,
  seedPredefinedWorkspaceFiles,
  copyGlobalSkillsToAgent,
  listSkillFiles,
  updateWorkspaceFile,
} from '@extension/storage';
import {
  CheckIcon,
  ChevronLeftIcon,
  KeyIcon,
  Loader2Icon,
  RocketIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SearchIcon,
  LinkIcon,
  FileTextIcon,
  MonitorIcon,
  HardDriveIcon,
  BrainIcon,
  CalendarClockIcon,
  MessagesSquareIcon,
  UsersIcon,
  WorkflowIcon,
  TelescopeIcon,
  CodeIcon,
  BugIcon,
  HardDriveDownloadIcon,
  MailIcon,
  CalendarIcon,
  TicketIcon,
  ZapIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AccountMode, AccountResponse } from './account-form';
import type { TFunction } from '@extension/i18n';
import type { ReactNode } from 'react';

type FirstRunSetupProps = {
  onComplete: () => void;
};

const STEP_LABELS = IS_FIREFOX
  ? ([
      'firstRun_stepAccount',
      'firstRun_stepPermissions',
      'firstRun_stepAgent',
      'firstRun_stepChannels',
      'firstRun_stepTools',
      'firstRun_stepSkills',
      'firstRun_stepSpeech',
    ] as const)
  : ([
      'firstRun_stepAccount',
      'firstRun_stepAgent',
      'firstRun_stepChannels',
      'firstRun_stepTools',
      'firstRun_stepSkills',
      'firstRun_stepSpeech',
    ] as const);

/** Groups to exclude from the onboarding tool picker (require OAuth or feature flags). */
const EXCLUDED_TOOL_GROUPS = new Set(['gmail', 'calendar', 'drive']);

const iconMap: Record<string, ReactNode> = {
  SearchIcon: <SearchIcon className="size-4" />,
  LinkIcon: <LinkIcon className="size-4" />,
  FileTextIcon: <FileTextIcon className="size-4" />,
  MonitorIcon: <MonitorIcon className="size-4" />,
  HardDriveIcon: <HardDriveIcon className="size-4" />,
  BrainIcon: <BrainIcon className="size-4" />,
  CalendarClockIcon: <CalendarClockIcon className="size-4" />,
  MessagesSquareIcon: <MessagesSquareIcon className="size-4" />,
  UsersIcon: <UsersIcon className="size-4" />,
  WorkflowIcon: <WorkflowIcon className="size-4" />,
  TelescopeIcon: <TelescopeIcon className="size-4" />,
  CodeIcon: <CodeIcon className="size-4" />,
  BugIcon: <BugIcon className="size-4" />,
  HardDriveDownloadIcon: <HardDriveDownloadIcon className="size-4" />,
  MailIcon: <MailIcon className="size-4" />,
  CalendarIcon: <CalendarIcon className="size-4" />,
};

/* ---------- ensureDefaultAgent ---------- */

const ensureDefaultAgent = async () => {
  const agent = await getDefaultAgent();
  if (!agent) {
    await createAgent({
      id: 'main',
      name: 'Main Agent',
      identity: { emoji: '\u{1F916}' },
      isDefault: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await seedPredefinedWorkspaceFiles('main');
    await copyGlobalSkillsToAgent('main');
  } else {
    const existing = await listSkillFiles(agent.id);
    if (existing.length === 0) {
      await seedPredefinedWorkspaceFiles(agent.id);
      await copyGlobalSkillsToAgent(agent.id);
    }
  }
};

/* ---------- StepIndicator ---------- */

const StepIndicator = ({ current, t }: { current: number; t: TFunction }) => (
  <div className="flex items-center justify-center gap-3 pb-2">
    {STEP_LABELS.map((labelKey, i) => {
      const stepNum = i + 1;
      const completed = stepNum < current;
      const active = stepNum === current;
      return (
        <div key={labelKey} className="flex flex-col items-center gap-1">
          <div
            className={`flex size-6 items-center justify-center rounded-full text-xs font-medium transition-colors ${
              completed
                ? 'bg-primary text-primary-foreground'
                : active
                  ? 'bg-primary text-primary-foreground'
                  : 'border-muted-foreground/40 text-muted-foreground border'
            }`}>
            {completed ? <CheckIcon className="size-3.5" /> : stepNum}
          </div>
          <span
            className={`text-[10px] ${active ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
            {t(labelKey)}
          </span>
        </div>
      );
    })}
  </div>
);

/* ---------- Step 1: Account ---------- */

const Step1AccountSetup = ({ onNext, t }: { onNext: () => void; t: TFunction }) => {
  const [mode, setMode] = useState<AccountMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [inviteCodeError, setInviteCodeError] = useState('');
  // `submitting` disables the button only after a re-render; this also stops clicks queued before it.
  const submittingRef = useRef(false);

  const handleSubmit = useCallback(async () => {
    if (submittingRef.current) return;
    const input = { email, password, inviteCode };
    const problem = validateAccountInput(mode, input, t);
    if (problem) {
      setError(problem.field === 'form' ? problem.message : '');
      setInviteCodeError(problem.field === 'inviteCode' ? problem.message : '');
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    setInviteCodeError('');
    try {
      const response = (await chrome.runtime.sendMessage(
        accountRequest(mode, input),
      )) as AccountResponse;
      if (response.error !== undefined) {
        setError(accountErrorMessage(response, t));
        return;
      }
      setInviteCode('');
      if (!response.models) {
        // Without models the wizard cannot continue; don't leave a session behind.
        await chrome.runtime.sendMessage({ type: 'ASK_LOGOUT' });
        setError(t('account_noModels'));
      } else {
        onNext();
      }
    } catch {
      setError(t('account_signInFailed'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [email, password, inviteCode, mode, onNext, t]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !submitting) handleSubmit();
    },
    [handleSubmit, submitting],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CardHeader className="text-center">
        <CardTitle className="flex items-center justify-center gap-2 text-xl">
          <RocketIcon className="size-5" />
          {t('firstRun_welcome')}
        </CardTitle>
        <CardDescription>
          {mode === 'login' ? t('account_signInDescription') : t('account_registerDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
        {error && (
          <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="grid gap-2">
          <Label htmlFor="setup-email">{t('account_email')}</Label>
          <div className="relative">
            <MailIcon className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              autoComplete="email"
              className="pl-9"
              data-testid="setup-email"
              id="setup-email"
              onChange={e => {
                setEmail(e.target.value);
                setError('');
              }}
              onKeyDown={handleKeyDown}
              placeholder="you@example.com"
              type="email"
              value={email}
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="setup-password">{t('account_password')}</Label>
          <div className="relative">
            <KeyIcon className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className="pl-9"
              data-testid="setup-password"
              id="setup-password"
              onChange={e => {
                setPassword(e.target.value);
                setError('');
              }}
              onKeyDown={handleKeyDown}
              type="password"
              value={password}
            />
          </div>
          {mode === 'register' && (
            <p className="text-muted-foreground text-xs">{t('account_passwordHint')}</p>
          )}
        </div>

        {mode === 'register' && (
          <div className="grid gap-2">
            <Label htmlFor="setup-invite-code">{t('account_inviteCode')}</Label>
            <div className="relative">
              <TicketIcon className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
              <Input
                aria-describedby={
                  inviteCodeError
                    ? 'setup-invite-code-error setup-invite-code-hint'
                    : 'setup-invite-code-hint'
                }
                aria-invalid={inviteCodeError ? true : undefined}
                autoComplete="off"
                className="pl-9"
                data-testid="setup-invite-code"
                id="setup-invite-code"
                onChange={e => {
                  setInviteCode(e.target.value);
                  setInviteCodeError('');
                  setError('');
                }}
                onKeyDown={handleKeyDown}
                required
                spellCheck={false}
                value={inviteCode}
              />
            </div>
            {inviteCodeError && (
              <p
                className="text-destructive text-xs"
                data-testid="setup-invite-code-error"
                id="setup-invite-code-error"
                role="alert">
                {inviteCodeError}
              </p>
            )}
            <p className="text-muted-foreground text-xs" id="setup-invite-code-hint">
              {t('account_inviteCodeHint')}
            </p>
          </div>
        )}

        <button
          className="text-muted-foreground hover:text-foreground self-start text-xs underline-offset-2 hover:underline"
          data-testid="setup-account-mode"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
            setInviteCodeError('');
          }}
          type="button">
          {mode === 'login' ? t('account_switchToRegister') : t('account_switchToSignIn')}
        </button>

        <Button
          className="mt-auto w-full"
          data-testid="setup-start-button"
          disabled={submitting}
          onClick={handleSubmit}>
          {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
          {mode === 'login' ? t('account_signIn') : t('account_register')}
        </Button>
      </CardContent>
    </div>
  );
};

/* ---------- Firefox Permissions Step ---------- */

const StepFirefoxPermissions = ({
  onNext,
  onBack,
  t,
}: {
  onNext: () => void;
  onBack: () => void;
  t: TFunction;
}) => {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [denied, setDenied] = useState(false);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    chrome.permissions
      .contains({ origins: ['<all_urls>'] })
      .then(has => setGranted(has))
      .catch(() => setGranted(false));
  }, []);

  const handleGrant = useCallback(async () => {
    setRequesting(true);
    setDenied(false);
    try {
      const result = await chrome.permissions.request({ origins: ['<all_urls>'] });
      setGranted(result);
      if (!result) setDenied(true);
    } catch {
      setDenied(true);
    } finally {
      setRequesting(false);
    }
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CardHeader className="text-center">
        <CardTitle className="flex items-center justify-center gap-2 text-xl">
          <ShieldCheckIcon className="size-5" />
          {t('firstRun_permissionsTitle')}
        </CardTitle>
        <CardDescription>{t('firstRun_permissionsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
        {granted === null ? (
          <div className="flex items-center justify-center py-6">
            <Loader2Icon className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : granted ? (
          <div className="flex items-center gap-2 rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
            <CheckIcon className="size-4" />
            {t('firstRun_permissionsGranted')}
          </div>
        ) : (
          <>
            <Button className="w-full" disabled={requesting} onClick={handleGrant}>
              {requesting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              <ShieldCheckIcon className="mr-2 size-4" />
              {t('firstRun_permissionsGrant')}
            </Button>
            {denied && (
              <p className="text-sm text-yellow-600 dark:text-yellow-400">
                {t('firstRun_permissionsDenied')}
              </p>
            )}
          </>
        )}

        <div className="mt-auto flex items-center justify-between">
          <Button data-testid="setup-back-button" onClick={onBack} variant="link">
            <ChevronLeftIcon className="mr-1 size-4" />
            {t('firstRun_back')}
          </Button>
          <Button data-testid="setup-next-button" onClick={onNext}>
            {t('firstRun_next')}
          </Button>
        </div>
      </CardContent>
    </div>
  );
};

/* ---------- Step 2: Channel Setup ---------- */

const Step2ChannelSetup = ({
  onNext,
  onBack,
  t,
}: {
  onNext: () => void;
  onBack: () => void;
  t: TFunction;
}) => {
  const [botToken, setBotToken] = useState('');
  const [allowedUsers, setAllowedUsers] = useState('');
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(false);
  const [botUsername, setBotUsername] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [enableChannel, setEnableChannel] = useState(true);

  /** The server checks the token with Telegram and keeps it; the extension never stores it. */
  const connectBot = useCallback(async (): Promise<boolean> => {
    const response = (await chrome.runtime.sendMessage({
      type: 'CHANNEL_CONNECT',
      channelId: 'telegram',
      botToken: botToken.trim(),
    })) as { view?: { identity: string | null }; error?: string } | undefined;
    if (!response?.view) {
      setError(response?.error ?? t('telegram_invalidToken'));
      return false;
    }
    setValidated(true);
    setBotUsername(response.view.identity ?? '');
    return true;
  }, [botToken, t]);

  const handleValidate = useCallback(async () => {
    if (!botToken.trim()) return;
    setValidating(true);
    setError('');
    try {
      await connectBot();
    } catch {
      setError(t('telegram_validationFailed'));
    } finally {
      setValidating(false);
    }
  }, [botToken, connectBot, t]);

  const handleNext = useCallback(async () => {
    if (!botToken.trim()) {
      onNext();
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (!validated && !(await connectBot())) return;

      const userIds = allowedUsers
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      const saved = (await chrome.runtime.sendMessage({
        type: 'CHANNEL_SAVE_CONFIG',
        channelId: 'telegram',
        config: { allowedSenderIds: userIds },
      })) as { error?: string } | undefined;
      if (saved?.error) throw new Error(saved.error);
      // Connecting enabled the bot on the server; with nobody allowed it would only queue unanswered messages.
      if (!enableChannel || userIds.length === 0) {
        const disabled = (await chrome.runtime.sendMessage({
          type: 'CHANNEL_SET_ENABLED',
          channelId: 'telegram',
          enabled: false,
        })) as { error?: string } | undefined;
        if (disabled?.error) throw new Error(disabled.error);
      }
      onNext();
    } catch {
      setError(t('telegram_saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [botToken, validated, connectBot, allowedUsers, enableChannel, onNext, t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">{t('firstRun_step2Title')}</CardTitle>
        <CardDescription>{t('firstRun_step2Description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
        {error && (
          <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="grid gap-2">
          <Label htmlFor="setup-bot-token">{t('firstRun_telegramBotToken')}</Label>
          <div className="flex gap-2">
            <Input
              className="flex-1"
              data-testid="setup-bot-token"
              id="setup-bot-token"
              onChange={e => {
                setBotToken(e.target.value);
                setValidated(false);
                setError('');
              }}
              placeholder="123456:ABC-DEF..."
              type="password"
              value={botToken}
            />
            <Button
              disabled={!botToken.trim() || validating}
              onClick={handleValidate}
              size="sm"
              variant="outline">
              {validating && <Loader2Icon className="mr-1 size-3.5 animate-spin" />}
              {t('firstRun_telegramValidate')}
            </Button>
          </div>
          {validated && botUsername && (
            <p className="text-sm text-green-600 dark:text-green-400">
              {t('firstRun_telegramValidated')}: {botUsername}
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="setup-allowed-users">{t('firstRun_telegramAllowedUsers')}</Label>
          <Input
            data-testid="setup-allowed-users"
            id="setup-allowed-users"
            onChange={e => setAllowedUsers(e.target.value)}
            placeholder="123456789, 987654321"
            value={allowedUsers}
          />
        </div>

        <label className="flex items-center gap-2 text-sm" htmlFor="setup-enable-channel">
          <input
            checked={enableChannel}
            className="accent-primary size-4"
            disabled={!validated || !allowedUsers.trim()}
            id="setup-enable-channel"
            onChange={e => setEnableChannel(e.target.checked)}
            type="checkbox"
          />
          {t('telegram_enableBot')}
        </label>

        <p className="text-muted-foreground text-xs">{t('firstRun_whatsappNote')}</p>

        <div className="mt-auto flex items-center justify-between">
          <Button data-testid="setup-back-button" onClick={onBack} variant="link">
            <ChevronLeftIcon className="mr-1 size-4" />
            {t('firstRun_back')}
          </Button>
          <Button data-testid="setup-next-button" disabled={saving} onClick={handleNext}>
            {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {t('firstRun_next')}
          </Button>
        </div>
      </CardContent>
    </div>
  );
};

/* ---------- Step 3: Agent Setup ---------- */

/* ---------- Step 4: Tools Setup ---------- */

const Step4ToolsSetup = ({
  onNext,
  onBack,
  t,
}: {
  onNext: () => void;
  onBack: () => void;
  t: TFunction;
}) => {
  const groups = useMemo(
    () =>
      toolRegistryMeta
        .filter(g => !EXCLUDED_TOOL_GROUPS.has(g.groupKey))
        .filter(g => !IS_FIREFOX || !g.tools.every(t => t.chromeOnly)),
    [],
  );

  const [enabledTools, setEnabledTools] = useState<Record<string, boolean>>(() => {
    const defaults: Record<string, boolean> = {};
    for (const group of groups) {
      for (const tool of group.tools) {
        defaults[tool.name] = tool.defaultEnabled;
      }
    }
    return defaults;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleGroup = useCallback((groupTools: readonly { name: string }[], enabled: boolean) => {
    setEnabledTools(prev => {
      const next = { ...prev };
      for (const tool of groupTools) {
        next[tool.name] = enabled;
      }
      return next;
    });
  }, []);

  const handleNext = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      await toolConfigStorage.set({
        enabledTools,
        webSearchConfig: defaultWebSearchConfig,
      });
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('firstRun_saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [enabledTools, onNext, t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">{t('firstRun_step4Title')}</CardTitle>
        <CardDescription>{t('firstRun_step4Description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
        {error && (
          <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="max-h-[300px] space-y-1 overflow-y-auto pr-1">
          {groups.map(group => {
            const allEnabled = group.tools.every(t => enabledTools[t.name]);
            return (
              <label
                key={group.groupKey}
                className="hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-md px-2 py-2">
                <input
                  checked={allEnabled}
                  className="accent-primary size-4"
                  onChange={e => toggleGroup(group.tools, e.target.checked)}
                  type="checkbox"
                />
                <span className="text-muted-foreground">{iconMap[group.iconName]}</span>
                <span className="text-sm font-medium">{group.label}</span>
                {group.tools.length > 1 && (
                  <span className="text-muted-foreground text-xs">
                    ({group.tools.length} {t('firstRun_tools')})
                  </span>
                )}
              </label>
            );
          })}
        </div>

        <div className="mt-auto flex items-center justify-between">
          <Button data-testid="setup-back-button" onClick={onBack} variant="link">
            <ChevronLeftIcon className="mr-1 size-4" />
            {t('firstRun_back')}
          </Button>
          <Button data-testid="setup-next-button" disabled={saving} onClick={handleNext}>
            {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {t('firstRun_next')}
          </Button>
        </div>
      </CardContent>
    </div>
  );
};

/* ---------- Step 5: Skills Setup ---------- */

interface SkillEntry {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

const Step5SkillsSetup = ({
  onNext,
  onBack,
  t,
}: {
  onNext: () => void;
  onBack: () => void;
  t: TFunction;
}) => {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        await ensureDefaultAgent();

        const files = await listSkillFiles('main');
        const entries: SkillEntry[] = [];
        for (const file of files) {
          const meta = parseSkillFrontmatter(file.content);
          if (meta) {
            entries.push({
              id: file.id,
              name: meta.name,
              description: meta.description,
              enabled: file.enabled ?? false,
            });
          }
        }
        setSkills(entries);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('firstRun_saveFailed'));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [t]);

  const toggleSkill = useCallback((id: string, enabled: boolean) => {
    setSkills(prev => prev.map(s => (s.id === id ? { ...s, enabled } : s)));
  }, []);

  const handleGetStarted = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      await Promise.all(skills.map(s => updateWorkspaceFile(s.id, { enabled: s.enabled })));
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('firstRun_saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [skills, onNext, t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">{t('firstRun_step5Title')}</CardTitle>
        <CardDescription>{t('firstRun_step5Description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
        {error && (
          <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2Icon className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : skills.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">{t('firstRun_noSkills')}</p>
        ) : (
          <div className="space-y-1">
            {skills.map(skill => (
              <label
                aria-label={skill.name}
                key={skill.id}
                className="hover:bg-muted/50 flex cursor-pointer items-start gap-3 rounded-md px-2 py-2">
                <input
                  checked={skill.enabled}
                  className="accent-primary mt-0.5 size-4"
                  onChange={e => toggleSkill(skill.id, e.target.checked)}
                  type="checkbox"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <ZapIcon className="text-muted-foreground size-3.5" />
                    <span className="text-sm font-medium">{skill.name}</span>
                  </div>
                  <p className="text-muted-foreground text-xs leading-snug">{skill.description}</p>
                </div>
              </label>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between">
          <Button data-testid="setup-back-button" onClick={onBack} variant="link">
            <ChevronLeftIcon className="mr-1 size-4" />
            {t('firstRun_back')}
          </Button>
          <Button
            data-testid="setup-get-started-button"
            disabled={saving || loading}
            onClick={handleGetStarted}>
            {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {t('firstRun_next')}
          </Button>
        </div>
      </CardContent>
    </div>
  );
};

/* ---------- Main Wizard ---------- */

/** Offset for step numbers, accounting for the Firefox permissions step. */
const STEP_OFFSET = IS_FIREFOX ? 1 : 0;

const FirstRunSetup = ({ onComplete }: FirstRunSetupProps) => {
  const t = useT();
  const [step, setStep] = useState(1);
  const offset = STEP_OFFSET;

  const handleSkipSetup = useCallback(async () => {
    await ensureDefaultAgent();
    onComplete();
  }, [onComplete]);

  return (
    <div className="bg-background flex h-dvh items-center justify-center p-4">
      <Card className="flex h-[640px] w-full max-w-md flex-col">
        <div className="px-6 pt-6">
          <StepIndicator current={step} t={t} />
        </div>

        <div key={step} className="animate-in fade-in flex flex-1 flex-col duration-200">
          {step === 1 && <Step1AccountSetup onNext={() => setStep(2)} t={t} />}
          {IS_FIREFOX && step === 2 && (
            <StepFirefoxPermissions onBack={() => setStep(1)} onNext={() => setStep(3)} t={t} />
          )}
          {step === 2 + offset && (
            <Step3AgentSetup
              onBack={() => setStep(1 + offset)}
              onNext={() => setStep(3 + offset)}
              t={t}
            />
          )}
          {step === 3 + offset && (
            <Step2ChannelSetup
              onBack={() => setStep(2 + offset)}
              onNext={() => setStep(4 + offset)}
              t={t}
            />
          )}
          {step === 4 + offset && (
            <Step4ToolsSetup
              onBack={() => setStep(3 + offset)}
              onNext={() => setStep(5 + offset)}
              t={t}
            />
          )}
          {step === 5 + offset && (
            <Step5SkillsSetup
              onBack={() => setStep(4 + offset)}
              onNext={() => setStep(6 + offset)}
              t={t}
            />
          )}
          {step === 6 + offset && (
            <Step6SpeechSetup onBack={() => setStep(5 + offset)} onComplete={onComplete} t={t} />
          )}
        </div>

        <div className="flex items-center justify-between px-6 pb-6 pt-2">
          <button
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
            onClick={() => chrome.runtime.openOptionsPage()}
            type="button">
            <SettingsIcon className="size-3" />
            {t('firstRun_advancedSetup')}
          </button>
          {step > 1 && (
            <button
              className="text-muted-foreground hover:text-foreground text-xs"
              data-testid="setup-skip-setup"
              onClick={handleSkipSetup}
              type="button">
              {t('firstRun_skipSetup')}
            </button>
          )}
        </div>
      </Card>
    </div>
  );
};

export { FirstRunSetup };
export type { FirstRunSetupProps };
