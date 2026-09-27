import { uploadWebStore } from '../../scripts/upload-webstore.mjs';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { getAccessToken, authOptions, sleep } = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  authOptions: vi.fn(),
  sleep: vi.fn(),
}));
vi.mock('google-auth-library', () => ({
  JWT: class {
    constructor(options: unknown) {
      authOptions(options);
    }
    getAccessToken() {
      return getAccessToken();
    }
  },
}));
vi.mock('node:timers/promises', () => ({ setTimeout: sleep }));

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const credentials = JSON.stringify({
  type: 'service_account',
  client_email: 'release@example.iam.gserviceaccount.com',
  private_key: 'TEST_PRIVATE_KEY',
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const success = () =>
  response({ itemId: extensionId, crxVersion: '0.1.3', uploadState: 'SUCCEEDED' });

describe('Chrome Web Store draft upload', () => {
  let directory: string;
  let archive: Buffer;
  const fetchMock = vi.fn<typeof fetch>();
  const options = () => ({
    tag: 'v0.1.3',
    directory,
    publisherId: 'test-publisher',
    extensionId,
    credentialsJson: credentials,
  });
  const writeArchive = async (version = '0.1.3') => {
    archive = await new JSZip()
      .file('manifest.json', JSON.stringify({ manifest_version: 3, version }))
      .generateAsync({ type: 'nodebuffer' });
    writeFileSync(join(directory, 'asktab-chrome-v0.1.3.zip'), archive);
    writeFileSync(
      join(directory, 'asktab-chrome-v0.1.3.sha256'),
      `${createHash('sha256').update(archive).digest('hex')}  asktab-chrome-v0.1.3.zip\n`,
    );
  };

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'ask-tab-webstore-'));
    vi.clearAllMocks();
    fetchMock.mockReset();
    sleep.mockReset().mockResolvedValue(undefined);
    getAccessToken.mockReset().mockResolvedValue({ token: 'TEST_ACCESS_TOKEN' });
    vi.stubGlobal('fetch', fetchMock);
    await writeArchive();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it('uploads the exact verified ZIP with the Web Store scope and never calls publish', async () => {
    fetchMock.mockResolvedValueOnce(success());
    await expect(uploadWebStore(options())).resolves.toEqual({ extensionId, version: '0.1.3' });
    expect(authOptions).toHaveBeenCalledWith({
      email: 'release@example.iam.gserviceaccount.com',
      key: 'TEST_PRIVATE_KEY',
      scopes: ['https://www.googleapis.com/auth/chromewebstore'],
      transporterOptions: { timeout: 30_000 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://chromewebstore.googleapis.com/upload/v2/publishers/test-publisher/items/${extensionId}:upload`,
    );
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: 'Bearer TEST_ACCESS_TOKEN', 'Content-Type': 'application/zip' },
      body: archive,
    });
  });

  it.each(['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'])(
    'polls %s until processing succeeds',
    async state => {
      fetchMock
        .mockResolvedValueOnce(response({ itemId: extensionId, uploadState: state }))
        .mockResolvedValueOnce(
          response({ itemId: extensionId, lastAsyncUploadState: 'IN_PROGRESS' }),
        )
        .mockResolvedValueOnce(
          response({ itemId: extensionId, lastAsyncUploadState: 'SUCCEEDED' }),
        );
      await expect(uploadWebStore(options())).resolves.toEqual({ extensionId, version: '0.1.3' });
      expect(sleep).toHaveBeenCalledTimes(2);
      for (const [url, init] of fetchMock.mock.calls.slice(1)) {
        expect(url).toBe(
          `https://chromewebstore.googleapis.com/v2/publishers/test-publisher/items/${extensionId}:fetchStatus`,
        );
        expect(init?.method).toBeUndefined();
      }
    },
  );

  it('rejects a checksum mismatch before authentication or upload', async () => {
    writeFileSync(join(directory, 'asktab-chrome-v0.1.3.zip'), 'corrupted');
    await expect(uploadWebStore(options())).rejects.toThrow('SHA-256');
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a different manifest version before authentication', async () => {
    await writeArchive('0.1.2');
    await expect(uploadWebStore(options())).rejects.toThrow('match the release tag');
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it.each([
    { extensionId: '' },
    { publisherId: '../wrong' },
    { tag: '../bad' },
    { credentialsJson: '{"private_key":"SECRET_BROKEN_JSON' },
  ])('rejects incomplete/invalid configuration without leaking keys', async overrides => {
    const error = await uploadWebStore({ ...options(), ...overrides }).catch(
      (value: Error) => value,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain('SECRET_BROKEN_JSON');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not log credential details from an authentication failure', async () => {
    getAccessToken.mockRejectedValueOnce(new Error(`Failed: ${credentials}`));
    await expect(uploadWebStore(options())).rejects.toThrow('Google authentication failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops on HTTP errors without retrying uploads or echoing response secrets', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: { message: 'TEST_ACCESS_TOKEN' } }, 403));
    await expect(uploadWebStore(options())).rejects.toThrow('HTTP 403');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['FAILED', 'NOT_FOUND', 'UPLOAD_STATE_UNSPECIFIED', undefined])(
    'fails closed on upload state %s',
    async uploadState => {
      fetchMock.mockResolvedValueOnce(response({ itemId: extensionId, uploadState }));
      await expect(uploadWebStore(options())).rejects.toThrow('did not confirm');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a successful response for the wrong version or item', async () => {
    fetchMock.mockResolvedValueOnce(
      response({ itemId: extensionId, crxVersion: '0.1.2', uploadState: 'SUCCEEDED' }),
    );
    await expect(uploadWebStore(options())).rejects.toThrow('uploaded version');
    fetchMock.mockResolvedValueOnce(
      response({ itemId: 'wrong-item', crxVersion: '0.1.3', uploadState: 'SUCCEEDED' }),
    );
    await expect(uploadWebStore(options())).rejects.toThrow('requested extension');
  });

  it('bounds asynchronous polling and never resends the upload', async () => {
    const now = Date.now();
    fetchMock
      .mockResolvedValueOnce(response({ itemId: extensionId, uploadState: 'IN_PROGRESS' }))
      .mockResolvedValueOnce(
        response({ itemId: extensionId, lastAsyncUploadState: 'IN_PROGRESS' }),
      );
    sleep.mockImplementationOnce(async () => {
      vi.spyOn(Date, 'now').mockReturnValue(now + 310_000);
    });
    await expect(uploadWebStore(options())).rejects.toThrow('timed out');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
