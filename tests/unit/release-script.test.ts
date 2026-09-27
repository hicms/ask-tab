import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const shell = (process.platform === 'win32' ? ['pwsh', 'powershell.exe'] : ['pwsh']).find(
  command => spawnSync(command, ['-NoProfile', '-Command', 'exit 0']).status === 0,
);
const source = resolve('scripts/release.ps1');
const runner = resolve('tests/fixtures/release-gh.ps1');
const manifests = ['package.json', 'chrome-extension/package.json'];

describe.skipIf(!shell)('release script with a local Git remote', { timeout: 30_000 }, () => {
  let directory: string;
  let root: string;
  let remote: string;

  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    return result.stdout.trim();
  };

  const publish = (args: string[] = [], failure = '') => {
    const result = spawnSync(shell!, ['-NoProfile', '-File', runner, '-Publish', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, RELEASE_TEST_FAILURE: failure },
      timeout: 20_000,
    });
    return { status: result.status, output: result.stdout + result.stderr };
  };

  const assertPublished = (version: string) => {
    const head = git('rev-parse', 'HEAD');
    for (const manifest of manifests) {
      expect(JSON.parse(readFileSync(join(root, manifest), 'utf8')).version).toBe(version);
    }
    expect(git('status', '--porcelain')).toBe('');
    expect(git('rev-parse', `v${version}^{commit}`)).toBe(head);
    expect(git('ls-remote', 'origin', 'refs/heads/main')).toContain(head);
    expect(git('ls-remote', 'origin', `refs/tags/v${version}^{}`)).toContain(head);
  };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ask-tab-release-'));
    root = join(directory, 'source');
    remote = join(directory, 'origin.git');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'chrome-extension'));
    copyFileSync(source, join(root, 'scripts/release.ps1'));
    for (const manifest of manifests) {
      writeFileSync(join(root, manifest), '{\n  "name": "fixture",\n  "version": "0.1.1"\n}\n');
    }
    git('init', '-b', 'main');
    git('config', 'user.name', 'Release test');
    git('config', 'user.email', 'release@example.com');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'tag.gpgsign', 'false');
    git('config', 'core.hooksPath', join(directory, 'no-hooks'));
    git('init', '--bare', remote);
    git('remote', 'add', 'origin', remote);
    git('add', '.');
    git('commit', '-m', 'Initial source');
    git('tag', 'v0.1.1');
    git('push', 'origin', 'main', 'refs/tags/v0.1.1');
  });

  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('increments the patch, commits both manifests and publishes the new commit/tag on each run', () => {
    const originalTag = git('rev-parse', 'v0.1.1');
    for (const version of ['0.1.2', '0.1.3']) {
      const result = publish();
      expect(result, result.output).toMatchObject({ status: 0 });
      expect(result.output).toContain('Release published and verified');
      assertPublished(version);
      expect(
        git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n').sort(),
      ).toEqual([...manifests].sort());
      expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(
        `{\n  "name": "fixture",\n  "version": "${version}"\n}\n`,
      );
    }
    expect(git('rev-parse', 'v0.1.1')).toBe(originalTag);
  }, 30_000);

  it('accepts an explicit version', () => {
    const result = publish(['-Version', '0.2.0']);
    expect(result, result.output).toMatchObject({ status: 0 });
    assertPublished('0.2.0');
  });

  it('accepts an already committed explicit version without an empty commit', () => {
    for (const manifest of manifests) {
      writeFileSync(join(root, manifest), '{"version":"0.2.0"}\n');
    }
    git('add', '.');
    git('commit', '-m', 'Prepare version');
    git('push', 'origin', 'main');
    const head = git('rev-parse', 'HEAD');
    const result = publish(['-Version', '0.2.0']);
    expect(result, result.output).toMatchObject({ status: 0 });
    expect(git('rev-parse', 'HEAD')).toBe(head);
    assertPublished('0.2.0');
  });

  it.each(['banana', 'v0.2.0', '01.2.3', '0.2.0-beta.1', '0.1.0'])(
    'rejects invalid or older explicit version %s before changing files',
    version => {
      const head = git('rev-parse', 'HEAD');
      expect(publish(['-Version', version]).status).toBe(1);
      expect(git('rev-parse', 'HEAD')).toBe(head);
      expect(git('status', '--porcelain')).toBe('');
    },
  );

  it.each(['local', 'remote'])('rejects an existing %s target tag before bumping', location => {
    git('tag', 'v0.1.2');
    if (location === 'remote') {
      git('push', 'origin', 'refs/tags/v0.1.2');
      git('tag', '-d', 'v0.1.2');
    }
    const result = publish();
    expect(result.status).toBe(1);
    expect(result.output).toContain('tag v0.1.2 already exists');
    expect(git('status', '--porcelain')).toBe('');
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('0.1.1');
  });

  it('rejects uncommitted source changes', () => {
    writeFileSync(join(root, 'pending.txt'), 'User changes');
    const result = publish();
    expect(result.status).toBe(1);
    expect(result.output).toContain('working tree is not clean');
    expect(git('tag', '--list', 'v0.1.2')).toBe('');
  });

  it('rejects main that has not been pushed', () => {
    git('commit', '--allow-empty', '-m', 'Unpushed source');
    const result = publish();
    expect(result.status).toBe(1);
    expect(result.output).toContain('Local main must match origin/main');
    expect(git('status', '--porcelain')).toBe('');
  });

  it('validates release configuration before updating versions', () => {
    const result = publish([], 'config');
    expect(result.status).toBe(1);
    expect(result.output).toContain('must be an HTTPS origin');
    expect(git('status', '--porcelain')).toBe('');
    expect(git('tag', '--list', 'v0.1.2')).toBe('');
  });

  it('keeps the remote branch and tag unchanged if the atomic push is rejected', () => {
    const originalHead = git('rev-parse', 'HEAD');
    git('--git-dir', remote, 'config', 'receive.denyCurrentBranch', 'refuse');
    git('--git-dir', remote, 'config', 'core.bare', 'false');
    git('--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    const result = publish();
    expect(result.status).toBe(1);
    expect(result.output).toContain('git push --atomic origin main refs/tags/v0.1.2');
    expect(git('ls-remote', 'origin', 'refs/heads/main')).toContain(originalHead);
    expect(git('ls-remote', 'origin', 'refs/tags/v0.1.2')).toBe('');
    expect(git('rev-parse', 'v0.1.2^{commit}')).toBe(git('rev-parse', 'HEAD'));
  });

  it.each([
    ['workflow', 'release workflow failed'],
    ['asset', 'is missing asktab-chrome-v0.1.2.sha256'],
  ])('reports %s failures after publishing refs', (failure, message) => {
    const result = publish([], failure);
    expect(result.status).toBe(1);
    expect(result.output).toContain(message);
    expect(result.output).not.toContain('Release published and verified');
    assertPublished('0.1.2');
  });
});
