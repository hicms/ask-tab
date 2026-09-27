# AskTab

AskTab is an open-source browser extension for AI chat and browser-based tools. Its interface runs in a side panel or full-page view. Remote model requests go through a separate AskTab service, which manages accounts, model configuration, and upstream credentials.

Repository: https://github.com/hicms/ask-tab.git

## What is in this repository

- A Manifest V3 browser extension built with React, TypeScript, Vite, and Turborepo
- Chat, agents, workspace files, memory, browser tools, messaging channels, and voice features
- On-device model and media processing components
- Source code for the extension, tests, and documentation

The AskTab service is **not included** in this repository. A reachable service with configured models is required for account sign-in and remote AI features. The extension does not ask users to enter upstream model API keys.

## Build and run

Requirements: Node.js 22.15.1 or newer, pnpm 10.11.0, and `bash` available for the project scripts.

```bash
pnpm install --frozen-lockfile
```

The install script creates `.env` from `.example.env` when needed. Set `CEB_ASK_SERVICE_URL_DEVELOPMENT` and `CEB_ASK_SERVICE_URL_TEST` there to the two AskTab service URLs. Both currently use `http://127.0.0.1:37817`; change either value independently when its service address is known. Do not commit `.env` or credentials.

```bash
pnpm build
```

On Windows, choose the service environment at build time:

```powershell
.\scripts\build.ps1
.\scripts\build.ps1 -Environment test
.\scripts\build.ps1 -Full
.\scripts\build.ps1 -Environment test -Full
```

By default, `build.ps1` quickly rebuilds only the background script for the development service. Use `-Environment test` to select the test service. Run `-Full` first for the same environment, after changing page or shared UI code, or when switching environments. Full builds produce a local bundle in `dist/`; they do not publish a release. `pnpm build` uses the development service URL by default.

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the generated `dist/` directory. Sign in to the AskTab service and select a model in the extension.

For a Firefox build, run `pnpm build:firefox` and load the generated extension through `about:debugging`.

## Development

| Command | Purpose |
|---|---|
| `pnpm dev` | Build and watch the Chrome extension |
| `pnpm build` | Create a production build in `dist/` |
| `pnpm test` | Run unit tests after building workspace packages |
| `pnpm test:e2e` | Run the optional extension startup smoke test after a build |
| `pnpm quality` | Run lint, formatting, type checks, and unit tests |
| `pnpm zip` | Build and create a Chrome ZIP in `dist-zip/` |

### Package or publish a Chrome release

Set the HTTPS origin of the AskTab service that the release should use, then package a tag that matches the versions in the root and `chrome-extension/package.json`:

```powershell
$env:ASKTAB_RELEASE_SERVICE_URL = 'https://asktab.example.com'
pnpm release:package v0.1.1
```

The command builds the Chrome extension and writes `asktab-chrome-v0.1.1.zip` and `asktab-chrome-v0.1.1.sha256` to `dist-zip/`. It checks the built manifest version and restores the local `.env` after packaging. It packages files locally; it does not create a Git tag or GitHub Release.

For an automated GitHub release, set the repository Actions variable `ASKTAB_RELEASE_SERVICE_URL` to the production HTTPS service origin. Commit and push your source changes, then run this from a clean `main` branch:

```powershell
.\scripts\release.ps1 -Publish

# Or choose an explicit version:
.\scripts\release.ps1 -Publish -Version 0.2.0
```

Without `-Version`, the script increments the current `package.json` patch version by one (for example, `0.1.1` becomes `0.1.2`). An explicit version must use `major.minor.patch` and cannot be lower than the current version; it may match an already committed version if the tag is unused. The script verifies that `main` matches `origin/main`, checks the target tag and release configuration, updates the root and Chrome extension package versions, and commits the version change. It pushes `main` and the new tag atomically to trigger the [release workflow](.github/workflows/release.yml), then waits for the workflow and confirms that the GitHub Release contains both the ZIP and checksum. If the push fails, it retains the local commit and tag and prints the push command to retry after resolving the error.

The workflow builds workspace packages before running checks, then builds with the production service URL. A missing service URL stops the workflow before checks. The URL is embedded in the extension; the build does not contact the service, so deploy it before expecting service-backed features to work. Run `.\scripts\release.ps1 -Help` to see its usage.

The monorepo contains `chrome-extension/` for the background worker and manifest, `pages/` for extension views, `packages/` for shared modules, and `tests/` for integration and end-to-end coverage. See [installation](docs/start/installation.md), [development](docs/development/index.md), and the [documentation index](docs/index.md) for details.

## Data and permissions

Chat history and settings are stored in the browser. Remote AI requests and optional account backups use the configured AskTab service. Browser automation, messaging channels, and Google integrations use additional browser permissions; the requested permissions are declared in `chrome-extension/manifest.ts`. Review the permissions and data flows before distributing a build.

## License

AskTab is licensed under the [MIT License](LICENSE). Notices for bundled third-party code are in [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES).
