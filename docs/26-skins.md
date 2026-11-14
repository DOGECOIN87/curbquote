# 26 — Skins: one folder per company

The estimator is no longer tied to Alco. Everything that makes it a company's own lives in one
folder in `skins/`: the names, links, logo, colours, offices, service area and product lines. Alco's
skin is `skins/alco/`; `skins/example/` is a made-up company that proves nothing else names Alco.

## Switch skins

```bash
npm run skin                 # list the skins, check each one, mark the one in use
npm run skin -- example      # switch to skins/example after checking it
SKIN=example npm run dev     # preview a skin without switching
```

`brand.js` names the skin in use in one line, and `npm run skin -- <name>` rewrites that line. A
skin with problems is refused, with each problem in a plain sentence.

## Make a new skin

1. Copy `skins/example/` to `skins/<name>/` (lowercase letters, digits and dashes).
2. In `skin.js`, set `id` to the folder name and change every value.
3. Put the logo files in the folder: `logo.src` for light backgrounds, `logo.onDark` for the dark
   header (PNG, WebP, SVG or JPEG), and set `logo.width` and `logo.height` to the image's size.
4. Run `npm run build:icons -- <name>` to draw the favicon and app icons. With an `icon.svg` in the
   folder, the icons are drawn from it; without one, the dark-background logo is centred on the
   skin's dark colour.
5. Run `npm run skin` to check it, then `npm run skin -- <name>` and `npm run check`.

## What a skin holds

| Key | What it sets |
|---|---|
| `company` | Name, short name, legal name, website, terms and privacy links, trust line |
| `app` | The installed app's name, short name and page title |
| `logo` | Logo files and size; `compactCrop` (share of the logo's height phones show, for a tagline to cut off); `shine` (the CSS polygon the light sweeps along, or left out for none) |
| `colors` | `dark` (header and rail), `primary` (buttons and links), `accent` (highlights). Every other shade is worked out from these three; `tokens` pins any shade exactly |
| `fonts` | Optional: `body` and `accent` font lists, and `.woff2` files in the folder |
| `offices` | Name, phone as shown, digits to dial; an office with `states` answers for those states, the first answers for the rest |
| `serviceArea` | Optional: the area in words, states served everywhere, listed communities and nearby ZIP prefixes |
| `catalog` | Version name, and a name and `[low, high]` rate for each product choice the studio offers |

The studio offers fixed choices per trade (siding: `fiber`, `vinyl`; windows: `fiberglass`,
`wood`, `vinyl`; doors: `fiberglass`, `steel`, `wood`; roofing: `architectural`; gutters:
`seamless`). A skin names and prices each; the first of each trade is its default.

## Colour checks

Three colours are enough, but not every three colours work. The check (`skin-theme.js`) measures
contrast with the WCAG formula and refuses a skin where, for example, button text or links would be
hard to read. Text on the primary and accent colours turns white or dark on its own, whichever
reads better.

## How it works

- `lib/skin.mjs` makes, from the skin in use, the colour stylesheet (`skin.css`), the app manifest,
  the page with every `{{mark}}` in `index.html` filled in, and the service worker's file list. The
  development server and the build both use it, so they can't drift apart.
- `styles.css` defines no brand colour. Each one comes from `skin.css`, with an `-rgb` twin for
  see-through shades: `rgba(var(--lime-rgb),.5)`.
- Scripts read names and colours from `brand.js`: `BRAND` is the skin, `THEME` its colour tokens
  for canvases and maps.
- The service worker's cache name carries a fingerprint of the skin, so a rebrand replaces what
  installed phones have cached.
- A build ships only the skin in use: its folder, and its images copied to `assets/brand/`.

## Phones

The November 2026 complaint was that phones were crowded with overlapping windows. This pass:

- **Step 1 map:** the four arrow buttons are gone on phones (tapping the photo centres it); zoom
  and Recenter sit on glass like the other controls.
- **3D label:** one line ("Style variant — approximate"); the rest of the sentence stays for screen
  readers.
- **Price and send:** the button says "Send to Alco" on phones, so the price beside it stays on one
  line; on a phone on its side the price wraps rather than being cut off.
- **Project sheet:** the "Illustrative sample estimate" label no longer slides under the price.
- **Phone on its side:** the choices panel shows one select per row instead of three cut-off ones,
  and the found-address cards keep to a readable width.

## Verification

- `npm run check`: 146 Node tests and the build pass; `tests/skin.test.js` covers the checks, the
  colour maths, the filled-in page for both skins, a build for another skin and the preview server.
- `npm run test:browser` and the layout sweep (`npm run test:layouts`, or `SKIN=example npm run
  test:layouts` for another skin).
