# Phase A — repository audit and stabilization

Historical audit for commit `c5f9b64`. The subsequent functional prototype, including project scope selection, saved projects and local photo concepts, is described in [07-functional-prototype.md](07-functional-prototype.md).

Date: October 17, 2026. Baseline: `d16d71f348b60a19f0e24c34ca79c646a7c0adb0` on `research/feasibility-report`, draft PR #1 targeting `main`. The repository contained the MVP and research described in the handover; it was not replaced with a different framework.

## Baseline evidence

- Reviewed all application code, estimation/geocoding tests, server and deployment configuration, README files, five research documents, corrections and back-test template.
- All seven existing tests passed locally.
- Contrary to the unconfirmed handover status, both GitHub Actions runs for the baseline commit had completed successfully: [PR run](https://github.com/DOGECOIN87/curbquote/actions/runs/39029417155), [push run](https://github.com/DOGECOIN87/curbquote/actions/runs/39029415070).
- A live request through the actual Node API handler matched the public Census headquarters address. The original resolver also accepted an empty matched address with `null`/blank coordinates as `(0, 0)`; this was reproduced and fixed.
- No verified hosted deployment URL was supplied. Local browser/API verification does not establish Vercel routing, deployed function packaging, or hosting log configuration.

## Findings and changes

| Finding | Resulting behavior |
|---|---|
| Live calculation stopped permanently after an invalid edit because `lastResult` was also the recalculation gate | A separate interaction state keeps validation active; correcting the field restores the estimate immediately |
| Printing forced hidden results visible and omitted the input/pricing snapshot | A dedicated report shares download content, revalidates before printing, and clears stale costs when inputs are invalid |
| Mixed-material percentage had an ambiguous gross-wall basis, with all openings then deducted from siding | Model `manual-geometry-v2` defines masonry as a share of solid walls after openings; the UI and reports explain this assumption |
| Excessive openings silently clamped siding to zero | An actionable validation error requires correcting dimensions/counts |
| Validation coerced whitespace, booleans and arrays into numbers | Invalid types and blank strings are rejected, with field-level errors and focus on submit; collapsed price settings open when necessary |
| Malformed geocoder data could be treated as a valid location or a no-match | Strict numeric coordinates and nonempty matched address are required; malformed provider data is distinct from a legitimate empty match |
| All lookup failures used 422 and the client had no deadline/cancellation | Stable 400/422/502/503/504 outcomes, a 7-second provider timeout, 9-second browser deadline, and stale-response cancellation; manual estimates stay available |
| Local server silently selected the last duplicate address parameter, unlike Vercel | Duplicate and missing address parameters are rejected before calling the provider |
| Unit rates and assumptions had no model/source snapshot in results | Results carry an illustrative baseline price version, edited-rate flag, exact rates, calculation version and assumptions; exports preserve them |
| Static deployment boundaries were implicit | An explicit build copies six browser assets into `dist/`, keeping server/research/config files out of static output; root `api/geocode.js` remains the function entry point |
| External font fetches and inconsistent response headers | System font fallbacks, same-origin content policy, referrer controls and content-type/frame protections shared between local and hosting configuration |
| Mobile address input collapsed; decorative labels overlapped; large values and hero text could clip | Stable input height, adjusted illustration spacing, responsive type, narrow-screen line-item layout and a viewport regression matrix |

The new formula is a change in the documented approximation, not evidence of improved field accuracy. Default net siding is now 2,347.2 sq ft; order quantity is 2,581.92 sq ft. Whole squares round up to 26 for reference. Price calculations use unrounded square feet, round each line-item endpoint to whole dollars and sum the rounded lines, giving $19,020–$53,453 with the unchanged illustrative rates.

## Verification

Story: a homeowner enters measurements and optional address → browser calculation and optional Node API/Census lookup → transparent preliminary range → complete local download/print report.

| Boundary | Evidence |
|---|---|
| Calculation and validation | 21 Node unit/integration tests pass, including mixed materials, impossible geometry, numeric validation, rounding and snapshots |
| HTTP API contract | Tests exercise the same handler used by Vercel, including method/query guards, provider statuses, private exception handling and no-store responses |
| Public build | Build passes; browser imports resolve from the generated output, while backend, environment, Git and research paths return 404 in the local server |
| Browser → real API → live provider → UI | Chromium smoke test matched the public Census headquarters address without changing homeowner dimensions |
| Form state and exports | Browser checks cover invalid-edit recovery, price-field focus, advisory updates, shared download/print contents and stale-print prevention |
| Lookup failure/race behavior | Browser checks cover malformed/HTML responses, address edits during lookup, late responses and timeout recovery |
| Responsive layout | Ten Chromium viewport sizes: 320×740, 360×800, 390×844, 560×800, 768×1024, 921×800, 1024×768, 1440×1000, 2560×1440 and 844×390; default and maximum legal input values checked for overflow/clipping |
| Visual inspection | Desktop, phone and print screenshots inspected; mobile input height, illustration labels and heading fit corrected |
| Runtime/dependencies | Deployment and CI target Node 22.x; local checks used Node 24.19.0. No production npm dependencies. Playwright 1.62.1 is pinned for development-only browser checks |

`npm run check` runs syntax checks, the 21 Node tests and the public build. `npm run test:browser` runs 12 browser check groups against a deterministic provider fixture, including the responsive matrix. GitHub Actions runs both jobs; it does not depend on live Census availability. Set `LIVE_GEOCODE=1` for the opt-in live smoke check. Generated screenshots/check lists are ignored build artifacts, not homeowner data.

## Remaining work before production

1. Verify a real Vercel preview: `/`, browser modules and `/api/geocode`, including failure responses and response headers. Confirm hosting access-log retention and privacy disclosures; the current GET lookup puts the entered address in the request URL.
2. Add durable abuse protection, provider monitoring and operational ownership. A per-process memory counter would not enforce a reliable serverless-wide limit.
3. Implement a contractor-managed price book with immutable revisions, market/effective dates, product materials/styles/tiers, project scope selection and applicable adders. Current editable prices are examples only; no contractor prices or vendor purchases were introduced.
4. Back-test against measured completed jobs before making accuracy or calibrated probability claims. The 15/21-sq-ft openings, rectangular footprint, short-side gable bases, 10% waste and ±18% quantity scenario remain assumptions.
5. Integrate property data only after confirming provider/dataset rights and market coverage. Census matching supplies no dimensions, ownership or parcel identity.
6. Add accounts, private property profiles, photo uploads, visualization and appointment/CRM workflows in separate increments. None of these are implemented or presented as current features.
7. Broaden browser/accessibility verification to Safari/WebKit, Firefox and assistive technology. Current browser evidence is Chromium only.

The next engineering increment should establish the preview verification and versioned price-book/scope foundation. Licensed property data and calibration are separate requirements; a working deployment alone will not make this a production-calibrated estimator.

## Primary references used for runtime checks

- [Vercel Node runtime and request/response helpers](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel static configuration](https://vercel.com/docs/project-configuration/vercel-json)
- [Census Geocoding Services API](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html)
- [Playwright CI setup](https://playwright.dev/docs/ci-intro)
