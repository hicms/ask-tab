import {
  deleteBackupRevision,
  keepLatestBackupRevision,
  listBackupRevisions,
  readBackupRevision,
  saveBackupRevision,
} from './revisions';
import { requireSession, withAccountMutation } from '../ask-service/client';
import {
  askSessionStorage,
  captureFullBackup,
  restoreFullBackup,
  validateFullBackup,
} from '@extension/storage';
import type { AskSession } from '@extension/storage';

const SETTINGS_KEY = 'backup-settings';
const ALARM_NAME = 'server-backup-daily';
const DAY_MS = 24 * 60 * 60_000;

interface BackupSettings {
  enabled: boolean;
  lastSuccessAt?: number;
  lastError?: string;
  lastAttemptAt?: number;
}

const accountSettingsKey = (userId: string): string => `${SETTINGS_KEY}:${userId}`;

const saveSettings = async (userId: string, settings: BackupSettings): Promise<void> => {
  await chrome.storage.local.set({ [accountSettingsKey(userId)]: settings });
};

const readSettings = async (userId?: string): Promise<BackupSettings> => {
  if (!userId) return { enabled: false };
  const key = accountSettingsKey(userId);
  const stored = await chrome.storage.local.get(key);
  return (stored[key] as BackupSettings | undefined) ?? { enabled: false };
};

const publicStatus = (settings: BackupSettings, signedIn: boolean) => ({
  signedIn,
  enabled: settings.enabled,
  lastSuccessAt: settings.lastSuccessAt,
  lastError: settings.lastError,
});

const configureAlarm = async (settings: BackupSettings, userId?: string): Promise<void> => {
  const activeUserId = (await askSessionStorage.get())?.userId;
  if (activeUserId !== userId) return;
  if (settings.enabled) {
    if (!(await chrome.alarms.get(ALARM_NAME))) {
      await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1440 });
    }
  } else {
    await chrome.alarms.clear(ALARM_NAME);
  }
};

let activeOperation = false;
const runExclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
  if (activeOperation) throw new Error('A backup or restore is already running');
  activeOperation = true;
  try {
    return await operation();
  } finally {
    activeOperation = false;
  }
};

const performBackup = async (expectedSession?: AskSession): Promise<{ id: string }> => {
  const session = await requireSession(expectedSession);
  const settings = await readSettings(session.userId);
  settings.lastAttemptAt = Date.now();
  await saveSettings(session.userId, settings);
  try {
    const saved = await saveBackupRevision(validateFullBackup(await captureFullBackup()), session);
    settings.lastSuccessAt = Date.now();
    settings.lastError = undefined;
    await saveSettings(session.userId, settings);
    return { id: saved.id };
  } catch (error) {
    settings.lastError = error instanceof Error ? error.message : String(error);
    await saveSettings(session.userId, settings);
    throw error;
  }
};

const runBackup = (expectedSession?: AskSession): Promise<{ id: string }> =>
  runExclusive(() => performBackup(expectedSession));

const runAutomaticBackup = async (): Promise<void> => {
  const session = await askSessionStorage.get();
  if (!session || !(await readSettings(session.userId)).enabled) return;
  await runBackup(session);
};

const handleBackupMessage = async (
  request: Record<string, unknown>,
  beforeRestore?: () => Promise<void>,
): Promise<Record<string, unknown>> => {
  if (
    activeOperation &&
    request.type !== 'BACKUP_STATUS' &&
    request.type !== 'BACKUP_HISTORY' &&
    request.type !== 'BACKUP_RESTORE_PREVIEW'
  ) {
    throw new Error('A backup or restore is already running');
  }
  const session = await askSessionStorage.get();
  const settings = await readSettings(session?.userId);
  switch (request.type) {
    case 'BACKUP_STATUS':
      return publicStatus(settings, Boolean(session));
    case 'BACKUP_SET_ENABLED':
      if (!session) throw new Error('Sign in to your AskTab account first');
      settings.enabled = request.enabled === true;
      await saveSettings(session.userId, settings);
      await configureAlarm(settings, session.userId);
      return publicStatus(settings, true);
    case 'BACKUP_RUN':
      return runBackup(session ?? undefined);
    case 'BACKUP_HISTORY':
      return { history: await listBackupRevisions(session ?? undefined) };
    case 'BACKUP_DELETE_REVISION':
    case 'BACKUP_KEEP_LATEST': {
      if (!session) throw new Error('Sign in to your AskTab account first');
      return runExclusive(async () => {
        const result =
          request.type === 'BACKUP_DELETE_REVISION'
            ? await deleteBackupRevision(request.id, session)
            : await keepLatestBackupRevision(request.id, session);
        // Only ever lower the success time: the newest remaining revision may
        // have been uploaded by another device this one never checked.
        settings.lastSuccessAt =
          result.latestCreatedAt === undefined || settings.lastSuccessAt === undefined
            ? undefined
            : Math.min(settings.lastSuccessAt, result.latestCreatedAt);
        if (result.retained === 0) settings.enabled = false;
        await saveSettings(session.userId, settings);
        if (result.retained === 0) await configureAlarm(settings, session.userId);
        return { ...result, status: publicStatus(settings, true) };
      });
    }
    case 'BACKUP_RESTORE_PREVIEW': {
      const backup = await readBackupRevision(request.id, session ?? undefined);
      return {
        createdAt: backup.createdAt,
        agents: backup.tables.agents.length,
        chats: backup.tables.chats.length,
        tasks: backup.tables.scheduledTasks.length,
      };
    }
    case 'BACKUP_RESTORE': {
      return runExclusive(async () => {
        const backup = await readBackupRevision(request.id, session ?? undefined);
        if (!session) throw new Error('Sign in to your AskTab account first');
        await withAccountMutation(async () => {
          const current = await askSessionStorage.get();
          if (current?.token !== session.token || current.userId !== session.userId) {
            throw new Error('Account changed during restore');
          }
          await beforeRestore?.();
          if (session.expiresAt <= Date.now()) throw new Error('Session expired during restore');
          await restoreFullBackup(backup);
        });
        return { restored: true };
      });
    }
    default:
      throw new Error('Unknown backup command');
  }
};

const initializeBackup = async (): Promise<void> => {
  const session = await askSessionStorage.get();
  const settings = await readSettings(session?.userId);
  await configureAlarm(settings, session?.userId);
  if (
    settings.enabled &&
    session &&
    (await askSessionStorage.get())?.token === session.token &&
    (!settings.lastSuccessAt || Date.now() - settings.lastSuccessAt > DAY_MS) &&
    (!settings.lastAttemptAt || Date.now() - settings.lastAttemptAt > 15 * 60_000)
  ) {
    await runAutomaticBackup().catch(() => {});
  }
};

export { ALARM_NAME, handleBackupMessage, initializeBackup, runAutomaticBackup };
