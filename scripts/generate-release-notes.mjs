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
  if (/^(feat(?:\([^)]*\))?!?:|add\b|新增|添加|支持)/i.test(subject)) return '新功能';
  if (/^(fix(?:\([^)]*\))?!?:|fix\b|修复)/i.test(subject)) return '问题修复';
  if (
    /^(?:perf|refactor)(?:\([^)]*\))?!?:|^(?:improve|optimize|speed up|simplify|replace)\b|^(?:优化|改进)/i.test(
      subject,
    )
  ) {
    return '优化与调整';
  }
  if (/^(?:build|ci|chore|docs|test|style)(?:\([^)]*\))?!?:/i.test(subject)) return '构建与维护';
  return '其他更新';
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
    ['新功能', '问题修复', '优化与调整', '构建与维护', '其他更新'].map(name => [name, []]),
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
    `## ${tag} 更新日志`,
    '',
    `${date} · ${previous ? `${previous} → ${tag}` : '首次发布'} · ${count} 项提交更新`,
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
  if (!count) lines.push('本版本没有新增的功能或修复提交。', '');
  lines.push(
    previous
      ? `[完整变更对比](${repo}/compare/${previous}...${tag})`
      : `[完整提交记录](${repo}/commits/${tag})`,
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
