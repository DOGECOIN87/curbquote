# Research corrections and implementation audit — October 17, 2026

This file supplements the existing Claude Code research in PR #1. The EagleView pricing corrections and MVP status edits have been incorporated into `docs/01-data-sources.md`, `docs/04-architecture-and-roadmap.md`, and `README.md`. This does not constitute an exhaustive legal or commercial verification of every cited vendor. See `06-stabilization-audit.md` for the subsequent application audit.

## Confirmed pricing error (EagleView)

The original draft listed EagleView **Walls $18, Walls/Windows/Doors $24.25, precise Walls $40, Full House $67.50**. These mixed distinct roofing and wall products and were corrected.

Current vendor-published **residential** price tiers (checked Oct. 17, 2026):

| Product | Bronze | Silver | Gold |
|---|---:|---:|---:|
| Walls (formerly WallsLite) | $40 | $40 | $40 |
| Walls, Windows & Doors (formerly Walls) | $78 | $72.25 | $67.50 |
| Full House | $105 | $98 | $91 |

EagleView's **$18 Bid Perfect** and **$24.25 Premium Gold** prices are **roofing** products; they must not be used as a wall measurement cost in the roadmap's unit-economics model. Platinum prices require contacting the vendor. See: https://www.eagleview.com/pricing/ and https://www.eagleview.com/product/residential-property-reports-for-construction/ . Prices may change and do not include negotiated partner rates.

### Applied research text edits

1. `docs/01-data-sources.md`: replace the EagleView price table row with the corrected residential tiers and vendor links above; label prices vendor-published, not paid/guaranteed.
2. `docs/04-architecture-and-roadmap.md`: change the `EagleView / Hover` unit-cost range (currently `$18–$67.50+`) to separate the Walls $40 / Walls, Windows & Doors $67.50–$78 / Full House $91–$105 tiers. Hover prices are still unverified.
3. `README.md`: update `No application code yet` to reflect the MVP, but distinguish a *prototype* from a production-calibrated tool.

## Address geocoding — precise caveat

The U.S. Census Geocoding API provides **coordinates estimated along an address range**. It does not return verified parcel boundaries, floor area, wall lengths, window counts, or any building measurements. A matching address does not validate ownership or that the building is the one a homeowner intends. Official API: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html .

The prototype therefore never pre-fills property dimensions from geocoding. It requires homeowners to enter or correct dimensions themselves.

## Lead-safe work requirements

For paid renovation of pre-1978 housing that disturbs paint, EPA's RRP rule may require a certified firm and lead-safe work practices; window replacements are covered even when small. The prototype displays a flag without pretending it can determine paint composition or price compliance. See: https://www.epa.gov/lead/renovation-repair-and-painting-program-contractors .

## Data rights and accuracy caveats

- Google Street View caching and derived-content restrictions demand legal review; do not build a CV measurement pipeline on scraped Street View imagery. See: https://developers.google.com/maps/documentation/streetview/policies .
- Avoid categorical blanket assertions about all MLS or portal licenses; negotiate *specific rights* with each provider. No license has been acquired for this project yet.
- Building footprints are not uniformly covered by a single ODbL license. Verify source/dataset-specific licensing and attribution, especially where sources are combined.
- The existing report's expected accuracy and variable costs are **planning assumptions**, not measured performance. Actual estimates require an anonymized completed-job back-test and a regional price book.
- The MVP's ±18% siding variation is simply a visible scenario assumption, not calibrated P10/P90 bounds or a guarantee of contractor bid accuracy.

## Minimum pre-launch gates

Commercial data-provider licenses (if used), real completed-job calibration, market-specific price book, address-provider rate-limit controls, privacy policy and hosting-log retention disclosure, accessibility/device QA, consumer-facing disclaimers, legal compliance review, and monitoring of third-party geocoder failures.
