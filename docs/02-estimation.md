# 2. Estimates: can the system make reliable estimates from public data and images?

## Short answer

**Yes for a believable *range*, no for a *quote*.** Public data plus building geometry can
produce a siding range good enough to qualify a lead and set expectations. Window and door
estimates from public data alone are much weaker. The count, sizes and types vary too much
between similar houses, and the back and sides of a house aren't visible from the street.

Two things make the system "smart":

1. **Your own completed jobs.** Address → actual measured siding squares, window count and
   sizes, doors, final price. Calibrating on these beats any generic rule of thumb. Nobody
   else has this data for your market.
2. **A few homeowner answers plus their photos.** Three questions ("How many windows do
   you want replaced?", "Which doors?", "Is any of the exterior brick or stone?") narrow the
   range more than any amount of modeling.

## What drives each estimate

### Siding area (squares = 100 sq ft)

The industry method is the same across manufacturer and supplier calculators
([Omni Calculator](https://www.omnicalculator.com/construction/siding),
[Kaycan vinyl estimator](https://kaycan.com/estimator/),
[Hunker worked example](https://www.hunker.com/13413970/how-to-calculate-siding-for-a-24x24-garage/)):

```
net wall area = Σ(wall length × wall height) + Σ gable triangles (base × rise ÷ 2)
                − window & door openings − masonry/stone areas
order quantity = net wall area × (1 + waste)   # waste typically 5–10%+, depends on product & complexity
squares        = ceil(order quantity ÷ 100)
```

How each term is filled in, from best data to worst:

| Term | Best source | Fallback | Main error risk |
|---|---|---|---|
| Wall lengths (perimeter) | Building footprint polygon (Microsoft/Overture/Regrid) | `4 × √(finished sq ft ÷ stories) × shape factor` | Attached garage, porches, bump-outs. Assessor sq ft usually **excludes** the garage, but the footprint includes it. |
| Wall height | Stories × floor-to-floor height, checked against 3DEP lidar height | Assessor "stories" field | Split-levels, walk-out basements, tall foundations, 9–10 ft ceilings |
| Gables | Roof shape from lidar; a homeowner photo | Assume one gable pair on the short walls | Roof pitch and number of gables/dormers drive this term most. |
| Openings | Window/door estimate (below) | Fixed % of gross wall | Usually deducted. Some estimators leave small openings in as extra waste. |
| Masonry | Homeowner answer or photo | Assessor exterior-wall field (often records only the dominant material) | A brick front can remove a large share of the siding area. |
| Trim, soffit, fascia, corners | Perimeter and eave length | Ratio from your past jobs | Often a large share of labor, so model it as its own line item. |

### Windows

- **No reliable public rule of thumb exists.** The most-quoted heuristic, about one window per
  100 sq ft, comes from a window-cleaning forum, not a study
  ([forum thread](https://community.windowcleaner.com/t/average-sq-foot-window-count/5363)). Style,
  era and climate shift the count a lot.
- **Count isn't the main price driver.** Size, operating type (double-hung, casement, slider,
  picture, bay/bow, specialty shapes), grids, glass package, and full-frame vs insert install
  all move the price more than counting does.
- **What works:** a model trained on your past jobs predicts a count *range* from sq ft, beds,
  baths, stories, year built and style. A front photo then gives an exact front count, and a
  ratio per house style extrapolates the sides and back until the homeowner adds those photos.

### Doors

Count is small (entry, patio, garage-to-house, side/back, storm doors, garage doors), but each one
is a separate product decision: single/double entry, sidelights, transom, slider vs French,
frame replacement vs slab, hardware. **Ask, don't infer.** A short checklist is more accurate and
quicker for the homeowner than any model.

## Methods compared

| Method | What it does | Strengths | Weaknesses | Use it for |
|---|---|---|---|---|
| **Geometry rules** (formula above) | Perimeter × height + gables − openings | Transparent, explainable, works on day one | Garbage in, garbage out on stories, gables, masonry | Siding baseline in the MVP |
| **Statistical model on your jobs** (quantile regression or gradient boosting) | Learns corrections and ranges (P10/P50/P90) from actual job data | Calibrated *ranges*, learns your market's housing stock | Needs labeled history; aim for 100+ jobs to start, more per house style | Correct the rules; predict window/door counts; set range widths |
| **Multimodal LLM vision** (Claude, Gemini, GPT) on homeowner photos | Counts windows and doors, classifies siding material, style and gables, flags brick | No training needed, fast to prototype, gives reasons | Count errors on cluttered or angled photos; no metric scale | Phase 2 prototype; always confirmed by the homeowner or a rep |
| **Detection/segmentation models** (e.g., Meta SAM 3 text-prompted masks; a fine-tuned YOLO-family detector) | Pixel masks for wall, window, door, trim | Precise masks; the same masks feed visualization later | Needs labeled photos from your market for reliable counts | Phase 2–3: counting + visualization masks |
| **Multi-photo 3D / photogrammetry** (Hover) | Real measurements of all elevations | Near quote-grade | Homeowner has to walk around the house; per-job fee | Qualified leads before or instead of a site visit |
| **Aerial oblique measurement** (EagleView Walls) | Wall areas from aerial images | No homeowner effort | Per-report fee; basic tier doesn't subtract openings; field verify before ordering | Booked appointments; pre-visit prep |

**Research benchmark.** Suppa et al. (2025) used a YOLOv9 model on Google Street View images
to estimate window-to-wall ratio. They report **94% of façades within ±5 percentage points** of
ground truth ([Politecnico di Torino](https://iris.polito.it/handle/11583/3001390)). A Chalmers
image-to-3D façade parser reported about 5% WWR error ([arXiv 2508.04406](https://arxiv.org/html/2508.04406v1)).
That's encouraging, but it measures a *ratio on visible façades*, not window counts and sizes
for every side. It was academic work: as noted in [01-data-sources.md](01-data-sources.md),
Google's terms bar commercial analysis of Street View. Meta's SAM 3 (released Nov 2025)
segments every instance of a text-prompted concept like "window," which makes building your
own masks practical ([SAM 3 repo](https://github.com/facebookresearch/sam3)). Check its
license file before commercial use.

## How accurate? (planning assumptions, not measurements)

> **I found no published benchmark for address-only siding or window estimates.** The numbers
> below are my judgment, based on the error sources above, and they're there to set
> expectations. Phase 0 (see [04-architecture-and-roadmap.md](04-architecture-and-roadmap.md))
> exists to replace them with your measured error on your own past jobs.

| What the system knows | Siding area | Window count | Doors | Price range you can honestly show |
|---|---|---|---|---|
| Address only (assessor + footprint + lidar + rules) | roughly ±20–35% | roughly ±30–50% | guess | Wide. Show it as "typical homes like yours" |
| + 6–8 homeowner answers (scope, counts, doors, masonry, stories) | roughly ±15–25% | near exact count (homeowner counts); sizes unknown | exact | Moderate. Good enough to book an appointment |
| + guided photos of all sides (CV-assisted, rep confirms) | roughly ±10–15% | exact count; sizes approximate | exact | Narrow. "Estimate, subject to measurement" |
| + Hover or EagleView measurement | vendor-grade (field-verify before ordering) | measured | measured | Proposal-grade |

For comparison, roofing instant-quote tools work because roofs are fully visible from above.
Roofle's RoofQuote PRO reports 2.4M+ quotes and 15K+ contractor users and advertises
"99% accurate" roof measurements. Those are vendor claims with no independent test I could find
([ContractorToolStack](https://contractortoolstack.com/software/roofle/),
[Roofle × GeoSpan](https://offers.roofle.com/partners/geospan?hsLang=en)). **Walls, windows and
doors are much harder to measure remotely than roofs.** Expect wider ranges and lean harder on
homeowner input.

## Which homeowner details improve the estimate most (ranked)

1. **Scope.** Which windows, doors and walls they actually want done. A whole-house job vs "the
   four front windows" is the biggest price swing, and only they know it.
2. **Product tier and material** (vinyl / fiber cement / engineered wood; good / better / best).
   Material choice moves the price as much as size. The 2025 Cost vs. Value report puts
   the average fiber-cement siding job at **$21,485** nationally
   ([JLC Cost vs. Value 2025](https://www.jlconline.com/cost-vs-value/2025/)), and Consumer
   Reports, citing the same report, puts vinyl at "nearly $18,000"
   ([Consumer Reports](https://www.consumerreports.org/home-garden/siding/buying-guide/)).
   Your own price book should replace these.
3. **Window count per side, plus types**, and a tape-measured width × height of 2–3 typical windows.
4. **Photos of each elevation** (front, back, left, right) and one of the front door.
5. **Brick or stone portions**, and **gables or dormers** (yes/no plus a photo).
6. **Door checklist**: entry (single/double, sidelights, transom), patio (slider/French),
   garage-to-house, storm doors, garage doors. Note frame vs slab.
7. **Current siding material and condition**: layers to tear off, known rot, insulation board wanted.
8. **Year built.** Pre-1978 homes trigger EPA RRP lead-safe work practices for window replacement
   unless testing shows no lead paint
   ([EPA RRP and windows](https://www.epa.gov/lead/does-lead-renovation-repair-and-painting-rrp-rule-apply-work-windows-have-been-installed)).
   That changes labor cost.
9. **HOA or historic-district rules** that restrict colors and materials.
10. **Timeline and financing interest.** These don't change the estimate, but they matter a lot for sales.

## Pricing is a separate engine from measuring

Keep **quantities** (squares, linear feet, units) separate from **price**. The price engine
applies your price book: product SKUs and tiers, regional labor rates, tear-off, disposal,
permits, RRP surcharge, job minimums, margin, and seasonal promos. Regional differences
are real but poorly documented in public sources. Use your own costs, not national averages.
Cost guides disagree widely; for example, Fixr puts a typical siding job at $8,500–$20,000
([Fixr 2026](https://origin-2.fixr.com/costs/siding-replacement)).

**Tax-credit note for marketing copy:** the federal 25C credit for energy-efficient windows and
doors ended for property placed in service after **Dec 31, 2025** under the July 2025 budget law
([Five Seasons Windows](https://www.fiveseasonswindows.com/federal-tax-credits-for-windows-in-colorado-what-happened-to-25c-and-what-s-left-in-2026),
[Instead](https://instead.com/resources/blog/what-section-70505-ended-for-the-25c-home-energy-credit)).
Don't advertise it for 2026 installs. Check state and utility rebates for your region instead.
