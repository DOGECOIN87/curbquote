# 1. Data sources: property details and exterior imagery by address

> **How to read the sources.** I read Google's Maps Platform terms in full on the primary
> pages. Those findings are marked **[verified]**. Every other figure comes from
> search-indexed copies of the cited pages or from third-party reviews, because the research
> environment couldn't open most vendor sites directly. Vendor prices are "starting at" or
> reported figures and change often. Get written quotes and read each contract's
> storage and derivative-use clauses before you budget or build.

## The short version

- **Zillow, Redfin, and MLS photos are not a usable foundation.** Their terms forbid
  scraping. Listing photos are copyrighted by photographers and licensed only to market that
  listing. MLS data goes only to brokers and their vendors for defined uses, and
  home-improvement lead generation isn't one of them.
- **Licensed property-record APIs** (ATTOM, Cotality, RentCast, Regrid, BatchData) or your
  county assessor give you square footage, beds, baths, stories, year built and often exterior
  wall material. Unlike portals, they sell commercial licenses.
- **Free open datasets** (Microsoft/Overture building footprints, USGS 3DEP lidar) give you
  the building outline and height. That's what siding math actually needs.
- **Google is mostly display-only for this use.** Its terms bar storing Street View images,
  creating content (e.g., an index) from them, and using them to train or test ML. The Solar
  API is licensed only for energy-system work. **[verified]**
- **Exterior photos should come from the homeowner** (guided capture). That solves copyright,
  gets all four sides, and is the only free source with full coverage. Pay for licensed aerial
  or measurement products (EagleView, Hover, Nearmap) only on qualified leads.

---

## A. Listing portals and MLS

