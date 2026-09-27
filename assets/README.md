# Public assets

[`manifest.json`](manifest.json) is the inventory for AskTab's README, website, and Chrome Web Store images. It records each source, required dimensions, intended use, and website destination. Update assets here, then sync the derived website copies; do not edit both copies independently.

| Asset | Authoritative source | Consumers |
| --- | --- | --- |
| Brand icon | [`chrome-extension/public/icon-128.png`](../chrome-extension/public/icon-128.png) | Extension, README, website; unchanged store copy |
| Chat screenshot | [`chrome-web-store/screenshot-chat-1280x800.png`](chrome-web-store/screenshot-chat-1280x800.png) | README, homepage, store |
| Welcome screenshot | [`chrome-web-store/screenshot-welcome-1280x800.png`](chrome-web-store/screenshot-welcome-1280x800.png) | Website preview, store |
| Small promotion | [`chrome-web-store/promo-small-440x280.png`](chrome-web-store/promo-small-440x280.png) | Store, 440 × 280 |
| Marquee promotion | [`chrome-web-store/promo-marquee-1400x560.png`](chrome-web-store/promo-marquee-1400x560.png) | Store and website social preview, 1400 × 560 |

The runtime icon stays in the extension's existing public directory so asset management does not change the extension build. Its store upload copy must remain byte-identical. Screenshots are actual UI captures with illustrative sample data. Promotions were generated with the built-in image tool; their provenance and prompts are in the [store asset notes](chrome-web-store/README.md).

## Sync the website

The website is maintained separately in [`hicms/hicms.github.io`](https://github.com/hicms/hicms.github.io). From this repository, run:

```powershell
node scripts/sync-site-assets.mjs D:\dev\nodejs\hicms.github.io
node scripts/sync-site-assets.mjs D:\dev\nodejs\hicms.github.io --check
```

On another machine, replace the destination with your website checkout. The script validates all PNG sizes, checks opaque 24-bit RGB requirements for store screenshots/promotions, checks the store icon copy, and copies only entries with a `website` destination. `--check` compares destination bytes without writing. It does not delete files, commit, push, or publish either repository.

Commit the source changes here, then commit the generated image changes with any related website updates in the website repository. GitHub Pages deploys its `main` branch. New or removed destinations require reviewing the website references and removing any obsolete copies explicitly.

## Maintenance

- Keep delivered store filenames stable so upload instructions and README links continue to work.
- Capture screenshots again when the public interface changes. Use sample data and remove credentials or personal conversations.
- Update the manifest and all references together when introducing another asset.
- Keep design concepts, temporary browser captures, and QA scripts outside committed public assets.
- The website's HTML/CSS/JavaScript belongs to the website repository; only shared images are synchronized here.
