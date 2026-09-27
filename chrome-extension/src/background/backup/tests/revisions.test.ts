import {
  deleteBackupRevision,
  keepLatestBackupRevision,
  listBackupRevisions,
  readBackupRevision,
  saveBackupRevision,
} from '../revisions';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskSession, FullBackup } from '@extension/storage';

const server = vi.hoisted(() => ({
  stored: new Map<string, Uint8Array>(),
  reportedSize: undefined as number | undefined,
  reportedDigest: undefined as string | undefined,
  requests: [] as { path: string; init?: RequestInit; expected?: AskSession }[],
}));
const ID_A = 'a'.repeat(32);
const ID_B = 'b'.repeat(32);
const session: AskSession = {
  token: 'jwt',
  userId: 'u',
  email: 'a@b.co',
  expiresAt: 9999999999999,
};
const digest = async (bytes: Uint8Array): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');

vi.mock('../../ask-service/client', () => ({
  requestAuthorized: vi.fn(async (path: string, init?: RequestInit, expected?: AskSession) => {
    server.requests.push({ path, init, expected });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (path === '/api/backups' && init?.method === 'POST') {
      const bytes = new Uint8Array(init.body as ArrayBuffer);
      const id = server.stored.size === 0 ? ID_A : ID_B;
      server.stored.set(id, bytes);
      return json({
        id,
        createdAt: 1_000,
        size: server.reportedSize ?? bytes.byteLength,
        sha256: server.reportedDigest ?? (await digest(bytes)),
      });
    }
    if (path === '/api/backups') {
      return json(
        await Promise.all(
          [...server.stored].map(async ([id, bytes]) => ({
            id,
            createdAt: 1,
            size: bytes.length,
            sha256: await digest(bytes),
          })),
        ),
      );
    }
    if (path === '/api/backups/keep-latest') return json({ retained: 1, latestCreatedAt: 2_000 });
    const id = path.slice('/api/backups/'.length);
    if (init?.method === 'DELETE') {
      server.stored.delete(id);
      return json({ retained: server.stored.size, latestCreatedAt: null });
    }
    const bytes = server.stored.get(id)!;
    return new Response(bytes, {
      status: 200,
      headers: {
        'X-Backup-SHA256': server.reportedDigest ?? (await digest(bytes)),
      },
    });
  }),
}));
vi.mock('@extension/storage', () => ({ validateFullBackup: vi.fn((value: unknown) => value) }));
const snapshot = {
  format: 'asktab-full-backup',
  version: 2,
  note: 'x'.repeat(10_000),
  local: {
    'suggested-actions': [
      { id: 'action-1', label: 'Summarize this page', prompt: 'Summarize', icon: 'page' },
    ],
  },
};

beforeEach(() => {
  server.stored.clear();
  server.reportedSize = undefined;
  server.reportedDigest = undefined;
  server.requests.length = 0;
});
describe('server backup revisions', () => {
  it('verifies the SHA-256 of compressed bytes on upload and download', async () => {
    const saved = await saveBackupRevision(snapshot as unknown as FullBackup, session);
    const bytes = server.stored.get(saved.id)!;
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    expect(saved.sha256).toBe(await digest(bytes));
    expect(server.requests[0].expected).toEqual(session);
    expect(await readBackupRevision(saved.id, session)).toEqual(snapshot);
  });
  it('rejects mismatched upload size or digest', async () => {
    server.reportedSize = 3;
    await expect(saveBackupRevision(snapshot as unknown as FullBackup, session)).rejects.toThrow(
      'verification failed',
    );
    server.reportedSize = undefined;
    server.reportedDigest = '0'.repeat(64);
    await expect(saveBackupRevision(snapshot as unknown as FullBackup, session)).rejects.toThrow(
      'digest does not match',
    );
  });
  it('rejects a corrupt download before decompressing', async () => {
    server.stored.set(ID_A, new TextEncoder().encode('not gzip'));
    server.reportedDigest = '0'.repeat(64);
    await expect(readBackupRevision(ID_A, session)).rejects.toThrow('digest does not match');
  });
  it('rejects missing or invalid digest metadata', async () => {
    server.reportedDigest = 'invalid';
    await expect(saveBackupRevision(snapshot as unknown as FullBackup, session)).rejects.toThrow(
      'digest is missing or invalid',
    );
    server.stored.set(ID_A, new TextEncoder().encode('not gzip'));
    await expect(readBackupRevision(ID_A, session)).rejects.toThrow('digest is missing or invalid');
  });
  it('lists revisions with digests', async () => {
    await saveBackupRevision(snapshot as unknown as FullBackup, session);
    const list = await listBackupRevisions(session);
    expect(list[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('rejects malformed IDs before any request', async () => {
    await expect(readBackupRevision('../other-user')).rejects.toThrow('Invalid backup revision');
    await expect(deleteBackupRevision(undefined)).rejects.toThrow('Invalid backup revision');
    await expect(keepLatestBackupRevision('ABC')).rejects.toThrow('Invalid backup revision');
    expect(server.requests).toHaveLength(0);
  });
  it('deletes one revision and keeps only the requested latest ID', async () => {
    await saveBackupRevision(snapshot as unknown as FullBackup, session);
    expect(await deleteBackupRevision(ID_A, session)).toEqual({
      retained: 0,
      latestCreatedAt: undefined,
    });
    expect(await keepLatestBackupRevision(ID_B, session)).toEqual({
      retained: 1,
      latestCreatedAt: 2_000,
    });
    expect(JSON.parse(server.requests.at(-1)!.init?.body as string)).toEqual({ latestId: ID_B });
  });
});
