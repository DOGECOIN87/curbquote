# CurbQuote — working MVP prototype

CurbQuote is an early mobile-friendly exterior renovation budget estimator. **It is not a professional quote, and does not automatically measure a building by address.** The UI supports siding, windows and doors; no signup, tracking pixels, vendor API keys, or database are required for the prototype.

## Run locally

Requires Node 20+. From the repository root:

```sh
npm run dev
# Open http://127.0.0.1:3000
npm run check
```

No npm dependencies need to be installed. Deploy the repository root to Vercel to expose the same static UI and `api/geocode.js` serverless handler. A production deployment has **not** been configured or verified yet.

## What works

- User enters a U.S. street address and optionally asks for a match from the **U.S. Census Geocoding Services API** (`/api/geocode`). Coordinates are **address-range approximations**, not property boundaries, verified parcel data, building size, ownership or measurements. Geocoder may fail; estimator still functions.
- User supplies **length, width, stories, wall height, gables, brick/stone share, existing openings, requested replacements and year built**. Defaults are demonstration values, **not pulled from their property**.
- The model computes approximate gross wall area, removes an assumed masonry share and assumed openings, adds **10% waste**, and applies an **illustrative ±18% siding quantity scenario**, **not an empirically calibrated confidence interval**.
- Low/high price settings are editable and are **example values, not local pricing research**. No backend stores estimates; download is handled entirely in the browser.
- If year built is prior to 1978, display an **EPA lead-safe work review** notice.
- Download an itemized text summary or print a result. The website never requests a phone number or marketing consent.

## Known limitations and pre-launch blockers

1. No real parcel/footprint or assessor attributes, and no photo ingestion. **Address lookup does not supply dimensions.** Connecting a licensed provider requires rights review and validation in each market.
2. No contractor price book, labor/material adders, taxes, permit fees, tear-off, trim, labor complexity, accessibility, RRP work or region calibration.
3. Accuracy is untested. Compare estimates against completed jobs (see `data/backtest-template.csv`) before showing customer-facing dollar claims. Current ±18% is a scenario assumption only.
4. API lookups send the entered address to the U.S. Census through your hosting environment; hosting access logs may record request URLs. Do not claim end-to-end address confidentiality. Add hosting log controls and a privacy policy before production.
5. No durable profiles, login, photo visualization, back-end rate limits, or deployment verification. Production API usage must implement abuse protection, monitoring, and provider outage handling.
6. The prototype is not validated for state-specific contractor or consumer-estimate regulations; obtain legal review before launch.

## Estimator formulas

```text
gross_sqft = (2 × (length + width) × stories × story_height)
             + (gables × min(length,width) × gable_rise / 2)
net_siding_sqft = max(0, gross_sqft × (1 - masonry_pct/100)
                         - existing_windows × 15 - existing_doors × 21)
order_sqft = net_siding_sqft × 1.10
siding_low  = round(order_sqft × (1 - 0.18) × user_siding_low_rate)
siding_high = round(order_sqft × (1 + 0.18) × user_siding_high_rate)
windows = replaced_window_count × [user_low_rate, user_high_rate]
doors = replaced_door_count × [user_low_rate, user_high_rate]
project_range = siding_range + window_range + door_range
```

The 15/21 sq ft opening areas are crude defaults. Do not use these numbers to order siding or certify a contract. See `docs/02-estimation.md` for the proposed validated estimation methods.

## Sources and safety

- [U.S. Census geocoding API](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html)
- [EPA Renovation, Repair and Painting rule for contractors](https://www.epa.gov/lead/renovation-repair-and-painting-program-contractors)
- [EagleView current pricing](https://www.eagleview.com/pricing/) (research context only; not built into example rates)
