---
summary: "Development guide — setting up the dev environment, running tests, and contributing to AskTab."
read_when:
  - Setting up a development environment
  - Running tests
  - Understanding the build system
title: "Development"
---

# Development

AskTab is built with React 19, TypeScript, Vite 6, and Turborepo. This guide covers setting up the development environment, building, testing, and code quality.

## Prerequisites

- **Node.js** >= 22.15.1
- **pnpm** 10.x (enforced via `packageManager` field)

## Setup

```bash
cd asktab
pnpm install
```

The `postinstall` script copies `.example.env` to `.env` if it doesn't exist.

## Development mode

```bash
pnpm dev
```

This:
1. Cleans the `dist/` folder
2. Builds all packages
3. Starts Vite in watch mode via Turborepo

Load the extension from `dist/` once, then changes are picked up automatically. Reload the extension page to apply.

## Building

```bash
pnpm build           # Production build → dist/
pnpm build:firefox   # Firefox production build → dist/
pnpm zip             # Build + package as ZIP
pnpm zip:firefox     # Firefox build + ZIP
```

## Creating a Chrome ZIP

Run `pnpm zip` to build the extension and create an archive in `dist-zip/`. The archive contains `manifest.json` at its root. To install it locally, extract the ZIP, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder containing `manifest.json`.

## Testing

### Unit tests (Vitest)

```bash
pnpm test            # Run all tests
pnpm test:watch      # Watch mode
pnpm test:coverage   # With coverage report
```

Tests are located in:
- `packages/*/lib/**/*.test.ts`
- `pages/*/src/**/*.test.ts`
- `chrome-extension/src/**/*.test.ts`
- `tests/unit/**/*.test.ts`

Uses `fake-indexeddb` for storage mocks.

Tests should call the shipped implementation and assert observable behavior. A copied
algorithm, a direct call to the test's own mock, or an assertion about a literal object
does not protect against production regressions. Keep storage behavior tests with the
storage owner and component helper tests with the actual helper.

### E2E tests (Playwright)

```bash
pnpm build && pnpm test:e2e
```

E2E tests:
- Located in `tests/playwright/e2e/`
- Launch Chrome with the extension loaded from `dist/`
- Handle FirstRunSetup bypass via `helpers/setup.ts`
- Use page objects from `tests/playwright/pages/`

Establish the state named by the test and assert the resulting interaction. A page-title
check belongs in the extension loading smoke suite; it does not test chat persistence,
streaming, compaction, or attachments. Do not condition an assertion on whether the
expected UI exists. The Copilot proxy integration is opt-in via `COPILOT_API_BASE_URL`.

The current suite does not directly exercise the injected ChatGPT Sentinel flow,
automatic title generation, or the channel draft promise chain.

## Code quality

```bash
pnpm lint            # ESLint with content cache
pnpm lint:fix        # ESLint with auto-fix
pnpm lint:full       # ESLint without cache
pnpm format          # Prettier write
pnpm format:check    # Prettier check
pnpm type-check      # TypeScript strict check
pnpm quality         # Full lint + formatting + types + tests
```

ESLint checks code rules; Prettier runs separately so formatting is not calculated
twice. TypeScript's `isolatedModules` checks type-only named exports without loading
all package type graphs inside ESLint. Import, Hooks and accessibility lint rules
remain enabled for source and tests. Generated build/coverage/report/cache files are ignored.

The routine lint cache lives in `node_modules/.cache/eslint/`. Use `lint:full` after
dependency changes or when checking changes to imported modules: ESLint's file cache
does not track every cross-file rule dependency. `quality` always runs uncached lint.

## Monorepo structure

Turborepo orchestrates builds across packages:

| Package | Purpose |
|---------|---------|
| `chrome-extension` | Background service worker |
| `pages/side-panel` | Primary chat UI |
| `pages/full-page-chat` | Full-page chat mode |
| `pages/options` | Settings page |
| `pages/offscreen-channels` | Offscreen document |
| `packages/shared` | Types, hooks, prompts, env config |
| `packages/storage` | Chrome storage + IndexedDB |
| `packages/ui` | React components (shadcn/ui) |
| `packages/config-panels` | Options page tab panels |
| `packages/skills` | Skill template system |
| `packages/baileys` | WhatsApp client library |
| `packages/i18n` | Internationalization |
| `packages/env` | Build-time environment variables |
| `packages/dev-utils` | Development utilities |
| `packages/hmr` | Hot module reload for extension dev |
| `packages/tailwindcss-config` | Tailwind configuration |
| `packages/tsconfig` | Base TypeScript configs |
| `packages/vite-config` | Shared Vite configuration |
| `packages/zipper` | Extension ZIP packaging |

## Code conventions

- **TypeScript strict mode** everywhere
- **Arrow function expressions** preferred (`func-style: 'expression'`)
- **Type imports**: Use `import type { ... }` for type-only imports
- **Import order**: Local → parent → internal (@extension/*) → external → builtin → type
- **Naming**: PascalCase for components, camelCase for utils/hooks, kebab-case for filenames
- **No `any`**: Warning-level enforcement
- **Unused vars**: Prefix with `_`

## Useful commands

```bash
pnpm clean           # Clean bundles, turbo cache, node_modules
pnpm clean:install   # Clean + fresh install
pnpm update-version  # Update version in manifest + package.json
```
