import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  local: {} as Record<string, unknown>,
  alarms: new Set<string>(),
  session: null as { token: string; userId: string; email: string; expiresAt: number } | null,
}));

const revisions = vi.hoisted(() => ({
  saveBackupRevision: vi.fn(async () => ({ id: 'c'.repeat(32), createdAt: 5_000, size: 10 })),
  listBackupRevisions: vi.fn(async () => []),
  readBackupRevision: vi.fn(),
  deleteBackupRevision: vi.fn(async () => ({ retained: 0, latestCreatedAt: undefined })),
  keepLatestBackupRevision: vi.fn(),
}));

vi.mock('../revisions', () => revisions);
vi.mock('../../ask-service/client', () => ({
  requireSession: vi.fn(async (expected?: { token: string; userId: string }) => {
    if (!env.session) throw new Error('Sign in to your AskTab account first');
    if (
      expected &&
      (env.session.token !== expected.token || env.session.userId !== expected.userId)
    )
      throw new Error('Account changed during request');
    return env.session;
  }),
}));
vi.mock('@extension/storage', () => ({
  askSessionStorage: { get: vi.fn(async () => env.session) },
  captureFullBackup: vi.fn(async () => ({ format: 'asktab-full-backup' })),
  validateFullBackup: vi.fn((value: unknown) => value),
  restoreFullBackup: vi.fn(),
}));

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (key: string) => (key in env.local ? { [key]: env.local[key] } : {})),
      set: vi.fn(async (items: Record<string, unknown>) => Object.assign(env.local, items)),
      remove: vi.fn(async (key: string) => {
        delete env.local[key];
      }),
    },
  },
  alarms: {
    get: vi.fn(async (name: string) => (env.alarms.has(name) ? { name } : undefined)),
    create: vi.fn(async (name: string) => {
      env.alarms.add(name);
    }),
    clear: vi.fn(async (name: string) => env.alarms.delete(name)),
  },
});

const { handleBackupMessage, initializeBackup, runAutomaticBackup } = await import('../service');

beforeEach(() => {
  env.local = {};
  env.alarms.clear();
  env.session = null;
  vi.clearAllMocks();
});

describe('server backup service', () => {
  it('skips startup backup while signed out', async () => {
    await initializeBackup();
    expect(revisions.saveBackupRevision).not.toHaveBeenCalled();
    expect(env.alarms.has('server-backup-daily')).toBe(false);
  });

  it('runs an overdue backup for the current user ID', async () => {
    env.session = { token: 't', userId: 'u1', email: 'a@b.c', expiresAt: 9999999999999 };
    env.local['backup-settings:u1'] = { enabled: true };
    await initializeBackup();
    expect(revisions.saveBackupRevision).toHaveBeenCalledWith(expect.anything(), env.session);
    expect(env.local['backup-settings:u1']).toMatchObject({ enabled: true, lastError: undefined });
  });

  it('reports sign-in state in status', async () => {
    expect(await handleBackupMessage({ type: 'BACKUP_STATUS' })).toMatchObject({
      signedIn: false,
      enabled: false,
    });
    env.session = { token: 't', userId: 'u1', email: 'a@b.c', expiresAt: 9999999999999 };
    expect(await handleBackupMessage({ type: 'BACKUP_STATUS' })).toMatchObject({ signedIn: true });
  });

  it('keeps backup status and scheduling separate when accounts change', async () => {
    env.session = { token: 'a-token', userId: 'u1', email: 'a@b.c', expiresAt: 9999999999999 };
    await handleBackupMessage({ type: 'BACKUP_SET_ENABLED', enabled: true });
    await handleBackupMessage({ type: 'BACKUP_RUN' });
    expect(await handleBackupMessage({ type: 'BACKUP_STATUS' })).toMatchObject({
      enabled: true,
      lastSuccessAt: expect.any(Number),
    });

    env.session = { token: 'b-token', userId: 'u2', email: 'b@b.c', expiresAt: 9999999999999 };
    await initializeBackup();
    expect(await handleBackupMessage({ type: 'BACKUP_STATUS' })).toMatchObject({
      enabled: false,
      lastSuccessAt: undefined,
    });
    expect(env.alarms.has('server-backup-daily')).toBe(false);

    env.session = { token: 'a-new-token', userId: 'u1', email: 'A@B.C', expiresAt: 9999999999999 };
    await initializeBackup();
    expect(await handleBackupMessage({ type: 'BACKUP_STATUS' })).toMatchObject({
      enabled: true,
      lastSuccessAt: expect.any(Number),
    });
    expect(env.alarms.has('server-backup-daily')).toBe(true);
  });

  it('does not inherit another account’s backup state after signing out', async () => {
    env.session = { token: 'a-token', userId: 'u1', email: 'a@b.c', expiresAt: 9999999999999 };
    await handleBackupMessage({ type: 'BACKUP_SET_ENABLED', enabled: true });
    env.session = null;
    await initializeBackup();
    expect(await handleBackupMessage({ type: 'BACKUP_STATUS' })).toMatchObject({
      signedIn: false,
      enabled: false,
    });
    expect(env.alarms.has('server-backup-daily')).toBe(false);
  });

  it('does not run an old alarm for an account with automatic backup disabled', async () => {
    env.session = { token: 'a-token', userId: 'u1', email: 'a@b.c', expiresAt: 9999999999999 };
    await handleBackupMessage({ type: 'BACKUP_SET_ENABLED', enabled: true });
    env.session = { token: 'b-token', userId: 'u2', email: 'b@b.c', expiresAt: 9999999999999 };

    await runAutomaticBackup();
    expect(revisions.saveBackupRevision).not.toHaveBeenCalled();
  });

  it('turns off automatic backup after deleting the last revision', async () => {
    env.session = { token: 't', userId: 'u1', email: 'a@b.c', expiresAt: 9999999999999 };
    env.local['backup-settings:u1'] = { enabled: true, lastSuccessAt: 4_000 };
    env.alarms.add('server-backup-daily');

    const result = await handleBackupMessage({
      type: 'BACKUP_DELETE_REVISION',
      id: 'a'.repeat(32),
    });

    expect(revisions.deleteBackupRevision).toHaveBeenCalledWith('a'.repeat(32), env.session);
    expect(result).toMatchObject({ retained: 0, status: { enabled: false } });
    expect(env.local['backup-settings:u1']).toMatchObject({
      enabled: false,
      lastSuccessAt: undefined,
    });
    expect(env.alarms.has('server-backup-daily')).toBe(false);
  });

  it('records the failure message when a backup fails', async () => {
    env.session = { token: 't', userId: 'u1', email: 'a@b.c', expiresAt: 9999999999999 };
    revisions.saveBackupRevision.mockRejectedValueOnce(new Error('Not signed in'));

    await expect(handleBackupMessage({ type: 'BACKUP_RUN' })).rejects.toThrow('Not signed in');
    expect(env.local['backup-settings:u1']).toMatchObject({ lastError: 'Not signed in' });
  });
});
