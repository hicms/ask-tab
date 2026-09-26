import { requestAuthorized } from '../ask-service/client';
import { validateFullBackup } from '@extension/storage';
import type { AskSession, FullBackup } from '@extension/storage';

// The server issues revision IDs as UUIDs in simple (32 hex digit) form.
const REVISION_ID = /^[a-f0-9]{32}$/;

interface BackupRevision {
  id: string;
  createdAt: number;
  size: number;
  sha256: string;
}

interface RemainingHistory {
  retained: number;
  latestCreatedAt?: number;
}

const requireRevisionId = (id: unknown): string => {
  if (typeof id !== 'string' || !REVISION_ID.test(id)) throw new Error('Invalid backup revision');
  return id;
};

const gzip = (text: string): Promise<ArrayBuffer> =>
  new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();

const gunzip = (data: Blob): Promise<string> =>
  new Response(data.stream().pipeThrough(new DecompressionStream('gzip'))).text();

const DIGEST = /^[a-f0-9]{64}$/;
const sha256 = async (data: ArrayBuffer): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');

const requireDigest = (value: unknown): string => {
  if (typeof value !== 'string' || !DIGEST.test(value))
    throw new Error('Backup digest is missing or invalid');
  return value;
};

const toRemaining = (value: { retained: number; latestCreatedAt: number | null }) => ({
  retained: value.retained,
  latestCreatedAt: value.latestCreatedAt ?? undefined,
});

const saveBackupRevision = async (
  backup: FullBackup,
  session: AskSession,
): Promise<BackupRevision> => {
  const body = await gzip(JSON.stringify(validateFullBackup(backup)));
  const expectedDigest = await sha256(body);
  const response = await requestAuthorized(
    '/api/backups',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/gzip' },
      body,
    },
    session,
  );
  const saved = (await response.json()) as BackupRevision;
  if (saved.size !== body.byteLength) {
    throw new Error(
      `Uploaded backup verification failed: expected ${body.byteLength} bytes, server stored ${saved.size}`,
    );
  }
  if (requireDigest(saved.sha256) !== expectedDigest) {
    throw new Error('Uploaded backup digest does not match');
  }
  return saved;
};

const listBackupRevisions = async (session?: AskSession): Promise<BackupRevision[]> => {
  const list = (await (
    await requestAuthorized('/api/backups', {}, session)
  ).json()) as BackupRevision[];
  for (const revision of list) requireDigest(revision.sha256);
  return list;
};

const readBackupRevision = async (id: unknown, session?: AskSession): Promise<FullBackup> => {
  const response = await requestAuthorized(`/api/backups/${requireRevisionId(id)}`, {}, session);
  const expectedDigest = requireDigest(response.headers.get('X-Backup-SHA256'));
  const raw = await response.arrayBuffer();
  if ((await sha256(raw)) !== expectedDigest) throw new Error('Backup digest does not match');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await gunzip(new Blob([raw])));
  } catch {
    throw new Error('Backup is damaged');
  }
  return validateFullBackup(parsed);
};

const deleteBackupRevision = async (
  id: unknown,
  session?: AskSession,
): Promise<RemainingHistory> => {
  const response = await requestAuthorized(
    `/api/backups/${requireRevisionId(id)}`,
    {
      method: 'DELETE',
    },
    session,
  );
  return toRemaining(await response.json());
};

/** The server refuses when `latestId` is no longer the newest or its payload does not verify. */
const keepLatestBackupRevision = async (
  latestId: unknown,
  session?: AskSession,
): Promise<RemainingHistory> => {
  const response = await requestAuthorized(
    '/api/backups/keep-latest',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latestId: requireRevisionId(latestId) }),
    },
    session,
  );
  return toRemaining(await response.json());
};

export {
  saveBackupRevision,
  listBackupRevisions,
  readBackupRevision,
  deleteBackupRevision,
  keepLatestBackupRevision,
};
export type { BackupRevision, RemainingHistory };
