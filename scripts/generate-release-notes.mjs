import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const releaseTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const escapeMarkdown = text => text.replace(/[\\`*_[\]<>]/g, '\\$&');
const isOlder = (candidate, target) => {
  const left = candidate.slice(1).split('.').map(Number);
  const right = target.slice(1).split('.').map(Number);
  const differing = left.findIndex((part, index) => part !== right[index]);
  return differing !== -1 && left[differing] < right[differing];
};

const categoryFor = subject => {
  if (/^(feat(?:\([^)]*\))?!?:|add\b|新增|添加|支持)/i.test(subject)) return 'Features';
  if (/^(fix(?:\([^)]*\))?!?:|fix\b|修复)/i.test(subject)) return 'Fixes';
  if (
    /^(?:perf|refactor)(?:\([^)]*\))?!?:|^(?:improve|optimize|speed up|simplify|replace)\b|^(?:优化|改进)/i.test(
      subject,
    )
  ) {
    return 'Improvements';
  }
  if (/^(?:build|ci|chore|docs|test|style)(?:\([^)]*\))?!?:/i.test(subject))
    return 'Build & Maintenance';
  return 'Other Changes';
};

const generate = () => {
  const [tag, output] = process.argv.slice(2);
  if (process.argv.length !== 4 || !releaseTag.test(tag)) {
    throw new Error('Usage: node scripts/generate-release-notes.mjs vX.Y.Z <output.md>');
  }
  if (git('rev-parse', '--is-shallow-repository').trim() === 'true') {
    throw new Error('Release notes require complete history. Fetch all history and tags first.');
  }
  git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);

  const previous = git('tag', '--merged', `refs/tags/${tag}`, '--sort=-version:refname')
    .trim()
    .split('\n')
    .find(candidate => releaseTag.test(candidate) && isOlder(candidate, tag));
  const range = previous ? `refs/tags/${previous}..refs/tags/${tag}` : `refs/tags/${tag}`;
  const fields = git(
    'log',
    '--reverse',
    '--no-merges',
    '-z',
    '--format=%H%x00%s%x00%b',
    range,
    '--',
  ).split('\0');
  const groups = new Map(
    ['Features', 'Fixes', 'Improvements', 'Build & Maintenance', 'Other Changes'].map(name => [
      name,
      [],
    ]),
  );
  let count = 0;
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const [hash, subject, body] = fields.slice(index, index + 3);
    if (/^Release v\d+\.\d+\.\d+$/.test(subject) && !body.trim()) continue;
    groups.get(categoryFor(subject)).push({ hash, subject, body: body.trim() });
    count++;
  }

  const root = git('rev-parse', '--show-toplevel').trim();
  const { repository } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const repositoryUrl = process.env.GITHUB_REPOSITORY
    ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}`
    : typeof repository === 'string'
      ? repository
      : repository.url;
  const url = new URL(repositoryUrl.replace(/^git\+/, '').replace(/\.git$/, ''));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Release notes require an HTTPS repository URL without credentials.');
  }
  const repo = url.href.replace(/\/$/, '');
  const date = git('show', '-s', '--format=%cs', `refs/tags/${tag}^{commit}`).trim();
  const lines = [
    "## What's Changed",
    '',
    `${date} · ${previous ? `${previous} → ${tag}` : `${tag} · Initial release`} · ${count} ${count === 1 ? 'commit' : 'commits'}`,
    '',
  ];
  for (const [name, commits] of groups) {
    if (!commits.length) continue;
    lines.push(`### ${name}`, '');
    for (const { hash, subject, body } of commits) {
      lines.push(`- ${escapeMarkdown(subject)} ([${hash.slice(0, 7)}](${repo}/commit/${hash}))`);
      if (body) lines.push('', ...body.split('\n').map(line => `  > ${line}`), '');
    }
    lines.push('');
  }
  if (!count) lines.push('No additional changes beyond the version update.', '');
  lines.push(
    previous
      ? `[Full Changelog](${repo}/compare/${previous}...${tag})`
      : `[Full Commit History](${repo}/commits/${tag})`,
    '',
  );
  const archive = `asktab-chrome-${tag}.zip`;
  const checksum = `asktab-chrome-${tag}.sha256`;
  const downloads = `${repo}/releases/download/${tag}`;
  lines.push(
    '## Install / Run',
    '',
    `[Download Chrome extension (${archive})](${downloads}/${archive}) · [SHA-256 checksum](${downloads}/${checksum})`,
    '',
    '### Install and Get Started',
    '',
    '1. Download the extension ZIP above and extract it to a permanent folder.',
    '2. Open `chrome://extensions` in Chrome and enable **Developer mode** in the top-right corner.',
    '3. Click **Load unpacked** and select the extracted folder containing `manifest.json`.',
    '4. Open any webpage and click the AskTab toolbar icon. Sign in and select a model to start chatting.',
    '',
    'The release package includes the service URL. Sign-in and remote AI features require a reachable AskTab service.',
    '',
    '### Update an Existing Installation',
    '',
    'Replace the extension files in the original folder with the new version, keeping the same folder path. Then find AskTab at `chrome://extensions` and click **Reload**.',
    '',
    `[Build from source and additional installation instructions](${repo}/blob/${tag}/docs/start/installation.md)`,
    '',
  );
  writeFileSync(output, lines.join('\n'), 'utf8');
};

try {
  generate();
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
}
