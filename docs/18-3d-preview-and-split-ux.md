# 18 — Inline Step 3 3D preview, split comparison and scannability pass (v0.12)

Review of the v0.11 (`18c9651`) build, the evidence-based findings behind this pass, what changed,
and what was kept untouched. Screenshots in [`assets/ui-review`](assets/ui-review) (`v012-*.png`)
place v0.11 (left) beside v0.12 (right) at desktop (`1440 px`) and phone (`390 px`).

## How this was reviewed

`npm ci --ignore-scripts`, `npm run dev`, and a headless Playwright harness driving Chromium at
`320`, `360`, `390`, `560`, `768`, `921`, `1024`, `1440`, `2560`, and `844×390` (landscape) across:
- First visit with no address entered
- Typed U.S. address (`4600 Silver Hill Rd, Washington, DC 20233`) with fixture geocoding and USGS aerial imagery
- **Try an exterior example** (Neill-Cochran House Museum, Austin lidar GLB)
- Full 5-step estimate journey, changing scopes, products, quality tiers, colors, and home measurements
- 3D Remodel Studio (orbit, `Corner`/`Front`/`Top` views, `Before`/`After`, roof colors, porch/dormers/shutters additions, PNG download)
- Example-home SVG tab and local photo wall-polygon editor tab
- Save project → reload → restore, and automatic device draft recovery
- Returning from Step 5 to edit earlier steps
- Error, loading, unavailable-imagery, no-3D-credential, and no-WebGL2 fallback paths

## Baseline findings from v0.11 (`18c9651`)

Ordered by homeowner impact; effort indicates implementation scope.

### Flow, friction, and discoverability of 3D

| Finding | Evidence (`18c9651`) | Impact | Effort |
|---|---|---|---|
| The 3D concept house is still only rendered on Step 5. On Step 3, homeowners type `Length`, `Width`, `Stories`, and window/door counts while looking only at a static 2D rectangle diagram (`docs/17` explicitly flagged this under *Remaining limitations*). | Step 3 had no `.remodel-stage`; clicking `Preview in 3D ↗` jumped all the way to Step 5, skipping Step 4 (`Make your choices`). | High — homeowners cannot see their dimensions take shape while entering them | Medium |
| On Step 1, the distinction between the real property view (Census/USGS/optional Google 3D/Austin lidar) and the Step 3/5 concept model was tucked inside a collapsed `<details class="visual-guide">` and the bottom of Step 5. | When `#visual-guide` is closed (default), Step 1 never mentions that the 3D house later in the flow is a concept model sized from typed measurements rather than the aerial footprint. | High — core truthfulness & trust story | Small |
| When no Google 3D / Cesium credential is configured, `#aerial-status` after an address match says `"Aerial view ready. The pin is an approximate Census address point..."` without explaining why the hero's promised 3D property view fell back to a 2D aerial image. | `#aerial-3d-toggle` is hidden when `!has3d && !view3d.hasLocal(match)`, leaving the fallback silent. | Medium | Trivial |

### Estimate comprehension, Step 4 density, and Step 5 scannability

| Finding | Evidence (`18c9651`) | Impact | Effort |
|---|---|---|---|
| Opening `#price-details` (`More options: coverage and example prices`) on Step 4 expands a tall vertical stack of 3 category blocks, increasing Step 4 height by `+582 px` on desktop (`866 px → 1,448 px`) and `+896 px` at `320 px` (`1,343 px → 2,239 px`). When closed, the summary gives no indication of the active coverage % or whether rates are catalog defaults vs customized, and there is no one-click reset after editing a unit rate. | Measured via `getBoundingClientRect()` at `1440`, `768`, `390`, and `320 px`. | Medium — progressive disclosure hides state when closed and creates a wall of inputs when open | Small |
| Quality tier cards (`Standard`, `Enhanced`, `Premium`) use qualitative subtitles (`Simple & practical`, `A little more detail`, `Higher-end finishes`) without stating their actual rate multipliers (`1×`, `1.25×`, `1.6×`), and hide their subtitle `<span>` completely on phones (`≤560 px`). | `TIERS` in `project.js` applies exact `1`, `1.25`, `1.6` multipliers; hiding `span` at `≤560 px` left mobile users with zero explanation of tier differences. | Medium | Trivial |
| On Step 5, `#geometry-details` (`How this was calculated`), three separate `.calculation-note` paragraphs, `#lead-notice`, and `.muted-notice` (`What's not included?`) are spaced as separate blocks with large vertical margins. | At `1440 px`, `.muted-notice` starts `836 px` below `.total-card` top (`1,028 px` at `390 px`, `1,149 px` at `320 px`), pushing `.design-studio` `1,598 px` down on a `390 px` phone. | Medium — separates the cost range from its caveats and pushes the mobile studio down | Small |

