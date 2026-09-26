/**
 * Tests for manifest-parser/impl.ts — Firefox manifest conversion.
 *
 * These tests verify the current behavior AND the upcoming Firefox compatibility
 * changes (filtering sidePanel/debugger permissions, removing oauth2).
 * Tests marked "Firefox compat" will fail until the implementation is updated.
 */
import { ManifestParserImpl } from './impl.js';
import { describe, it, expect } from 'vitest';
import type { ManifestType } from '@extension/shared';

/** Minimal manifest matching AskTab's actual manifest.ts structure */
const buildTestManifest = (overrides?: Partial<ManifestType>): ManifestType =>
  ({
    manifest_version: 3,
    name: 'TestExtension',
    version: '1.0.0',
    permissions: [
      'storage',
      'scripting',
      'tabs',
      'notifications',
      'sidePanel',
      'alarms',
      'debugger',
      'identity',
      'declarativeNetRequest',
    ],
    background: {
      service_worker: 'background.js',
      type: 'module' as const,
    },
    side_panel: {
      default_path: 'side-panel/index.html',
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; img-src 'self' https: data: blob:",
    },
    oauth2: {
      client_id: 'test-client-id.apps.googleusercontent.com',
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    },
    action: {
      default_icon: {
        '16': 'icon-16.png',
        '32': 'icon-32.png',
      },
    },
    sidebar_action: {
      default_panel: 'side-panel/index.html',
      default_title: 'TestExtension',
    },
    ...overrides,
  }) as ManifestType;

const parseResult = (manifest: ManifestType, isFirefox: boolean): Record<string, unknown> =>
  JSON.parse(ManifestParserImpl.convertManifestToString(manifest, isFirefox));

describe('ManifestParserImpl — Firefox conversion', () => {
  it('removes sidePanel and debugger from permissions', () => {
    const manifest = buildTestManifest();
    const result = parseResult(manifest, true);
    const permissions = result.permissions as string[];

    expect(permissions).not.toContain('sidePanel');
    expect(permissions).not.toContain('debugger');
  });

  it('keeps supported Firefox permissions', () => {
    const manifest = buildTestManifest();
    const result = parseResult(manifest, true);
    const permissions = result.permissions as string[];

    expect(permissions).toContain('storage');
    expect(permissions).toContain('scripting');
    expect(permissions).toContain('tabs');
    expect(permissions).toContain('notifications');
    expect(permissions).toContain('alarms');
    expect(permissions).toContain('identity');
    expect(permissions).toContain('declarativeNetRequest');
  });

  it('deletes oauth2 key', () => {
    const manifest = buildTestManifest();
    const result = parseResult(manifest, true);

    expect(result.oauth2).toBeUndefined();
  });

  it('deletes side_panel key', () => {
    const manifest = buildTestManifest();
    const result = parseResult(manifest, true);

    expect(result.side_panel).toBeUndefined();
  });

  it('converts service_worker to scripts array', () => {
    const manifest = buildTestManifest();
    const result = parseResult(manifest, true);
    const background = result.background as {
      scripts?: string[];
      service_worker?: string;
      type?: string;
    };

    expect(background.scripts).toEqual(['background.js']);
    expect(background.service_worker).toBeUndefined();
    expect(background.type).toBe('module');
  });

  it('preserves sidebar_action for Firefox', () => {
    const manifest = buildTestManifest();
    const result = parseResult(manifest, true);

    expect(result.sidebar_action).toBeDefined();
    const sidebar = result.sidebar_action as {
      default_panel: string;
      default_icon?: Record<string, string>;
    };
    expect(sidebar.default_panel).toBe('side-panel/index.html');
    expect(sidebar.default_icon).toEqual({ '16': 'icon-16.png', '32': 'icon-32.png' });
  });

  it('replaces CSP with Firefox-compatible version (no img-src)', () => {
    const manifest = buildTestManifest();
    const result = parseResult(manifest, true);
    const csp = result.content_security_policy as { extension_pages: string };

    expect(csp.extension_pages).toBe("script-src 'self'; object-src 'self'");
    expect(csp.extension_pages).not.toContain('img-src');
  });

  it('overrides name to use extensionShortName for Firefox', () => {
    const manifest = buildTestManifest();
    const result = parseResult(manifest, true);

    expect(result.name).toBe('__MSG_extensionShortName__');
  });

  it('uses extensionShortName for sidebar_action default_title', () => {
    const manifest = buildTestManifest();
    const result = parseResult(manifest, true);
    const sidebar = result.sidebar_action as { default_title: string };

    expect(sidebar.default_title).toBe('__MSG_extensionShortName__');
  });
});

describe('ManifestParserImpl — Chrome passthrough', () => {
  it('returns manifest unchanged when isFirefox=false', () => {
    const manifest = buildTestManifest();
    const result = parseResult(manifest, false);

    // Chrome keeps all permissions
    const permissions = result.permissions as string[];
    expect(permissions).toContain('sidePanel');
    expect(permissions).toContain('debugger');

    // Chrome keeps oauth2
    expect(result.oauth2).toBeDefined();

    // Chrome keeps side_panel
    expect(result.side_panel).toBeDefined();

    // Chrome keeps service_worker
    const background = result.background as { service_worker?: string };
    expect(background.service_worker).toBe('background.js');

    // Chrome sidebar_action is unchanged (no default_icon injected)
    const sidebar = result.sidebar_action as {
      default_panel: string;
      default_title: string;
      default_icon?: unknown;
    };
    expect(sidebar.default_panel).toBe('side-panel/index.html');
    expect(sidebar.default_title).toBe('TestExtension');
    expect(sidebar.default_icon).toBeUndefined();
  });
});
