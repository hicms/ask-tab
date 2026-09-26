import type { IManifestParser } from './types.js';
import type { ManifestType } from '@extension/shared';

const convertToFirefoxCompatibleManifest = (manifest: ManifestType) => {
  const manifestCopy = {
    ...manifest,
  } as { [key: string]: unknown };

  if (manifest.background?.service_worker) {
    manifestCopy.background = {
      scripts: [manifest.background.service_worker],
      type: 'module',
    };
  }
  if (manifest.options_page) {
    manifestCopy.options_ui = {
      page: manifest.options_page,
      browser_style: false,
    };
  }
  manifestCopy.content_security_policy = {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  };
  manifestCopy.permissions = (manifestCopy.permissions as string[]).filter(
    value => !['sidePanel', 'offscreen', 'debugger'].includes(value),
  );

  // Use shorter name for Firefox (Mozilla enforces ≤50 char limit)
  manifestCopy.name = '__MSG_extensionShortName__';

  delete manifestCopy.options_page;
  delete manifestCopy.side_panel;
  delete manifestCopy.oauth2;

  // Add Firefox sidebar_action (replaces Chrome's side_panel)
  if (manifest.side_panel && typeof manifest.side_panel === 'object') {
    const sidePanel = manifest.side_panel as { default_path?: string };
    const action = manifest.action as { default_icon?: Record<string, string> } | undefined;
    manifestCopy.sidebar_action = {
      default_panel: sidePanel.default_path ?? 'side-panel/index.html',
      default_title: '__MSG_extensionShortName__',
      ...(action?.default_icon ? { default_icon: action.default_icon } : {}),
    };
  }

  return manifestCopy as ManifestType;
};

export const ManifestParserImpl: IManifestParser = {
  convertManifestToString: (manifest, isFirefox) => {
    if (isFirefox) {
      manifest = convertToFirefoxCompatibleManifest(manifest);
    }

    return JSON.stringify(manifest, null, 2);
  },
};