### Before/After comparison, performance, and typography/CSS hygiene

| Finding | Evidence (`18c9651`) | Impact | Effort |
|---|---|---|---|
| `Before` and `After` in the 3D studio are a binary flip only; homeowners cannot see the dated baseline and their selected remodel side by side in the same camera frame. | `#remodel-before` and `#remodel-after` toggle the entire scene at once. | Medium — side-by-side comparison makes material and addition changes much easier to judge | Medium |
| `remodel-3d.js` runs `renderer.setAnimationLoop(...)` continuously at 60 fps whenever the studio is open, even when the camera and house are completely static. | Continuous software/hardware WebGL shadow-map rendering while idle. | Medium — unnecessary battery/GPU load on laptops and phones | Small |
| `#save-project` (`Save this project ＋`) and `label[for="photo-upload"]` (`Upload a photo of your home ＋`) use U+FF0B (`＋`, CJK fullwidth plus). Because self-hosted Poppins covers Latin only and Linux/non-CJK fallback fonts lack U+FF0B, it renders as a missing-glyph tofu box (`⌧`). | Visible in `step5-1440.png` and `step5-390.png` baselines. | Medium — visible broken glyph on primary CTA | Trivial |
| `styles.css` retains 17 dead selectors from the v0.6 CSS-art illustration (`.hero-graphic`, `.graphic-grid`, `.house-body`, etc.) that match zero DOM nodes. | Confirmed via repository-wide selector audit. | Low — stylesheet maintainability | Trivial |

## Design direction

Keep the five-step wizard, the Alco forest-green (`#102303`) and lime (`#89C63F`) identity, Poppins
typography, and every existing test hook. No uppercase or letter-spaced eyebrow labels anywhere.

1. **Show the 3D concept house on Step 3 right beside the footprint diagram — sharing one lazy WebGL
   renderer with Step 5.** When Step 3 opens, Three.js lazy-loads into `#step3-3d-stage` and updates
   live as the homeowner edits `Length`, `Width`, `Stories`, or window count. Moving to Step 5
   attaches the same WebGL `<canvas>` into `#remodel-stage` (zero duplicate context). Rendering is
   now strictly on-demand (camera move, resize, spec update, or split drag) instead of a 60 fps idle
   loop.
2. **Make the real-property vs concept-house boundary unmistakable in place.** Step 1 gains a
   persistent two-line `.view-pair-callout` contrasting Step 1's display-only location view with
   Steps 3 & 5's measurement-driven concept house, and `#aerial-status` explicitly notes when
   optional 3D tiles are not connected.
3. **Add an interactive, keyboard-operable Before/After split wipe on the 3D canvas.** Alongside
   `Before` and `After`, a new `Split 50/50` button and `Compare Before & After` range slider
   (`#remodel-split`) use WebGL scissor testing to render the dated `Before` house on the left and
   the `After` remodel on the right from the exact same camera angle, with live text descriptions in
   `#remodel-split-readout` and `#remodel-compare-note`.
4. **Tighten Step 4 progressive disclosure and Step 5 caveat scannability.** Step 4's collapsed
   `<summary>` shows `100% coverage · catalog rates ⌄` (or `edited rates`), opens into a compact
   3-column desktop grid (`1,448 px → 1,137 px`, `-311 px` height at `1440 px`) with a
   `Reset to catalog rates` button, and keeps tier multipliers (`1×`, `1.25×`, `1.6×`) visible on
   both desktop and phones. Step 5 groups `How this was calculated`, the assumptions stack, and
   `What's not included?` into a single `.estimate-caveats-card`.

## Measured before/after DOM impact

