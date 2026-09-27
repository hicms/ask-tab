import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const generator = resolve('scripts/generate-release-notes.mjs');

describe('commit-derived release notes', { timeout: 30_000 }, () => {
  let root: string;
  let output: string;
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    return result.stdout.trim();
  };
  const commit = (subject: string, body?: string) => {
    git('commit', '--allow-empty', '-m', subject, ...(body ? ['-m', body] : []));
    return git('rev-parse', 'HEAD');
  };
  const generate = (tag: string, repository = '') =>
    spawnSync(process.execPath, [generator, tag, output], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_REPOSITORY: repository,
        GITHUB_SERVER_URL: 'https://github.com',
      },
    });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ask-tab-notes-'));
    output = join(root, 'notes.md');
    git('init', '-b', 'main');
    git('config', 'user.name', 'Notes test');
    git('config', 'user.email', 'notes@example.com');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'tag.gpgsign', 'false');
    git('config', 'core.hooksPath', join(root, 'no-hooks'));
    writeFileSync(
      join(root, 'package.json'),
      '{"repository":{"url":"https://github.com/test/app.git"}}',
    );
    git('add', 'package.json');
    git('commit', '-m', 'Initial application');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('includes direct commits and their bodies, groups changes and omits the version commit', () => {
    git('tag', 'v0.1.1');
    const feature = commit('Add selectable icons');
    commit(
      'fix(chat): restore archived chats',
      'Preserve messages.\n\nKeep attachments available.',
    );
    commit('Speed up welcome entrance');
    commit('ci: verify release assets');
    commit('Automatically increment patch version');
    commit('Release v0.1.2');
    git('tag', '-a', 'v0.1.2', '-m', 'Release v0.1.2');
    // Future work must not leak into notes generated for an older release.
    commit('Add unreleased work');
    const result = generate('v0.1.2');
    expect(result.status, result.stderr).toBe(0);
    const notes = readFileSync(output, 'utf8');
    expect(notes).toContain('v0.1.1 → v0.1.2 · 5 项提交更新');
    expect(notes).toContain(
      `- Add selectable icons ([${feature.slice(0, 7)}](https://github.com/test/app/commit/${feature}))`,
    );
    expect(notes).toContain('  > Preserve messages.\n  > \n  > Keep attachments available.');
    for (const heading of ['新功能', '问题修复', '优化与调整', '构建与维护', '其他更新']) {
      expect(notes).toContain(`### ${heading}`);
    }
    expect(notes).not.toContain('Initial application');
    expect(notes).not.toContain('Release v0.1.2');
    expect(notes).not.toContain('unreleased work');
    expect(notes).toContain('https://github.com/test/app/compare/v0.1.1...v0.1.2');
  });

  it('includes initial history when no earlier release tag exists and uses Actions repository links', () => {
    commit('新增聊天归档');
    git('tag', 'v0.1.0');
    expect(generate('v0.1.0', 'fork/ask-tab').status).toBe(0);
    const notes = readFileSync(output, 'utf8');
    expect(notes).toContain('首次发布 · 2 项提交更新');
    expect(notes).toContain('新增聊天归档');
    expect(notes).toContain('Initial application');
    expect(notes).toContain('https://github.com/fork/ask-tab/commits/v0.1.0');
    expect(notes).not.toContain('/compare/');
  });

  it('selects the highest older reachable stable tag and ignores other tags', () => {
    git('tag', 'v0.1.8');
    commit('Old improvement');
    git('tag', 'v0.1.9');
    git('checkout', '-b', 'unrelated');
    commit('Unrelated work');
    git('tag', 'v0.1.10');
    git('checkout', 'main');
    commit('Add included feature');
    git('tag', 'v0.1.11-beta.1');
    git('tag', 'nightly');
    git('tag', 'v9.0.0');
    git('tag', 'v0.1.11');
    expect(generate('v0.1.11').status).toBe(0);
    const notes = readFileSync(output, 'utf8');
    expect(notes).toContain('v0.1.9 → v0.1.11');
    expect(notes).toContain('Add included feature');
    expect(notes).not.toContain('Old improvement');
    expect(notes).not.toContain('Unrelated work');
  });

  it('escapes Markdown in subjects while preserving commit bodies', () => {
    const hash = commit(
      'feat!: support [links] and <tags> with `code`',
      'BREAKING CHANGE: use the new setting.',
    );
    git('tag', 'v1.0.0');
    expect(generate('v1.0.0').status).toBe(0);
    const notes = readFileSync(output, 'utf8');
    expect(notes).toContain('### 新功能');
    expect(notes).toContain('support \\[links\\] and \\<tags\\> with \\`code\\`');
    expect(notes).toContain('  > BREAKING CHANGE: use the new setting.');
    expect(notes).toContain(`/commit/${hash}`);
  });

  it('includes merged feature commits without merge boilerplate', () => {
    git('tag', 'v0.1.0');
    git('checkout', '-b', 'feature');
    commit('feat: merged feature');
    git('checkout', 'main');
    commit('fix: main fix');
    git('merge', '--no-ff', 'feature', '-m', 'Merge feature');
    git('tag', 'v0.1.1');
    expect(generate('v0.1.1').status).toBe(0);
    const notes = readFileSync(output, 'utf8');
    expect(notes).toContain('feat: merged feature');
    expect(notes).toContain('fix: main fix');
    expect(notes).not.toContain('Merge feature');
  });

  it('explains a release containing only a version commit', () => {
    git('tag', 'v0.1.0');
    commit('Release v0.1.1');
    git('tag', 'v0.1.1');
    expect(generate('v0.1.1').status).toBe(0);
    expect(readFileSync(output, 'utf8')).toContain('本版本没有新增的功能或修复提交。');
  });

  it('does not filter a release subject with substantive body details', () => {
    commit('Release v0.1.1', 'Include migration instructions.');
    git('tag', 'v0.1.1');
    expect(generate('v0.1.1').status).toBe(0);
    expect(readFileSync(output, 'utf8')).toContain('Include migration instructions.');
  });

  it.each(['v0.9.0', '--all', 'v1.0.0-beta'])(
    'fails without producing notes for invalid/missing tag %s',
    tag => {
      expect(generate(tag).status).toBe(1);
      expect(existsSync(output)).toBe(false);
    },
  );

  it('rejects shallow history instead of silently generating incomplete notes', () => {
    commit('Add a feature');
    git('tag', 'v0.1.0');
    writeFileSync(join(root, '.git', 'shallow'), `${git('rev-parse', 'HEAD')}\n`);
    const result = generate('v0.1.0');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('require complete history');
    expect(existsSync(output)).toBe(false);
  });
});
