# 20 — CurbQuote v0.15: professional redesign, rebuilt 3D houses and property-view fallbacks

This pass replaces the layered stylesheet with one design system, rebuilds the 3D concept-house
geometry so every home style renders correctly, adds studio options and four home styles, and makes
the property view degrade through a chain of free fallbacks until the Google Map Tiles key is live.
Estimate maths, pricing, disclosures and the "concept model, not a measurement" guardrails are
unchanged. No eyebrow labels were added.

## Step 1: the property map

Step 1 is a full-screen map in the style of the reference mock-ups: the property view fills the window
and every control floats over it in dark glass. The page frame steps aside on Step 1
(`body[data-active-step="1"]`) and returns on Steps 2–5.

1. **Arrival.** A concept house turns slowly behind the headline (the Step 3–5 renderer, drawn as a
   floating model without sky or street). The address bar sits at the bottom like a chat input, with
   the typical-home estimate above it. The model loads when the browser is idle, never with Save-Data,
   stays out of the tab order, and does not turn with reduced motion; "Pause rotation" stops it.
2. **Address found.** The bar moves to the top left as a search box. The view opens in 3D: Google 3D
   when the key is set, otherwise the key-free OpenStreetMap 3D buildings. A **measuring pass** runs:
   corner points appear, the outline draws in, dimension lines extend and their labels count up, then
   a height line rises. When the building is mapped, the numbers come from its outline (approximate);
   otherwise the card says "Illustrative dimensions". The camera then circles the building until it is
   touched. Choosing the aerial photo instead is remembered on this device; the photo gets the same
   measuring pass at the home's size, with illustrative placement.
3. **"What would you like to change?"** Plain requests ("navy siding and new windows, under $30k",
   "modern exterior with a black metal roof", "add a porch, no shutters") are read by `intent.js`, a
   small deterministic interpreter with unit tests, so it works without AI and on the static site. It
   sets the same controls Steps 2–4 use; prices always come from the estimate code, never the text.
   Describing a trade ("fiber cement siding in sage") never drops the other trades; only "replace",
   "new", "only" and similar words change the project.
4. **Proposal.** A request that changes the look opens the proposal: the concept house fills the map,
   an **Original / Proposed** switch sweeps between its Before and After versions, and the bar becomes
   "Refine this design…" with **Change materials**, **Add features** and **Estimate project** (which
   shows the live range). **Save concept** saves the project. The card at the top left says
   "Exterior preview · Concept visualization": it is the concept model, not a photo of the remodel.

Labels are sentence case throughout: the uppercase, letter-spaced captions in the mock-ups would break
the no-eyebrows rule. "Adjust landscaping" became "Add features" (porch, garage, fence, shutters,
dormers, lighting), because there are no landscaping options yet.

| Arrival | Address found | Proposal |
|---|---|---|
| ![Arrival](assets/ui-review/v015-map-arrival-desktop.png) | ![Measured](assets/ui-review/v015-map-matched-desktop.png) | ![Proposal](assets/ui-review/v015-map-proposal-desktop.png) |

On a phone: [address found](assets/ui-review/v015-map-matched-phone.png) ·
[proposal](assets/ui-review/v015-map-proposal-phone.png). The map uses the synthetic QA tiles and
building, because this sandbox cannot reach USGS or OpenFreeMap; with the Google key the view is the
photorealistic 3D city.

## Express path: fewest clicks to an estimate

The product goal is the fewest clicks and inputs from arrival to a finished estimate.

| | Inputs | Clicks to the full estimate |
|---|---|---|
| Before | 1 (address) | 4 (Next, Next, Next, See my estimate) |
| Now | 1 (address) | 1 (See my estimate) |
| Now, without an address | 0 | 1 (a typical-home range shows on arrival) |

- **Instant estimate on Step 1.** A card under the address field shows a live range for a typical home
  on arrival, and re-prices as soon as the address matches. **See my estimate** opens Step 5 directly;
  **Customize** walks through Steps 2–4. The separate "Next: your project" button is gone.
- **Automatic open-data sizing.** After a real address match, the open building outline (Microsoft
  ODbL when configured, else OpenStreetMap) fills in length, width and stories and suggests a style,
  with no confirmation click. This mode skips licensed providers and sends only the coordinate, never
  the street address. Licensed providers (EarthDefine, EagleView, ATTOM, property records) still need
  the explicit confirmation in Step 3.