| Metric | Baseline (`18c9651`) | After (`v0.12`) | Delta |
|---|---|---|---|
| Step 4 height with `#price-details` open (`1440 px`) | `1,448 px` | `1,137 px` | **-311 px (-21.5%)** |
| Step 4 height with `#price-details` open (`768 px`) | `1,466 px` | `1,201 px` | **-265 px (-18.1%)** |
| Step 5 `#results` column height (`1440 px`) | `1,345 px` | `1,269 px` | **-76 px** |
| Step 5 `#results` column height (`390 px` phone) | `1,598 px` | `1,511 px` | **-87 px** |
| Step 5 `#results` column height (`320 px` phone) | `1,863 px` | `1,770 px` | **-93 px** |
| Step 5 exclusions (`.muted-notice`) offset below `.total-card` (`1440 px`) | `836 px` | `762 px` | **-74 px closer** |
| Step 5 exclusions (`.muted-notice`) offset below `.total-card` (`390 px`) | `1,028 px` | `943 px` | **-85 px closer** |

## What changed

| File | Change |
|---|---|
| `index.html` | Added `.view-pair-callout` on Step 1; `.step3-visual-row` and `#step3-3d-card` (`#step3-3d-stage`, `#step3-3d-open`, `[data-step3-view]`, `#step3-3d-status`) on Step 3; expanded footprint SVG `viewBox` (`0 0 320 156`) so the `Length` descender never clips; added `.choice-field` wrappers, explicit tier multipliers (`1× base rate`, `1.25× Standard`, `1.6× Standard`), `#price-details-summary`, `#reset-rates`, and `.price-categories-grid` on Step 4; added `.estimate-caveats-card`, `#remodel-split-half` (`Split 50/50`), `.remodel-split-row` (`#remodel-split`, `#remodel-split-readout`), `.photo-steps-guide`, and ASCII `+` on Step 5. |
| `remodel-3d.js` | Added dual-stage mounting (`stage` + `previewStage`, `attach()`), lazy `beforeHouse` construction, WebGL scissor-based Before/After split rendering (`setSplit()`), and on-demand rendering instead of an idle 60 fps animation loop. |
| `main.js` | Wired Step 3 / Step 5 shared 3D canvas attachment on wizard step change, `applyRemodelSplit()` for the split button and range slider, `areRatesCustomized()` + `#reset-rates` + `#price-details-summary` on Step 4, and `.is-excluded` scope styling. |
| `property-preview.js` | Clarified `#aerial-status` when optional 3D tiles are not connected while keeping all existing status substrings intact. |
| `styles.css` | Styled `.view-pair-callout`, `.step3-visual-row`, `.step3-3d-card`, `.price-categories-grid`, `.coverage-row`, `.estimate-caveats-card`, 3-button `.remodel-mode`, `.remodel-split-row`, and `.photo-steps-guide`; kept tier subtitles visible on phones; removed 17 unused v0.6 CSS-art selectors. |
| `tests/wizard.test.js`, `qa/browser.mjs`, `qa/remodel-browser.mjs` | Added unit and browser QA coverage for the Step 3 inline 3D preview, shared single WebGL canvas, 50/50 split comparison, Step 4 rate summary/reset button, and no-eyebrow / no-U+FF0B rules. |

## Verification

```
npm run check          # 78 Node tests pass, build writes 38 browser assets
npm run test:python    # 5 tests pass
npm run test:browser   # 37 app + 10 map + 4 remodel = 51 Chromium checks pass
npm run test:exterior  # 6 checks pass
```

All 10 responsive viewports (`320`, `360`, `390`, `560`, `768`, `921`, `1024`, `1440`, `2560`, and
`844×390` landscape) were re-verified across all 5 wizard steps including maximum legal input values
with zero horizontal overflow and zero clipped labels.

## Remaining limitations

- Porch, dormer, and shutter additions remain visual only and are not priced in the estimate.
- The 3D concept house is built from homeowner-entered measurements (`Length`, `Width`, `Stories`,
  window/door counts), not traced from aerial imagery or Google 3D tiles.
- Local lidar exterior model coverage remains limited to the single reviewed Austin example property
  (Neill-Cochran House Museum).
- Preset example rates in Step 4 are illustrative catalog figures, not a binding contractor quote.
