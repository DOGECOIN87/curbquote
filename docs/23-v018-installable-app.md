# 23 — CurbQuote v0.18: an installable app, the logo animations and a closer match to the mock-ups

## Installable app (PWA)

The site can be added to a phone, tablet or desktop home screen and opens full screen, like an app.

- **`manifest.webmanifest`.** "Alco Exterior Studio", standalone display, the forest theme colour and
  192, 512 and maskable 512 icons. All its URLs are relative, so it also works from the GitHub Pages
  sub-path.
- **`sw.js`, the service worker.** Once someone has visited, the studio opens offline.
  - Pages, scripts and styles come from the network first, so a deploy shows at once. The cached copy
    answers only when the network fails.
  - Fonts, brand images, models and the MapLibre and Three.js runtimes come from the cache and
    refresh in the background.
  - API calls, other origins, range requests and the large Cesium runtime are never cached.
  - Changing `CACHE` in `sw.js` clears old caches. It is served `no-cache`, so browsers pick up a new
    worker straight away.
- **Install the app.** Browsers that offer an install prompt (Chrome, Edge, Android) add an "Install the
  app" item to the account menu. iPhone and iPad Safari get the Add to Home Screen steps there instead.
  Neither appears once the app is installed.
- **iOS.** `apple-mobile-web-app-*` meta tags, a 180 px touch icon and an opaque black status bar, so
  the dark header is never drawn under it.
- **Automated browsers.** The worker is not registered when `navigator.webdriver` is set, so the
  Playwright suites keep their request routing.

## Icons drawn by code

Every favicon and app icon comes from `assets/brand/icon.svg`, rendered by `npm run build:icons`
(`scripts/build-icons.mjs`). The SVG places the original Alco logo file, unaltered, cropped above its
tagline and centred on the logo's own green (`#102204`). The maskable icon scales the mark into
Android's 80% safe zone. The PNGs are committed because browsers and iOS need bitmaps.

## The logo swoosh

A band of light glides along the lime swoosh under "ALCO" in the header. It runs on load, then every
6.5 seconds, and again on hover or keyboard focus. The logo image is unchanged: the light is a CSS layer
clipped to the swoosh's triangle, measured from the 300 × 176 logo file. With reduced motion, the
layer is hidden.

## Searching an address

While an address is looked up, the Alco logo replaces the old grid background, the crosshair-and-house
target icon and the thirds grid. The logo rises in, a lime glow breathes behind it, and the header's
light sweeps along its swoosh every 1.8 seconds. "Finding your place…" and its line sit below, lifted
clear of the estimate card. The empty and "Let's find your place" states are unchanged. With reduced
motion, the logo is shown still.

## Studio layout, closer to the mock-ups

- **Desktop "Your project" panel.** It is now 348 px wide, as in the mock-up, and its spacing is
  tighter, so Continue fits without scrolling at 1280 × 800 (it used to need a short scroll). The
  material bar's dropdown shrinks to fit the narrower canvas.
- **Phone header.** "Step 2 of 5 · Project" now fits in full at 390 px beside the step dots. The dots
  keep their 44 px targets.
- **Phone project sheet.** The illustrative range and its "Confirm your home details" line stay pinned
  just above Continue, as in the mock-up. The disclaimer sits just above the range card, and opening the
  ⓘ breakdown unpins the card so it can grow.

The 3D camera framing is unchanged. Zooming out shows more lawn rather than the mock-up's sky,
because the concept camera looks down from above.

## Small screens

An audit at 320 × 568, 360 × 640, 375 × 667 and 667 × 375 (landscape) measured how much of the screen
each bar, sheet and dialog covered. On short phones the header and the sticky price bar took 254 of
568 px. On Steps 3–4 two rows of 3D controls then covered most of what was left of the house. In
landscape, the bar and the controls hid almost all of it. Phones under 740 px tall now get:

- **The price and Continue in one row.** The sticky footer is now 64 px instead of 148 px. On the
  narrowest phones the range wraps rather than being cut off.
- **One row of 3D controls.** Zoom buttons are hidden, because pinching zooms. On Steps 3–4 the
  Rotate label is hidden too, because dragging turns the house.
- **A header 8 px shorter.** Every target is still 44 px.
- **An unpinned range in the project sheet.** The card no longer covers the sheet's content, and its
  range shrinks so it stays on one line.
- **On Step 1, no lead paragraph,** and at 320 px the typical-home range wraps.
- **A full-width Saved projects dialog,** whose name field and Save button stack below 420 px.

**Phones on their side** (under 500 px tall) show the house on the left and the studio on the right,
under a one-row header. The project sheet opens on the right, below the header.