- **Typed sizes win.** Once a homeowner types a length, width or story count, later automatic lookups
  never overwrite it. If the address changes, an automatic sizing is undone before the new lookup.
- Saving still pre-fills the project name from the address, so saving is two clicks with no typing.

![Step 1 after an address match](assets/ui-review/v015-express-matched-desktop.png)

[On arrival](assets/ui-review/v015-express-arrival-desktop.png) ·
[On a phone](assets/ui-review/v015-express-matched-mobile.png). These use a synthetic address match,
aerial tile and outline, because this sandbox cannot reach Census, USGS or OpenStreetMap.

## Rebuilt 3D houses

The old studio built roofs from rotated boxes. Hip roofs (Ranch, Foursquare) came out as broken,
overlapping slabs, the lawn was a disc whose edge drew a fake curved horizon, and the driveway floated
in the grass. The renderer in `remodel-3d.js` now builds:

- **Real roof planes** extruded from each style's cross-section: gable, gambrel (Dutch Colonial),
  saltbox, and a clerestory "offset shed" (Contemporary), plus true four-plane hips and a flat roof
  with a deep fascia. Each plane has thickness, so eaves show fascia boards and soffits, with gutters
  and ridge caps.
- **Cross-gable wings** (Tudor, Victorian) as their own extruded volume, a Victorian turret with a
  conical roof, gable and long shed dormers seated on the actual slope, Craftsman knee braces,
  Prairie banding, and an exterior chimney that always clears the ridge.
- **A real lot**: street, curb, sidewalk, front walk, and a driveway that leads to the garage (or
  beside the house), foundation beds, trees, and a distant tree line on a ground plane that fades into
  a sky dome instead of ending at a visible edge.
- **Lighting**: image-based lighting from the sky, soft PCF shadows fitted to the house, and neutral
  tone mapping so a homeowner's chosen siding color is not hue-shifted. The deprecated
  `PCFSoftShadowMap` warning is gone.
- **Framing** from the building's bounding sphere and the stage's aspect ratio, so every style and
  addition fits both the Step 3/4 dock and the Step 5 studio.

![All 16 styles, after](assets/ui-review/v015-styles-after.jpg)

[The same view before this pass](assets/ui-review/v015-styles-before.jpg).

## More options

| Area | Added |
|---|---|
| Home styles | Dutch Colonial (gambrel, shed dormer), Saltbox, Modern farmhouse (board and batten, metal roof, black trim), Prairie (low hip, 3 ft eaves, banding). 16 in total; each card shows a drawing generated from the style's proportions (`styleSilhouette`). |
| Siding colors | Deep navy, Forest, Warm greige, Barn red, Butter yellow, Iron black (12 in total), shown as labelled chips. The assistant's schema follows the catalog instead of a hard-coded list. |
| Roof | Covering: architectural shingles, standing-seam metal, cedar shake, barrel tile. Colors: Onyx black, Forest green and Desert sand added (7 in total). |
| Trim and masonry | Trim: style default, classic white, cream, black or bronze. Masonry accent: red brick, fieldstone or painted brick. |
| Additions | Attached two-car garage and front picket fence, alongside porch, dormers and shutters. All additions remain visual-only and never appear in Before. |
| Camera and light | Corner, Front, Side, Back, Top and Street (eye-level) views, a turntable orbit, and Midday, Golden hour, Overcast and Dusk lighting (dusk lights the windows and lanterns). |

![Studio option combinations](assets/ui-review/v015-studio-options.jpg)

Styles carry their own roof covering and masonry defaults (for example, Modern farmhouse starts with
a black metal roof); trim, lighting, garage and fence stay as the homeowner set them. None of these
options touch `estimate.js` or the price.

## Professional redesign

This section describes the first redesign pass; the property map above supersedes its Step 1 layout.

`styles.css` was several theme layers overriding each other (about 78 KB). It is now one design
system (about 61 KB): a single token set for color, radius, elevation and focus; one type scale; card
layout for every step; a connected progress stepper; a search-bar style address field; a sticky live
3D dock beside Steps 2–4; segmented controls for views, Before/After and finishes; and a grouped
Step 5 studio. Step 1 adds a three-step "how it works" summary on wide screens.