| Source | What it provides | How to get access | Rough cost | ToS / licensing / photo limits for this use | Fit |
|---|---|---|---|---|---|
| **Zillow** (site + Bridge Interactive APIs) | Listing data via MLS feeds, Zestimates, public-records datasets | Legacy public APIs (GetSearchResults, GetZestimate, etc.) were shut down **Sept 30, 2021**. Today's access is through Bridge Interactive (bridgedataoutput.com), which approves each use case. One source says it's limited to MLS-affiliated brokers. Developers report requests refused as "derivative works." ([Zillow Zestimates API page](https://www.zillowgroup.com/developers/api/zestimate/zestimates-api/), [Supergood API report card](https://supergood.ai/api-report-card/zillow-api), [Vorp Labs summary](https://vorplabs.com/agent-tools/zillow-cli)) | Not published | Terms prohibit automated queries, scraping, robots/crawlers ([summary of Zillow ToS](https://vorplabs.com/agent-tools/zillow-cli)). Photos belong to photographers/brokers under limited licenses. Photographers have sued Zillow over photo use beyond the license ([Inman, 2018](https://www.inman.com/2018/09/20/real-estate-photographer-sues-zillow-for-copyright-infringement/)). **No license to those photos passes to you.** | ❌ Don't build on it. Don't scrape it. |
| **Redfin** | Consumer listing site; Redfin publishes market-level (not property-level) downloads | No public property API is offered (per third-party sources; I couldn't confirm this on Redfin's own pages) | n/a | "No Scrubbing or Scraping" clause: no automated crawling or querying without prior express written permission. Separate restriction on redistributing MLS-sourced content ([Redfin Terms of Use](https://www.redfin.com/about/terms-of-use), [ConductAtlas clause summary](https://conductatlas.com/platform/redfin/redfin-terms-of-use/prohibition-on-scraping-mls-data/)) | ❌ Not viable |
| **MLS** (RESO Web API through each local MLS, via platforms like Cotality Trestle, Bridge, MLS Grid) | Active and sold listings: beds, baths, sq ft, often construction/exterior fields, **listing photos** | **Per-MLS license.** There's no nationwide endpoint. Vendors typically sign the MLS's data license *and* are sponsored by a participating broker/agent. Use is limited to the license type (IDX for public display, VOW, broker back-office). RESO certification is a technical standard, not a data right ([ScrapeGraphAI MLS overview](https://scrapegraphai.com/blog/mls-api), [SDMLS access types](https://support.sdmls.com/support/solutions/articles/150000215163-types-of-data-access-and-how-to-apply), [Hawaii Information Service](https://www.hawaiiinformation.com/?p=2916), [API Evangelist on Trestle](https://providers.apievangelist.com/providers/trestle/)) | Varies by MLS. Example: Canopy MLS via MLS Grid, **$500 setup + $100/mo** ([Canopy MLS data licensing](https://go.canopymls.com/data)). Others add per-request fees. | IDX/VOW licenses exist to display listings for sale, not to analyze homeowners' houses for remodeling leads. Photos are licensed to market *that listing* and often expire after the sale. Photographers have sued Realtor.com, Zillow and others over post-license use ([FKKS on Realtor.com suit](https://advertisinglaw.fkks.com/post/102h5ul/complaint-fails-to-allege-sufficient-volitional-conduct-to-make-realtor-com-liabl), [NAR on MLS photo suits](https://www.nar.realtor/realtor-ae-magazine/lawsuit-over-photo-copyright-in-mls-dismissed)). Coverage is limited to homes that were listed. | ⚠️ Only if a broker partner and your MLS approve the use in writing. Plan without it. |

## B. Property-record (assessor/deed) data providers

These are the realistic primary source for "square footage, beds, baths, stories". They resell
county assessor and recorder data under commercial licenses. **Caveat for all of them:** assessor
data is collected for taxation. Fields like exterior wall material are often recorded from what's
visible at the street, and only as the *dominant* material
([Lancaster County, PA assessor FAQ](https://lancastercountypa.gov/DocumentCenter/View/21094/PRCreviewFAQ-Reval)).
Counties describe their data as "for tax assessment purposes only … not necessarily survey grade"
([LA County parcel layer](https://dpw.gis.lacounty.gov/dpw/rest/services/gisapps/MapServer/0)).
Square footage usually excludes garages, and the stories field is often missing.

| Source | What it provides | How to get access | Rough cost | Licensing notes for this use | Fit |
|---|---|---|---|---|---|
| **ATTOM** | Nationwide assessor, tax, deed and sales data. Building characteristics typically include living area, beds/baths, stories, year built, construction/exterior and roof types (confirm field fill rates for your counties) | 30-day free trial at cloud.attomdata.com. Production through sales; transaction-based or subscription plans ([ATTOM support: pricing](https://support.attomdata.com/articles/9704145040-api-pricing-trial-extensions-and-paid-plans), [What is the ATTOM API](https://support.attomdata.com/articles/3952343496-what-is-the-attom-property-data-api)) | Not published. Third-party claims range from **$95/mo** to an annual contract with a **~$6K+ minimum** (the latter from a competitor) ([Tortus comparison](https://tortus.io/developers/compare/attom), [apis.io](https://apis.io/plans/attom-data/attom-data-plans-pricing/)) | Commercial license. **Negotiate the right to store results and derive estimates.** | ✅ Strong candidate for production |
| **Cotality** (formerly CoreLogic) | Deep property, tax, deed and MLS data (Trestle) | Enterprise sales. Most products are delivered by cloud data share or SFTP rather than self-serve API ([apis.io](https://apis.io/plans/corelogic/corelogic-plans-pricing/), [API Evangelist](https://providers.apievangelist.com/providers/corelogic/)) | Not published (enterprise) | Contracted | ⚠️ Best-in-class, but probably more than you need at first |
| **RentCast** | 140M+ property records from public records and deeds: sq ft, beds/baths, year built, lot, owner, value estimates ([RentCast API docs](https://developers.rentcast.io)) | Self-serve API key | Reported tiers: **free (50 req/mo)**, **$74/mo (1,000)**, **$199/mo (5,000)**, **$449/mo (25,000)**. Unverified, from [FitGap](https://us.fitgap.com/products/051875/rentcast) | Check the storage/caching terms and how often stories and exterior fields are filled | ✅ Cheapest way to prototype |
| **Regrid** | Nationwide parcel boundaries. Premium schema adds standardized assessor attributes. **187M+ building footprints matched to parcels** ([Regrid footprints](https://regrid.com/building-footprints)) | Self-serve API or bulk license ([Regrid API](https://regrid.com/api)) | 2023 API rates: about **$0.10/record standard, $0.15 premium, $0.28 premium + footprints**. Bulk nationwide $50K–$135K/yr; single counties from $300 ([Regrid 2023 price notice](https://regrid.com/blog/2023-parcel-data-price-change)). Check current rates. | Commercial license | ✅ Good for parcel + footprint in one call |
| **BatchData** | Property search/lookup, address autocomplete, skip tracing | Self-serve plans plus sales ([BatchData plans](https://batchdata.io/plan/growth), [help: pricing](https://help.batchdata.io/en/articles/11879949-batchdata-pricing)) | From about **$500/mo for 20K records** up to $2K–$10K/mo tiers (sources conflict) | Skip-tracing data used for cold outreach raises TCPA and state-law risk. Use only for inbound leads. | ⚠️ Alternative to ATTOM/RentCast |
| **County assessor / GIS portals** | The underlying public record: property record card, sketches (often with dimensions), parcels | Free downloads or ArcGIS REST endpoints. Formats differ county by county. | Free to low | Public records; check each county's reuse terms | ✅ Ideal for a single-county pilot (Phase 0) |

## C. Building geometry, imagery, and measurement

| Source | What it provides | How to get access | Rough cost | ToS / licensing / photo limits for this use | Fit |
|---|---|---|---|---|---|
| **Microsoft Building Footprints / Overture Maps / OpenStreetMap** | Building outlines → **perimeter** (the base of the siding calculation). Some heights. | Free download | Free | **ODbL** share-alike database license ([OSM wiki: Microsoft footprints](https://wiki.openstreetmap.org/wiki/Microsoft_Building_Footprints), [Overture release notes](https://overturemaps.org/?p=349)). Fine for internal analysis. Get legal advice before redistributing a derived *database*. | ✅ Use from day one |
| **USGS 3DEP lidar** (and Overture's 3DEP-derived heights) | Building height → stories, plus roof shape. Overture published heights for 6M+ US buildings from 3DEP ([Overture heights whitepaper](https://project.linuxfoundation.org/hubfs/Overture%20Maps/Building%20Heights%20Whitepaper_041423.pdf)) | Free download (point clouds need processing) | Free | Public domain (US government) | ✅ A 2026 USGS study found 3DEP-derived heights had **MAE 1.8–2.2 m** against a reference dataset ([USGS](https://www.usgs.gov/publications/evaluating-us-geological-survey-3d-elevation-program-lidar-data-a-source-building)). That's about half a story, good enough to separate 1 from 2 stories in most cases. Coverage and vintage vary by area. |
| **NAIP aerial imagery** (USDA/USGS) | Overhead orthophotos, about **0.6–1 m** resolution | Free ([USGS NAIP service](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer)) | Free | Public domain | ⚠️ Too coarse for windows. OK for a footprint sanity check. |
| **Google Street View Static API** | Street-level photo of the front of the house | Google Cloud API key | Billed per panorama, about **$7 per 1,000** after a monthly free threshold (reported as 10,000/mo for Essentials SKUs) ([Google usage & billing](https://developers.google.com/maps/documentation/streetview/usage-and-billing), [StoreRocket summary](https://storerocket.io/learn/google-maps-api-pricing)) | **[verified]** [Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms) (last modified Aug 26, 2026). No pre-fetching, storing, or bulk-downloading Street View images. No caching except listed IDs (you may cache `pano_id`). **"No Creating Content From Google Maps Content,"** with examples including "construct an index of tree locations within a city from Street View imagery" and "use Google Maps Content to improve machine learning and artificial intelligence models, including to train, test, validate or fine-tune the models." Running computer vision on Street View to count windows, then storing the counts, looks like the same pattern. | ⚠️ **Display only.** Show it to the homeowner ("Is this your house?"). Don't analyze or store it without written permission from Google and legal review. |
| **Google Solar API** | Building insights, roof segments, digital surface model (height), aerial RGB | Google Cloud API key | Billed per request (Building Insights and Data Layers are separate SKUs) | **[verified]** [Service Specific Terms §20.1](https://cloud.google.com/maps-platform/terms/maps-service-terms) (last modified Oct 15, 2026): "Customer may use the Solar API **only** (a) to determine the feasibility of installing energy systems … (b) to design or install an energy system, or (c) for a Downstream Transaction" (energy-system proposals and marketing). Caching is limited to 30 days. | ❌ **Not permitted for siding/window/door estimates** unless you're also quoting solar for that address |
| **Mapillary** (Meta) | Crowd-sourced street-level imagery | Free API | Free | **CC BY-SA 4.0**: commercial use allowed with attribution, share-alike on adapted images ([Mapillary license](https://help.mapillary.com/hc/en-us/articles/115001770409-CC-BY-SA-license-for-open-data)) | ⚠️ Legally usable for CV. Coverage is uneven, often outdated, and rarely shows a house clearly ([Atlas](https://atlas.co/data-sources/mapillary)) |
| **Nearmap** | High-res vertical and **oblique** aerials (show walls), frequent recapture, API; AI layers | Sales | Quote-based. Reported **~$2K+/yr** for small commercial ([SurgePV review](https://www.surgepv.com/reviews/nearmap-for-solar-review)). A 2026 public-agency schedule lists **$5,200/yr ortho, $6,025 with oblique** for the smallest tier ([NCTCOG 2026](https://www.nctcog.org/getmedia/896281ed-b5c4-4a54-9cd3-cc219c4a2311/Subscription_Pricing_2026.pdf)) | Commercial license. Confirm in writing that you may derive and store measurements. | ⚠️ Worth a quote once volume justifies it |
| **EagleView** (Walls / Windows & Doors reports) | Measured wall areas from oblique aerials. Higher tiers add window and door counts and sizes. Industry standard for "measure before you visit" | Order per address (web/app, API for partners) | Reported "starting at" prices: **Walls $18; Walls, Windows & Doors $24.25; precise version $40; Full House $67.50**. Contractors report $35–$87 after size factors ([EagleView Walls](https://www.eagleview.com/product/walls/), [ContractorToolStack](https://contractortoolstack.com/software/eagleview/)) | Report licensed to you per property. The basic Walls sample notes windows and doors are **not subtracted**, and field verification is still required before ordering material ([sample Walls report](https://www.eagleview.com/wp-content/uploads/2022/05/Walls-Report.pdf)) | ✅ For **qualified leads only**, not every anonymous lookup |
| **Hover** | Homeowner or rep takes ~8 phone photos → measured 3D model: siding, trim, **window and door sizes**, material lists. Also a design visualizer ([Hover product](https://hover.to/product)) | Contractor account. **Developer API** with OAuth credentials, webhooks and job deliverables ([Hover developer docs](https://developers.hover.to/docs/creating-and-managing-integrations)) | Reported **$29–$139 per project** plus a **$99/mo** Pro plan ([ContractorToolStack](https://contractortoolstack.com/software/hover/)) | Homeowner-captured, so no third-party copyright problem. Accuracy claims ("to-the-inch") come from the vendor; I found no independent test. | ✅ Best "tighten the estimate" step. Buy, don't build. |
| **Cape Analytics** (Moody's) | Imagery-derived attributes (roof condition, footprint, materials) for ~110M US structures ([Cape](https://capeanalytics.com/real-estate), [TechCrunch on Moody's acquisition](https://techcrunch.com/2025/01/13/moodys-agrees-to-acquire-cape-analytics-which-develops-geospatial-ai-for-insurance-providers)) | Enterprise sales | Not published | Contracted | ❌ Insurance-focused and enterprise-priced. Not a fit now. |

## D. Address entry (small but it matters)

- **Google Places Autocomplete:** familiar UX. You may store the `place_id`, but other Places content
  is restricted under the same no-scraping/no-caching terms **[verified]**. Reported at $2.83 per
  1,000 requests, with session pricing changing the math
  ([Smarty vs Google comparison](https://smarty.com/google-address-autocomplete-api-vs-smarty)).
- **Smarty:** USPS-validated autocomplete with flat plans, reported around **$20/mo for 5K lookups**
  ([TrustRadius](https://www.trustradius.com/products/smarty/pricing)). It returns a standardized
  address you can store and join against property-record APIs. **Recommended**, because the
  standardized address is the key you'll use everywhere.

## Recommendation

1. **Phase 0–1:** your county assessor data (free) + RentCast or an ATTOM trial + Microsoft/Overture
   footprints + 3DEP heights. Show Google Street View or a map pin only to confirm the house.
2. **Phase 2:** homeowner-uploaded photos as the imagery source, plus Hover (homeowner capture link)
   or EagleView ordered automatically when a lead books an appointment.
3. **Get every contract's storage and derivative-use rights in writing.** Tag every stored fact
   with its source and license (see [04-architecture-and-roadmap.md](04-architecture-and-roadmap.md))
   so you can honor deletion and caching rules later.
4. **Have counsel review** before launch. This is research, not legal advice.
