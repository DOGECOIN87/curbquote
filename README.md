# CurbQuote

**Transparent exterior renovation budgets from homeowner-entered measurements, with a
roadmap toward licensed property data and visualization.**

Status: working MVP prototype plus draft research (October 2026). The estimator is a homeowner-guided planning tool, not a verified address-to-measurement service or a binding contractor quote.

## Working prototype

A mobile-friendly siding, windows, and doors budget estimator now lives in this repository. It uses **homeowner-entered measurements and illustrative prices**; optional U.S. Census address matching provides a rough location only, not building geometry or a parcel survey. **No accuracy calibration or production deployment has been completed.**

```bash
npm run dev       # http://localhost:3000
npm run check     # syntax checks, 21 automated tests, public build
```

See [README-MVP.md](README-MVP.md) for usage, assumptions, limitations, and pre-launch requirements. Pricing shown in the prototype is editable example data, not a contractor price book.

The [Phase A audit](docs/06-stabilization-audit.md) records the source review, fixes, browser verification, and remaining launch blockers. Reproducible Chromium checks run in CI using a fixture provider; a separate opt-in live check can call Census.

## Planned customer journey (not current capabilities)

1. A homeowner enters their address.
2. The system pulls property details and building geometry.
3. It estimates siding squares, windows and doors (including upgrades and frames) as price ranges.
4. Homeowners sign in with Google or Apple and keep adding details. The more they add, the tighter
   and more detailed their estimate gets.
5. Next phase: AI visualization of their house with different siding, windows and doors.

## Research and plan

| # | Document | What's in it |
|---|---|---|
| 1 | [Data sources](docs/01-data-sources.md) | Zillow, Redfin, MLS, property-record APIs, footprints/lidar, street and aerial imagery, measurement vendors: what each provides, access, cost, terms/licensing |
| 2 | [Estimates](docs/02-estimation.md) | Siding/window/door methods, expected accuracy, the homeowner inputs that matter most |
| 3 | [Visualization](docs/03-visualization.md) | Real-time vs pre-rendered, tools and APIs, guardrails |
| 4 | [Architecture and roadmap](docs/04-architecture-and-roadmap.md) | System design, data model, unit costs, phases 0–4 |
| 5 | [Assessment](docs/05-assessment.md) | Honest take: risks, what to change, what's missing |
| — | [Back-test template](data/backtest-template.csv) | Columns to export from past jobs for Phase 0 |

## Executive summary

- **Feasible and worth building, as a range estimator rather than an instant quote.** Roofing
  shows the demand for instant online estimates. Walls, windows and doors are harder than roofs,
  so ranges will be wider and homeowner input matters more.
- **Don't build on Zillow, Redfin or MLS photos.** Their terms forbid scraping, listing photos are
  copyrighted and licensed only for marketing the listing, and MLS licenses don't cover this use.
  Google's terms also bar analyzing or storing Street View images, and they limit the Solar API to
  energy-system work.
- **Use instead:** licensed property-record APIs (ATTOM, RentCast, Regrid, Cotality) or county
  assessor data, free building footprints (Microsoft/Overture) and USGS lidar heights. For exterior
  photos, use **homeowner-uploaded photos**. For qualified leads, buy measurement (Hover,
  EagleView).
- **The lasting advantage is your own closed-job data.** Calibrating estimates on actual measured
  jobs beats generic rules of thumb.
- **Visualization:** real-time is practical today for mask-based color and texture swaps.
  Generative AI gives the most photorealistic results, but it takes seconds per image and can
  alter the house, so pre-render those images and add guardrails. Start with a partner tool
  (Hover, Renoworks or a manufacturer visualizer) before building your own.
- **Start with Phase 0:** back-test the estimate on 100–300 of your past jobs (2–4 weeks) before
  writing product code.

## Caveats

This is research, not legal advice. Vendor prices are reported or "starting at" figures and change
often. Only Google's terms were read directly on the primary pages. Other facts come from
search-indexed copies of the cited sources (see the note at the top of
[docs/01-data-sources.md](docs/01-data-sources.md)). Confirm terms and pricing with vendors, and have
counsel review data licenses, privacy and TCPA consent language before launch. Cost and accuracy
figures depend on your region, housing stock and price book, which aren't known yet.
