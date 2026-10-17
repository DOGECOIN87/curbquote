# CurbQuote — working MVP prototype

CurbQuote is an early mobile-friendly exterior renovation budget estimator. **It is not a professional quote, and does not automatically measure a building by address.** The UI supports siding, windows and doors; no signup, tracking pixels, vendor API keys, or database are required for the prototype.

## Run locally

Use Node 22.x, matching the deployment setting and GitHub Actions. From the repository root:

```sh
npm run dev
# Open http://127.0.0.1:3000
npm run check
```

Development, calculation tests and the static build use only Node built-ins. Playwright is a pinned development dependency for browser regression tests. There are no production npm dependencies.

Deploy the repository root to Vercel with the checked-in `vercel.json`: `npm run build` copies only the six browser assets into `dist/`; `/api/geocode` remains a Node function from `api/geocode.js`. Do not use a static-only host for geocoding. A hosted Vercel deployment has **not** been verified yet.

```sh
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm run test:browser           # fixture-backed; no Census network dependency
LIVE_GEOCODE=1 npm run test:browser  # opt-in live Census smoke test
```

Browser checks produce screenshots and a check list in the ignored `qa-output/` directory. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select a preinstalled Chromium executable. GitHub Actions runs both the unit/integration suite and the browser checks.

## What works

- User enters a U.S. street address and optionally asks for a match from the **U.S. Census Geocoding Services API** (`/api/geocode`). Coordinates are **address-range approximations**, not property boundaries, verified parcel data, building size, ownership or measurements. Geocoder may fail; estimator still functions.
- User supplies **length, width, stories, wall height, gables, brick/stone share, existing openings, requested replacements and year built**. Defaults are demonstration values, **not pulled from their property**.
- The model computes approximate gross wall area, deducts assumed openings, applies brick/stone share to the remaining solid walls, adds **10% waste**, and applies an **illustrative ±18% siding quantity scenario**, **not an empirically calibrated confidence interval**. Openings larger than the wall area are rejected.
- Low/high price settings are editable and are **example values, not local pricing research**. Reports record `manual-geometry-v2`, the baseline `illustrative-usd-v1` price version, whether rates were edited, and the exact numeric rates. This is not a contractor price-book system. No backend stores estimates; download is handled entirely in the browser.
- If year built is prior to 1978, display an **EPA lead-safe work review** notice.
- Download or print the same complete summary, including dimensions, address-match status, pricing and calculation assumptions. Invalid fields clear printable costs; correcting a field restores live calculations. The website never requests a phone number or marketing consent.
- Address errors distinguish invalid input (400), no/multiple matches (422), invalid upstream data (502), service failure (503), and timeout (504). The upstream request has a seven-second budget and the browser has a nine-second deadline. Address edits cancel stale browser requests. Manual estimation stays available.

## Known limitations and pre-launch blockers

1. No real parcel/footprint or assessor attributes, and no photo ingestion. **Address lookup does not supply dimensions.** Connecting a licensed provider requires rights review and validation in each market.
2. No contractor price book, labor/material adders, taxes, permit fees, tear-off, trim, labor complexity, accessibility, RRP work or region calibration.
3. Accuracy is untested. Compare estimates against completed jobs (see `data/backtest-template.csv`) before showing customer-facing dollar claims. Current ±18% is a scenario assumption only.
4. API lookups send the entered address to the U.S. Census through your hosting environment; hosting access logs may record request URLs. Do not claim end-to-end address confidentiality. Add hosting log controls and a privacy policy before production.
5. No durable profiles, login, photo visualization, back-end rate limits, or hosted deployment verification. Provider outage handling is implemented; production API usage still needs durable abuse protection and monitoring.
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

Each cost endpoint is rounded to whole dollars before line items are summed. Whole siding squares are `ceil(order_sqft / 100)` for reference; costs use unrounded square feet. The model covers all remaining siding, with no partial-wall or siding opt-out selector yet.

The 15/21 sq ft opening areas are crude defaults. The rectangular footprint and equal gable-base assumptions are exposed in the form and report. Do not use these numbers to order siding or certify a contract. See `docs/02-estimation.md` for the proposed validated estimation methods.

### Model version change

Version 2 explicitly defines masonry percentage as a share of **solid walls after openings**. The earlier prototype applied it to gross walls and then deducted all openings from siding. With the prefilled example, net siding changes from 2,302.8 to 2,347.2 sq ft, and the total range changes from $18,740–$52,646 to $19,020–$53,453. Neither version is calibrated against actual jobs.

## Sources and safety

- [U.S. Census geocoding API](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html)
- [EPA Renovation, Repair and Painting rule for contractors](https://www.epa.gov/lead/renovation-repair-and-painting-program-contractors)
- [EagleView current pricing](https://www.eagleview.com/pricing/) (research context only; not built into example rates)
