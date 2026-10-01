import { spawnSync } from 'node:child_process';
import { log } from 'node:console';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const readJson = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const version = readJson('package.json').version;
const chromeVersion = readJson('chrome-extension/package.json').version;
const bridgeVersion = readJson('packages/mcp-bridge/package.json').version;
const tag = process.argv[2] || process.env.GITHUB_REF_NAME;

if (
  process.argv.length > 3 ||
  tag !== `v${version}` ||
  chromeVersion !== version ||
  bridgeVersion !== version
) {
  throw new Error(
    `Release tag must be v${version} and match chrome-extension and mcp-bridge package.json`,
  );
}

const rawServiceUrl = process.env.ASKTAB_RELEASE_SERVICE_URL;
let serviceUrl;
try {
  serviceUrl = new URL(rawServiceUrl);
} catch {
  throw new Error('Set ASKTAB_RELEASE_SERVICE_URL to the HTTPS service origin');
}
if (
  serviceUrl.protocol !== 'https:' ||
  !serviceUrl.hostname ||
  ['localhost', '127.0.0.1', '[::1]'].includes(serviceUrl.hostname.toLowerCase()) ||
  serviceUrl.username ||
  serviceUrl.password ||
  serviceUrl.pathname !== '/' ||
  serviceUrl.search ||
  serviceUrl.hash
) {
  throw new Error(
    'ASKTAB_RELEASE_SERVICE_URL must be an HTTPS origin without a path or credentials',
  );
}

const archiveName = `asktab-chrome-${tag}.zip`;
const envFile = join(root, '.env');
const originalEnv = existsSync(envFile) ? readFileSync(envFile) : null;
const childEnv = {
  ...process.env,
  CLI_CEB_TARGET: 'production',
  CEB_ASK_SERVICE_URL_PRODUCTION: serviceUrl.origin,
  ASKTAB_RELEASE_ARCHIVE_NAME: archiveName,
};

const runPnpm = args => {
  const pnpmCli = process.env.npm_execpath;
  const usePnpmCli = pnpmCli && existsSync(pnpmCli);
  const command = usePnpmCli
    ? process.execPath
    : process.platform === 'win32'
      ? 'pnpm.cmd'
      : 'pnpm';
  const commandArgs = usePnpmCli ? [pnpmCli, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: childEnv,
    stdio: 'inherit',
    shell: !usePnpmCli && process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`pnpm ${args.join(' ')} failed with exit code ${result.status}`);
};

try {
  if (originalEnv === null) copyFileSync(join(root, '.example.env'), envFile);
  runPnpm(['build']);
  const manifest = readJson('dist/manifest.json');
  if (manifest.manifest_version !== 3 || manifest.version !== version) {
    throw new Error('Built manifest version does not match the release tag');
  }
  runPnpm(['-F', 'zipper', 'zip']);
  runPnpm(['-F', 'asktab-mcp', 'pack', '--pack-destination', join(root, 'dist-zip')]);
} finally {
  if (originalEnv === null) {
    if (existsSync(envFile)) unlinkSync(envFile);
  } else {
    writeFileSync(envFile, originalEnv);
  }
}

const archivePath = join(root, 'dist-zip', archiveName);
if (!existsSync(archivePath) || statSync(archivePath).size === 0) {
  throw new Error(`Missing release archive: ${archivePath}`);
}
const digest = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
const checksumPath = join(root, 'dist-zip', `asktab-chrome-${tag}.sha256`);
writeFileSync(checksumPath, `${digest}  ${archiveName}\n`);

// The settings page builds the bridge URL from the extension version, so the asset name must carry the tag.
const bridgePath = join(root, 'dist-zip', `asktab-mcp-${tag}.tgz`);
renameSync(join(root, 'dist-zip', `asktab-mcp-${version}.tgz`), bridgePath);
if (statSync(bridgePath).size === 0) {
  throw new Error(`Empty MCP bridge package: ${bridgePath}`);
}
log(`Release package: ${archivePath}`);
log(`SHA-256: ${checksumPath}`);
log(`MCP bridge: ${bridgePath}`);
