import { Buffer } from 'node:buffer';
import { log } from 'node:console';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const destinations = args.filter(arg => arg !== '--check');
if (destinations.length !== 1 || destinations[0].startsWith('--')) {
  throw new Error('Usage: node scripts/sync-site-assets.mjs <website-directory> [--check]');
}
const website = resolve(destinations[0]);
if (!(await stat(website)).isDirectory()) throw new Error('Website directory must exist.');
const { assets } = JSON.parse(await readFile(resolve(root, 'assets/manifest.json'), 'utf8'));
const sources = [];

// Validate the complete source set before updating any website files.
for (const asset of assets) {
  const bytes = await readFile(resolve(root, asset.source));
  if (
    bytes.length < 33 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.readUInt32BE(16) !== asset.width ||
    bytes.readUInt32BE(20) !== asset.height ||
    (asset.opaque && (bytes[24] !== 8 || bytes[25] !== 2))
  ) {
    throw new Error(`Invalid PNG dimensions or format: ${asset.source}`);
  }
  if (asset.derivedFrom && !bytes.equals(await readFile(resolve(root, asset.derivedFrom)))) {
    throw new Error(`Refresh ${asset.source} from ${asset.derivedFrom} before syncing.`);
  }
  if (asset.website) sources.push({ asset, bytes });
}

for (const { asset, bytes } of sources) {
  const destination = resolve(website, asset.website);
  if (check) {
    if (!bytes.equals(await readFile(destination))) {
      throw new Error(`Website asset differs from its source: ${asset.website}`);
    }
  } else {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  log(`${check ? 'Verified' : 'Synced'} ${asset.id}: ${asset.website}`);
}
