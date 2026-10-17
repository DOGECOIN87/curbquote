# CurbQuote — working MVP prototype

CurbQuote is an early mobile-friendly exterior renovation budget estimator. **It is not a professional quote, and does not automatically measure a building by address.** The UI supports siding, windows and doors; no signup, tracking pixels, vendor API keys, or database are required for the prototype.

## Run locally

Use Node 22.x, matching the deployment setting and GitHub Actions. From the repository root:

```sh
npm run dev
# Open http://127.0.0.1:3000
npm run check
```

Run `npm ci --ignore-scripts` before development or checks. The AI SDK and Zod are pinned production dependencies for the server-side assistant; Playwright is a pinned development dependency for browser regression tests. The automatic planner works without AI credentials.

Deploy the repository root to Vercel with the checked-in `vercel.json`: `npm run build` copies only the fifteen browser assets into `dist/`; `/api/geocode`, `/api/property` and `/api/assistant` remain Node functions in `api/`. Do not use a static-only host for geocoding. The current hosted preview and its verification status are recorded in PR #1.

```sh
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm run test:browser           # fixture-backed; no Census or USGS network dependency
LIVE_PROPERTY_PREVIEW=1 npm run test:preview:live  # opt-in live address → aerial preview smoke
```

Browser checks produce screenshots and a check list in the ignored `qa-output/` directory. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select a preinstalled Chromium executable. GitHub Actions runs both the unit/integration suite and the browser checks.

## Working homeowner flow

- Type a complete U.S. address. After a 700 ms pause, Census matching brings a USGS/USDA aerial view into the top of the page. Zoom, pan, tap to center a building, or recenter the approximate address point. Coverage currently includes the contiguous U.S.; image age and availability vary. The view does not identify or measure a specific building. See [live property previews](docs/10-live-property-preview.md).

- Separately authorized property facts load automatically after a successful match when a source is configured; Find property also requests them directly. Review source and freshness, then select permitted story/year details. Source values, homeowner corrections and attribution survive supported saves/exports. Restricted grants remain temporary display-only. No live provider is configured by default; see [property adapter setup](docs/09-property-data-adapter.md).

- Describe a goal, compare material/tier plans, search a target budget, and optionally explore phased work. Apply a calculated proposal with undo. Track unconfirmed home details, restore an automatic device draft and download a contractor discussion brief. A bounded AI tool-calling assistant can perform these estimate tasks and optional Census matching when Gateway authentication and credits are available; an explicitly labeled automatic planner handles comparisons and supported goal patterns without AI. See [automated planning and agent setup](docs/08-agentic-planning.md).

- Select siding, windows, doors or a combination. Set partial siding coverage and replacement counts.
- Choose among three materials/styles per product line and Standard, Enhanced or Premium tiers. Editable example rates update the budget immediately; the catalog is explicitly illustrative and versioned.
- Pick siding colors in the example-home illustration. Upload your own JPEG/PNG/WebP, mark wall polygons, and preview a color overlay only inside those areas. Download the resulting PNG. This is a manual color concept, not automatic measurement, AI segmentation or a manufacturer-accurate visualization.
- Save, reopen, update and delete named projects on this device. Exact inputs/options use localStorage; photos and wall selections use IndexedDB. Records survive reload on the same site origin. There is no account, cloud sync or server photo storage; clearing browser/site data removes projects and photos.
- Download/print an itemized estimate with scope, selections, model, exact rates, assumptions and exclusions.

See [the prototype implementation notes](docs/07-functional-prototype.md) for current scope and validation.

## Estimation and address behavior