| Before | After |
|---|---|
| ![Step 1 before](assets/ui-review/v015-before-step1-desktop.png) | ![Step 1 after](assets/ui-review/v015-after-step1-desktop.png) |
| ![Step 3 before](assets/ui-review/v015-before-step3-desktop.png) | ![Step 3 after](assets/ui-review/v015-after-step3-desktop.png) |
| ![Step 5 before](assets/ui-review/v015-before-step5-desktop.png) | ![Step 5 after](assets/ui-review/v015-after-step5-desktop.png) |

Also: [Step 4 after](assets/ui-review/v015-after-step4-desktop.png) and
[Step 1 on a phone](assets/ui-review/v015-after-step1-mobile.png).

The browser QA still holds every target to 44 × 44 CSS pixels and checks for page overflow and
clipped labels on all five steps at ten viewports from 320 px to 2560 px, including maximum input
values. Two narrow-screen issues found by that matrix were fixed during this pass.

## Property-view fallback chain

Until the Google Map Tiles key is configured, and whenever Google fails at runtime, the property view
degrades in tiers so something useful always shows:

1. **Reviewed local exterior**: the Austin lidar example, for that one property.
2. **Google Photorealistic 3D Tiles** with `GOOGLE_MAP_TILES_KEY` (launch) or `CESIUM_ION_TOKEN`
   (testing). A denied root request falls back immediately. A key that runs out of quota or is
   revoked mid-visit is caught by tile-failure tracking (`property-3d.js`) and falls back too.
3. **Open 3D buildings (new, no key)**: MapLibre extrudes OpenStreetMap building heights
   (`render_height`, else a one-story guess) over the USGS aerial imagery with a tilted camera.
   **View in 3D** opens it when Google is not configured, and the Google path hands over to it on
   failure. It is also a **3D buildings** mode beside Hybrid and Map.
4. **USGS / USDA aerial photo**: still the automatic default after an address match when Google is not
   configured, because it needs no WebGL.
5. **Street map**: OpenFreeMap vector tiles, used automatically if aerial tiles fail.
6. **The homeowner's own photo**, always available.

![Open 3D buildings fallback, synthetic fixture](assets/ui-review/v015-open-3d-buildings-fallback.png)

The screenshot uses a synthetic block of buildings (this sandbox cannot reach OpenFreeMap). Real
OpenStreetMap heights vary by area; unmapped buildings show as one story.

## Backend and configuration

- `vercel.json` gives each function a budget that matches its internal deadlines: geocode 10 s,
  map3d 5 s, property 10 s, footprint 25 s and assistant 30 s (its agent stops at 25 s).
- Static caching: fonts are immutable for a year; vendor runtimes (Three.js, CesiumJS, MapLibre),
  brand images and the exterior model are cached for a week with background revalidation. App modules
  stay `no-cache` so deploys apply immediately. `CACHE_RULES` in `lib/web.mjs` mirrors these rules, and
  a test keeps them identical to `vercel.json`.
- Security headers add `Permissions-Policy` (no camera, microphone, location, payment or USB) and
  `Cross-Origin-Opener-Policy: same-origin`, still byte-identical between `lib/web.mjs` and
  `vercel.json`. The CSP is unchanged.
- `/api/geocode` now has the same per-instance request guard as the other lookups (90 requests per
  10 minutes per caller), and every guard keys on a SHA-256 hash of the caller from `clientKey()`,
  which also honours `x-forwarded-for`.
- The development / self-hosted server sends Brotli or gzip for text and WASM assets (cached per file
  version), ETags with `304 Not Modified`, and the same cache rules as production.

## Google Map Tiles API readiness

Nothing else is needed in code: set `GOOGLE_MAP_TILES_KEY` (see [SETUP §3](SETUP.md#3-3d-view-pick-one-credential))
and redeploy. The 3D view then leads after an address match, the key is restricted to the site
origin by the `strict-origin` referrer policy, and every failure mode lands on the next tier above.

## Verification

```text
npm run check          # syntax checks, 101 Node tests, public build
npm run test:browser   # 61 Chromium checks: app (41), map (13), 3D remodel (7)
npm run test:exterior  # 6 checks for the Austin exterior model
```
