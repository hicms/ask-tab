import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageDir = resolve(__dirname, '../../packages/mcp-bridge');
const rootVersion = (
  JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as { version: string }
).version;
const manifest = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
  private?: boolean;
  bin?: Record<string, string>;
  files?: string[];
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
  exports?: Record<string, { types?: string }>;
};

describe('asktab-mcp package', () => {
  it('is packable under the name that npx runs', () => {
    expect(manifest.name).toBe('asktab-mcp');
    expect(manifest.private).toBeUndefined();
  });

  it('shares the extension version, since each extension release ships its own bridge', () => {
    expect(manifest.version).toBe(rootVersion);
  });

  it('exposes the built entry as a bin with the package name, so npx runs it', () => {
    expect(manifest.bin).toEqual({ 'asktab-mcp': './dist/index.mjs' });
    expect(manifest.files).toContain('dist/**/*.js');
    expect(manifest.files).toContain('dist/**/*.mjs');
  });

  it('starts with a node shebang so the bin runs on macOS and Linux', () => {
    expect(readFileSync(resolve(packageDir, 'index.mts'), 'utf8')).toMatch(
      /^#!\/usr\/bin\/env node\r?\n/,
    );
  });

  it('declares the Node.js version the MCP SDK needs', () => {
    expect(manifest.engines).toEqual({ node: '>=18' });
  });

  it('has no workspace-only runtime dependencies', () => {
    for (const range of Object.values(manifest.dependencies ?? {})) {
      expect(range).not.toMatch(/^workspace:/);
    }
  });

  it('publishes the protocol file its exports map points to', () => {
    expect(manifest.exports?.['./protocol']?.types).toBe('./lib/protocol.ts');
    expect(manifest.files).toContain('lib/protocol.ts');
  });
});
