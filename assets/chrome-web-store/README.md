# Chrome Web Store images

English listing assets, prepared on 2026-09-27.

| Dashboard field | File | Size |
| --- | --- | --- |
| Store icon | `icon-128x128.png` | 128 × 128 |
| Screenshots | `screenshot-chat-1280x800.png` | 1280 × 800 |
| Screenshots | `screenshot-welcome-1280x800.png` | 1280 × 800 |
| Small promotional tile | `promo-small-440x280.png` | 440 × 280 |
| Marquee promotional tile | `promo-marquee-1400x560.png` | 1400 × 560 |

Upload the two screenshots to the screenshot section. Upload each promotional tile to its matching field. All screenshots and promotional tiles are opaque, 8-bit-per-channel RGB PNG files. The icon is copied unchanged from `chrome-extension/public/icon-128.png`.

## Provenance

Screenshots were captured from the actual locally built AskTab extension in an isolated Chromium profile at a 1280 × 800 viewport. They use illustrative English conversation data and configured suggested actions. The sample assistant answer was seeded locally; it does not represent a live model run. Both screens were visually checked, with no page errors reported during capture.

Promotional artwork was created with the built-in image generation tool, using the existing AskTab icon and the real chat screenshot as references. No API/CLI image-generation fallback was used. The banner's UI is part of generated promotional artwork; the separate screenshot files are direct application captures. Final artwork was resized and exported to the exact required dimensions as 24-bit RGB PNG.

## Generation prompts

### Small promotional tile

Use case: ads-marketing. Create a polished Chrome Web Store small promotional tile for the real product AskTab, an AI chat and browser tools extension. The reference image is the existing AskTab logo, an authoritative brand identity input: retain its white chat bubble with three dots and blue-to-violet rounded-square design. Target delivery is exactly 440 x 280 pixels, landscape aspect ratio 11:7; compose for this ratio and keep all content safely within the frame. Premium, understated editorial tech design. Very light cool off-white background, a restrained soft lavender-blue luminous ribbon or glass arc in the right/background area, a crisp flat logo near upper-left, bold dark navy 'AskTab' below or beside it, ample negative space. Exact English text only: 'AskTab' and a highly legible tagline on two lines 'Your AI assistant,' / 'right in your browser.' No other words. No fake UI, no feature badges, no stars/awards, no people, no Chrome logo, no random icons, no watermark. Deliberate typographic hierarchy; the product name and tagline must remain readable at 440px wide. Professional finished marketing artwork, clean crisp edges, opaque full-bleed background. Avoid overly saturated gradients and clutter.

### Marquee promotional tile

Create a premium Chrome Web Store marquee promotional banner for AskTab. Target final canvas 1400 x 560 pixels, very wide landscape 5:2 aspect ratio. Reference 1 is the approved brand design: preserve its exact blue-violet chat-bubble icon, dark navy typography, airy cool-white background, and delicate translucent lavender glass curves. Reference 2 is an ACTUAL screenshot of AskTab and is the authoritative product UI: use this screenshot as a flat, faithful screenshot inside a clean browser-window card on the RIGHT half, without inventing features or changing UI layout. Composition: wide clear left margin, medium brand icon at upper left followed by bold large 'AskTab'; below that the exact English headline 'Your AI assistant,' on one line and 'right in your browser.' on the next. On the right, a neatly framed product screenshot with soft restrained shadow, almost straight-on, gently floating above a very subtle lavender-blue ribbon. The left text and the right screenshot should not overlap. Make excellent use of the panoramic ratio; important text safely inside edges, ample whitespace. No extra text outside the real screenshot besides 'AskTab' and 'Your AI assistant, right in your browser.' No buttons, badges, awards, Chrome logos, watermarks, people or fabricated UI. Elegant legible editorial technology marketing, visually coherent with reference 1. Opaque full-bleed background. Preserve correct English spelling. Deliver the complete finished banner.
