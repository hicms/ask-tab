import { JWT } from 'google-auth-library';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const api = 'https://chromewebstore.googleapis.com';
const request = async (url, options, timeout) => {
  const response = await globalThis.fetch(url, {
    ...options,
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(timeout),
  });
  if (!response.ok) {
    throw new Error(
      `Chrome Web Store API returned HTTP ${response.status}. Check API access and the Developer Dashboard.`,
    );
  }
  return response.json();
};

export const uploadWebStore = async ({
  tag,
  directory = 'dist-zip',
  publisherId,
  extensionId,
  credentialsJson,
}) => {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
    throw new Error('Specify a release tag in vX.Y.Z format.');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(publisherId || '') || !/^[a-p]{32}$/.test(extensionId || '')) {
    throw new Error(
      'Set CWS_PUBLISHER_ID and the 32-letter CWS_EXTENSION_ID from the Developer Dashboard.',
    );
  }
  const archiveName = `asktab-chrome-${tag}.zip`;
  const archive = await readFile(join(directory, archiveName));
  const checksum = (await readFile(join(directory, `asktab-chrome-${tag}.sha256`), 'utf8'))
    .trim()
    .split(/\s+/);
  if (
    checksum.length !== 2 ||
    checksum[1] !== archiveName ||
    checksum[0] !== createHash('sha256').update(archive).digest('hex')
  ) {
    throw new Error('The release ZIP does not match its SHA-256 checksum.');
  }
  const zip = await JSZip.loadAsync(archive);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('The release ZIP must contain manifest.json at its root.');
  const manifest = JSON.parse(await manifestFile.async('string'));
  const version = tag.slice(1);
  if (manifest.version !== version || manifest.manifest_version !== 3) {
    throw new Error('The release ZIP manifest must be Manifest V3 and match the release tag.');
  }

  let credentials;
  try {
    credentials = JSON.parse(credentialsJson);
    if (
      credentials.type !== 'service_account' ||
      !credentials.client_email ||
      !credentials.private_key
    )
      throw new Error();
  } catch {
    throw new Error(
      'Set CWS_SERVICE_ACCOUNT_JSON to a valid service account JSON key in GitHub Secrets.',
    );
  }
  let token;
  try {
    const auth = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/chromewebstore'],
      transporterOptions: { timeout: 30_000 },
    });
    token = (await auth.getAccessToken()).token;
    if (!token) throw new Error();
  } catch {
    throw new Error(
      'Google authentication failed. Check the service account key and API configuration.',
    );
  }

  const name = `publishers/${publisherId}/items/${extensionId}`;
  const headers = { Authorization: `Bearer ${token}` };
  let result = await request(
    `${api}/upload/v2/${name}:upload`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/zip' },
      body: archive,
    },
    120_000,
  );
  if (result.itemId !== extensionId)
    throw new Error('Upload response does not match the requested extension.');
  let state = result.uploadState;
  if (state === 'SUCCEEDED' && result.crxVersion !== version) {
    throw new Error('The uploaded version does not match the release tag.');
  }
  const deadline = Date.now() + 300_000;
  while (state === 'IN_PROGRESS' || state === 'UPLOAD_IN_PROGRESS') {
    const remaining = deadline - Date.now();
    if (remaining <= 5_000)
      throw new Error(
        'Upload processing timed out. Check the Developer Dashboard before retrying.',
      );
    await delay(5_000);
    result = await request(
      `${api}/v2/${name}:fetchStatus`,
      { headers },
      Math.min(30_000, remaining - 5_000),
    );
    if (result.itemId !== extensionId)
      throw new Error('Upload status does not match the requested extension.');
    state = result.lastAsyncUploadState;
  }
  if (state !== 'SUCCEEDED') {
    throw new Error(
      'Chrome Web Store did not confirm a successful upload. Check the Developer Dashboard before retrying.',
    );
  }
  return { extensionId, version };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3)
      throw new Error('Usage: node scripts/upload-webstore.mjs vX.Y.Z');
    const result = await uploadWebStore({
      tag: process.argv[2],
      publisherId: process.env.CWS_PUBLISHER_ID,
      extensionId: process.env.CWS_EXTENSION_ID,
      credentialsJson: process.env.CWS_SERVICE_ACCOUNT_JSON,
    });
    process.stdout.write(
      `Uploaded ${result.version} to Chrome Web Store item ${result.extensionId}. The package has not been submitted for review.\n`,
    );
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
