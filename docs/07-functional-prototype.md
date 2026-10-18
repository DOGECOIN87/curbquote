# CurbQuote functional homeowner prototype — v0.3

Built on the existing framework-free estimator and development branch. No rewrite or paid property-data purchase is involved.

## Implemented journey

1. Enter an optional U.S. street address and request a Census address-range match. Matching never supplies measurements.
2. Select any combination of siding, windows and doors. At least one is required.
3. Choose product materials/styles, a Standard/Enhanced/Premium tier, siding color and partial siding coverage. The versioned `demo-products-2026-10-v1` catalog supplies authored example rates; advanced rate fields remain editable.
4. Supply or correct the example measurements and replacement counts. Window/door-only budgets ignore building dimensions. Unselected work is excluded from the estimate.
5. View a live, itemized budget with explicit assumptions, scope and exclusions. Print or download the complete report.
6. Explore an illustrative home, or upload a JPEG/PNG/WebP photo and mark wall polygons. Selected colors tint those areas while leaving pixels outside the selections alone. Download the resulting PNG. The user must avoid windows, doors and other regions that should stay unchanged.
7. Save a named project, reload the page and reopen it with its options, exact rates, photo and wall selections. Update or delete it, or start a fresh project.

## Storage and behavior

- Estimate records use browser localStorage, limited to 30 named projects; photo blobs and normalized wall polygons use IndexedDB. Data stays in the current browser/site origin. There is no account or cloud synchronization, and clearing site data removes it.
- Invalid records, unavailable storage and quota failures surface an error. A failed photo save is distinguished from a successful estimate save.
- Opening a saved project does not reuse an old address match. The user can request a fresh match.
- Photos are limited to 12 MB and 40 megapixels; color-preview exports are scaled to at most 1600×1200 pixels. The original uploaded blob is retained locally when saved.
- Color changes do not alter the budget. Material/tier changes update the illustrative rates. A manually edited rate is labeled against the selected catalog product/tier.
- The photo editor supports clicks, undo/clear, and keyboard input: arrow keys move a cursor, Space adds a corner, Enter finishes, Escape cancels unfinished points.

## Validation

- `npm run check`: 27 Node unit/integration tests, syntax checks and nine-asset public build.
- `npm run test:browser`: 17 Chromium check groups, including the ten-viewport/max-value matrix, scope/material/tier changes, storage across reload, PNG output and saved photo restoration.
- All catalog product/tier combinations are checked for finite ordered ranges. Tests cover partial coverage, excluded work, dimensions omitted from window-only projects, bad options, saved-record corruption and quota failures.
- Desktop, phone and print layouts are visually checked. CI runs the calculation/API/build and deterministic browser suites on Node 22.

## Hosting

The static demo is built with `npm run build:pages` and deployed to GitHub Pages by `.github/workflows/pages.yml`. The full application runs locally with `npm run dev`.

## Prototype boundaries

This is functional prototype software, with real interactions, local persistence and exports. Its prices remain illustrative and its accuracy is uncalibrated. It does not automatically measure a property, infer photo geometry, identify products from images, generate a manufacturer-accurate renovation render, provide cloud accounts, or book/send appointments. Production still requires licensed property integration, an approved contractor price book, completed-job calibration, durable abuse controls and operational/privacy configuration.
