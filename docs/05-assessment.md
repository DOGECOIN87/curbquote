# 5. My take: overall assessment, risks, changes, blind spots

## Overall

**It's a good idea in a slightly different form from the one described.** Instant online
estimates already work in roofing, where tools like Roofle report millions of quotes
([ContractorToolStack](https://contractortoolstack.com/software/roofle/)). Homeowners clearly
want a price before they let a salesperson in the house. A fast, honest ballpark for siding,
windows and doors would set you apart, because most competitors still require an in-home visit.

But the version that pulls Zillow/Redfin/MLS photos, guesses the windows and produces an
estimate doesn't hold up, for two reasons:

1. **You can't legally use those sources this way.** Portal terms forbid scraping. Listing photos
   are copyrighted and licensed only to market the listing. Google's terms block analyzing Street
   View, and they limit the Solar API to energy systems. Details in [01-data-sources.md](01-data-sources.md).
2. **Walls are much harder than roofs.** The street shows only one side. Window count, size and type
   vary widely between similar houses. Scope and product tier, which only the homeowner knows,
   move the price more than geometry does.

The version that works: **address → licensed public data + open building geometry → homeowner
confirms a few facts → honest range → photos and professional measurement tighten it.** The
lasting advantage isn't the data lookup. Anyone can buy that. It's **your closed-job data**
calibrating the estimates, and a funnel that turns a ballpark into a booked appointment.

## Biggest risks (ranked)

1. **Trust damage from low ballparks.** If the online number is regularly below the in-home price,
   homeowners will read it as bait-and-switch. You get reviews, complaints and wasted appointments.
   *Mitigation:* show ranges, list the assumptions, calibrate on real jobs, say clearly that the
   final price comes after measurement, and track estimate-vs-final error from day one.
2. **Data rights.** Building on scraped or misused data creates legal exposure and a dependency
   that can be cut off. *Mitigation:* licensed providers only, provenance on every fact, and
   counsel review of each contract's storage and derivative-use terms.
3. **Overestimating homeowner engagement.** "Keep adding info and we reward you" assumes repeat
   visits. Most homeowners will do one session. *Mitigation:* make each extra step pay off right
   away (tighter range, unlocked visualizer, priority scheduling, price hold), and design the first
   session to stand on its own.
4. **Build-vs-buy trap.** Photo measurement (Hover), aerial measurement (EagleView) and visualizers
   (Hover, Renoworks, manufacturer tools) are mature products with years of R&D. Building your own
   measurement CV is a multi-year project. *Mitigation:* buy measurement and visualization at first.
   Build the funnel, the estimate logic, the price engine and the feedback loop.
5. **Privacy and consent.**
   - Anyone can type in *anyone's* address. Show only general public-record facts before sign-in.
     Keep photo upload and profile behind an account.
   - Homeowner photos may show people, kids or license plates. Store them privately, set retention
     rules, and ask for consent before using them for model training.
   - **TCPA:** the FCC's "one-to-one consent" rule was vacated by the Eleventh Circuit in January
     2025 ([Morrison Foerster](https://www.mofo.com/resources/insights/250130-eleventh-circuit-vacates-fcc-s-tcpa-one-to-one-consent-rule)).
     Prior express consent is still required for autodialed or prerecorded calls and texts, and several
     states have stricter "mini-TCPA" laws. Log the exact consent language each lead saw. I didn't
     verify whether the FCC has acted again in 2026.
   - State privacy laws may apply depending on where you operate and your size.
6. **Visualization mismatch.** A generative render that doesn't match what gets installed
   (color, profile, window grids) leads to disputes. *Mitigation:* deterministic swatches tied to
   SKUs, generator guardrails, and an "illustrative" disclaimer approved by counsel.
7. **Regional variability.** Labor rates, housing stock (brick-heavy regions vs mostly-siding
   regions), energy and egress codes, permit costs and rebate programs all vary.
   **I don't know your region**, so the cost figures in these docs are national or third-party.
   Your price book has to drive the numbers.

## What I'd change

- **Address + 3 minutes, not address-only.** Pre-fill what public data knows, have the homeowner
  confirm it, and ask the high-value questions (scope, window count, doors, masonry).
- **Make homeowner photos the imagery source.** That solves copyright and terms problems, covers
  all four sides, and gives you the photos you'll need for visualization.
- **Buy measurement for qualified leads.** Order Hover or EagleView automatically when an appointment
  is booked, so reps arrive with numbers and quote faster.
- **Run Phase 0 (back-testing on your past jobs) before writing product code.** It's cheap, and it
  tells you how wide your ranges need to be.
- **Don't wall the first estimate behind sign-in.** Use sign-in to unlock saving, a tighter
  estimate, and the visualizer.
- **Start visualization with a partner tool**, and build your own only once you've shown it drives
  appointments.

## What you might be missing

- **Whose product is this?** If it's only for your company, keep it simple. If you might sell it to
  other dealers later, add `tenant_id` and per-tenant price books now, because retrofitting is painful.
- **Speed to lead.** Most of the value disappears if nobody calls within minutes. Decide routing,
  hours and ownership before launch.
- **Your price book as software.** Products, tiers, regional labor, adders (tear-off, rot repair,
  permits, RRP lead-safe work for pre-1978 homes
  ([EPA](https://www.epa.gov/lead/does-lead-renovation-repair-and-painting-rrp-rule-apply-work-windows-have-been-installed))),
  minimums and promos. Someone in the business has to own it.
- **Sales-law compliance.** In-home sales trigger the FTC Cooling-Off Rule and state
  home-solicitation and home-improvement contract laws. Check how online estimates and in-home
  proposals fit those rules in your state.
- **Tax-credit messaging.** The federal 25C window and door credit ended for installs after
  Dec 31, 2025 ([Five Seasons Windows](https://www.fiveseasonswindows.com/federal-tax-credits-for-windows-in-colorado-what-happened-to-25c-and-what-s-left-in-2026)).
  Update any marketing that still mentions it.
- **Edge cases.** Condos and townhomes (HOA controls the exterior), multi-family, rural addresses
  with no footprint or lidar coverage, new construction not yet in assessor data, and mixed-material
  houses.
- **Storm and insurance work.** If you do storm restoration, insurance adjusters favor specific
  measurement vendors, and estimates may need Xactimate-compatible line items.
- **Measuring success.** Track funnel conversion *and* estimate accuracy (estimate vs signed
  contract), by product line and house style, every month.

## Bottom line

Build it: estimates first, accounts and photos second, visualization third. Base it on
licensed data, homeowner input and your own job history, not on portal data or photos. If you
do Phase 0 well, you'll know within a month whether address-only estimates are viable in your
market or whether the quick questions have to come first. I expect the questions will be
needed, and that's fine.