- A complete-looking U.S. street address automatically requests a match after a 700 ms pause from the **U.S. Census Geocoding Services API** (`/api/geocode`). Coordinates are **address-range approximations**, not property boundaries, verified parcel data, building size, ownership or measurements. Find property and Enter can also search immediately. Geocoder may fail; estimator still functions. The resulting aerial preview is a view of the surrounding area, not a street-level photo, 3D model or automatic building measurement.
- User supplies **length, width, stories, wall height, gables, brick/stone share, existing openings, requested replacements and year built**. Defaults are demonstration values, **not pulled from their property**.
- The model computes approximate gross wall area, deducts assumed openings, applies brick/stone share to the remaining solid walls, adds **10% waste**, and applies an **illustrative ±18% siding quantity scenario**, **not an empirically calibrated confidence interval**. Openings larger than the wall area are rejected.
- Low/high price settings are editable and are **example values, not local pricing research**. Reports record `manual-geometry-v2`, the selected `demo-products-2026-10-v1` catalog version, whether rates were edited, and the exact numeric rates. This is not a contractor price-book system. No backend stores estimates; download is handled entirely in the browser.
- If year built is prior to 1978, display an **EPA lead-safe work review** notice.
- Download or print the same complete summary, including dimensions, address-match status, pricing and calculation assumptions. Invalid fields clear printable costs; correcting a field restores live calculations. The website never requests a phone number or marketing consent.
- Address errors distinguish invalid input (400), no/multiple matches (422), invalid upstream data (502), service failure (503), and timeout (504). The upstream request has a seven-second budget and the browser has a nine-second deadline. Address edits cancel stale browser requests. Manual estimation stays available.

## Known limitations and pre-launch blockers

1. A configurable authorized-provider adapter exists, but no live provider or credentials are supplied. There is no automatic footprint or assessor integration by default. Photos are supplied and marked by the homeowner, not measured automatically. **Address lookup does not supply dimensions.** Connecting a licensed provider requires rights review and validation in each market.
2. No contractor price book, labor/material adders, taxes, permit fees, tear-off, trim, labor complexity, accessibility, RRP work or region calibration.
3. Accuracy is untested. Compare estimates against completed jobs (see `data/backtest-template.csv`) before showing customer-facing dollar claims. Current ±18% is a scenario assumption only.
4. Automatic API lookups send the entered address to the U.S. Census through your hosting environment; hosting access logs may record request URLs. Aerial requests send map coordinates and the browser's network address to USGS, with no HTTP referrer. The application does not persist/export the aerial images or send them to AI. Do not claim end-to-end address confidentiality. Add hosting log controls and a privacy policy before production.
5. No cloud profiles, homeowner login or production operations. The AI endpoint has a per-instance request guard, not a durable distributed rate limit. Provider outage handling is implemented; production API usage still needs durable abuse protection and monitoring.
6. The prototype is not validated for state-specific contractor or consumer-estimate regulations; obtain legal review before launch.

## Estimator formulas

```text
gross_sqft = (2 × (length + width) × stories × story_height)
             + (gables × min(length,width) × gable_rise / 2)
openings_sqft = existing_windows × 15 + existing_doors × 21
solid_wall_sqft = gross_sqft - openings_sqft  # reject if negative
net_siding_sqft = solid_wall_sqft × (1 - masonry_pct/100)
order_sqft = net_siding_sqft × 1.10
siding_low  = round(order_sqft × (1 - 0.18) × user_siding_low_rate)
siding_high = round(order_sqft × (1 + 0.18) × user_siding_high_rate)
windows = replaced_window_count × [user_low_rate, user_high_rate]
doors = replaced_door_count × [user_low_rate, user_high_rate]
project_range = siding_range + window_range + door_range
```

Each cost endpoint is rounded to whole dollars before line items are summed. Whole siding squares are `ceil(order_sqft / 100)` for reference; costs use unrounded square feet. Selected siding coverage applies to the estimated net siding area; unselected product lines have zero cost. Window/door-only budgets do not use building dimensions.

The 15/21 sq ft opening areas are crude defaults. The rectangular footprint and equal gable-base assumptions are exposed in the form and report. Do not use these numbers to order siding or certify a contract. See `docs/02-estimation.md` for the proposed validated estimation methods.

### Model version change

Version 2 explicitly defines masonry percentage as a share of **solid walls after openings**. The earlier prototype applied it to gross walls and then deducted all openings from siding. With the prefilled example, net siding changes from 2,302.8 to 2,347.2 sq ft, and the total range changes from $18,740–$52,646 to $19,020–$53,453. Neither version is calibrated against actual jobs.

## Sources and safety

- [USGS NAIP imagery service and public-domain data description](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/info/iteminfo?f=pjson)
- [U.S. Census geocoding API](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html)
- [EPA Renovation, Repair and Painting rule for contractors](https://www.epa.gov/lead/renovation-repair-and-painting-program-contractors)
- [EagleView current pricing](https://www.eagleview.com/pricing/) (research context only; not built into example rates)
