# CurbQuote

**See your home, then see what new siding, windows and doors could cost, with every number explained.**

Status: **v0.15 UI/UX prototype** (October 2026). CurbQuote is a homeowner planning tool. It doesn't
measure buildings from an address and doesn't give binding contractor quotes. Prices are editable
examples, and accuracy hasn't been checked against completed jobs yet.

## What the MVP does

1. **Find the home.** Type a U.S. address. After a short pause, the Census Bureau matches an
   approximate location, the open building outline sizes the house automatically, and an instant
   estimate appears under the address: **See my estimate** is the only click needed to reach the
   full breakdown. A "What each property view shows" summary on the same panel explains the
   aerial photo, the optional Google 3D view, the Austin lidar example, the remodel studio and your
   own photo, and what each one can and cannot tell you.
2. **See it in 3D.** When a 3D credential is configured, Google's photorealistic 3D model opens on
   the address, angled like a drone shot. The Top view, rotate and recenter buttons adjust it, and
   "Aerial photo" switches to the free USGS image. The 3D view is display-only. Without a
   credential, or if Google refuses the key, **View in 3D** shows key-free open 3D buildings
   (OpenStreetMap heights over the aerial photo); on devices without WebGL2 the aerial photo shows.
   The full fallback order is in [docs/20](docs/20-v015-redesign-3d-and-fallbacks.md#property-view-fallback-chain).
   **Exterior prototype:** select **Try an exterior example** for a key-free model
   of a public Austin house, built from USGS lidar and a city footprint. It shows
   a measured roof surface and simplified walls. This covers one reviewed property;
   it does not supply estimate measurements. See [the prototype guide](docs/15-lidar-exterior-prototype.md).
3. **Build the budget.** Pick siding, windows and doors, then a material and a Standard, Enhanced or
   Premium tier, and enter the home's measurements. Steps 3 and 4 keep a running estimate visible
   (with a "Preview in 3D" route into the studio), and each product shows its example installed
   price for the tier you picked. You get an itemized range and see how each number was calculated.
4. **Plan and visualize.**
   - Compare plans against a budget, or let the assistant suggest one.
   - Pick one of 16 North-American home styles, then walk around your home in the **3D remodel**
     studio: a house sized from your measurements you can restyle with your siding (12 colors),
     roof color and covering, trim and masonry, view from six angles or in four lighting presets,
     try a porch, dormers, shutters, a garage or a picket fence,
     flip between Before and After, drag the split seam directly on the canvas, and download the
     view. Before and After are labelled with what they mean, the studio says plainly that it is a
     concept model, and additions are shown, not priced yet. A visual cost-share bar explains how
     the illustrative range is divided. On phones the total offers a one-tap jump to the studio.
   - Try siding colours on the example house, or on your own photo after you mark its walls.
5. **Keep it.** Save projects on this device, then download or print the summary for a contractor.

## Quick start

Requires Node 22.x.

```bash
npm ci --ignore-scripts
npm run dev            # http://127.0.0.1:3000
npm run check          # syntax checks, 104 Node tests, public build
npm run test:browser   # 61 Chromium checks with fixture data (needs Playwright's Chromium)
npm run test:exterior  # real local exterior model, Google 3D measuring pass, controls and fallback
```

## Configuration

**Step-by-step setup for every service, with links: [docs/SETUP.md](docs/SETUP.md).**

Copy `.env.example` to `.env.local` for local runs and set the same variables in Vercel. Every
variable is optional; the app works without any of them.

| Variable | Turns on | Notes |
|---|---|---|
| `CESIUM_ION_TOKEN` | 3D view through Cesium ion's free plan (testing) | Token with only `assets:read`, restricted to your site URLs. Not for launch. |
| `GOOGLE_MAP_TILES_KEY` | 3D view directly from Google (launch) | Needs Google Cloud billing. Restrict the key to the Map Tiles API and your domains, and cap it at 30 sessions a day to stay free. Wins over the ion token. |
| `AI_GATEWAY_API_KEY`, `AI_GATEWAY_MODEL` | AI project assistant | Vercel deployments can use OIDC instead of a key. Without either, the automatic planner still works. See [docs/08](docs/08-agentic-planning.md). |
| `PROPERTY_*`, `DATA_USE_APPROVED` | Licensed property-record lookups | Only with a signed data agreement. See [docs/09](docs/09-property-data-adapter.md). |

Never paste these values into chats, screenshots or commits. The 3D credentials reach the browser
by design, which is why they must be restricted.

## Deploy

Deploy the repository root to Vercel with the checked-in `vercel.json`:
- `npm run build` writes the browser files and the self-hosted CesiumJS runtime to `dist/`.
- `api/` holds the Node functions: `geocode`, `property`, `assistant` and `map3d`.
- Security headers come from `lib/web.mjs`, and a test keeps `vercel.json` identical to them.

**GitHub Pages demo:** `npm run build:pages` makes a static copy that runs without a server.
Address lookup, 3D, estimates and saving work; the AI assistant and licensed property data don't.
`.github/workflows/pages.yml` deploys it from `main`. Setup is in [docs/SETUP.md](docs/SETUP.md#2b-github-pages-demo-free-static).

## Project layout

| Path | Contents |
|---|---|
| `index.html`, `styles.css`, `main.js` | The page and its wiring |
| `estimate.js`, `project.js`, `planning.js`, `summary.js` | Estimate maths, product catalog, plan comparison, report text |
| `address.js`, `property-*.js` | Address checks, aerial photo, 3D view, property-record review |
| `photo-editor.js`, `storage.js`, `assistant-ui.js` | Photo colour preview, device storage, assistant panel |
| `api/`, `lib/` | Server endpoints and shared server code (geocoding, property adapter, agent, security headers) |
| `scripts/` | Dev server, build, property ingestion |
| `tests/`, `qa/` | Node tests and Chromium browser checks |
| `tools/`, `data/` | Python ingestion tool and the job back-test template |
| `docs/` | Research and implementation notes, listed below |

## Documentation

**Using and building the MVP**

| # | Document | What's in it |
|---|---|---|
| — | [Setup guide](docs/SETUP.md) | Every service and key: what it's for, cost, links and step-by-step instructions |
| — | [README-MVP.md](README-MVP.md) | Homeowner flow, estimate formulas, limitations and pre-launch blockers |
| 6 | [Stabilization audit](docs/06-stabilization-audit.md) | Source review, fixes, remaining launch blockers |
| 7 | [Functional prototype](docs/07-functional-prototype.md) | Flows, browser storage, hosting |
| 8 | [Planning and assistant](docs/08-agentic-planning.md) | Automatic planner, AI assistant setup |
| 9 | [Property data adapter](docs/09-property-data-adapter.md) | Licensed provider setup and review workflow |
| 10 | [Live property preview](docs/10-live-property-preview.md) | Census matching and the USGS aerial photo |
| 13 | [3D view](docs/13-google-3d-view.md) | Google 3D via CesiumJS: setup, free-tier cap, security changes, open questions |
| 15 | [Lidar exterior prototype](docs/15-lidar-exterior-prototype.md) | One-property example, data provenance, rebuild steps and SAT-Skylines integration path |
| 16 | [3D remodel studio](docs/16-3d-remodel-studio.md) | Editable before-and-after 3D house from the homeowner's measurements: materials, additions, limits |
| 17 | [Homeowner journey UI/UX](docs/17-homeowner-journey-ux.md) | The v0.11 review: findings, design direction, what changed, remaining limitations |
| 18 | [Inline Step 3 3D preview & split UX](docs/18-3d-preview-and-split-ux.md) | The v0.12 review: Step 3 inline 3D preview, Before/After split wipe, Step 4 rate summary/reset, Step 5 caveats card |
| 19 | [v0.14 visual and interaction pass](docs/19-v014-ui-ux.md) | On-canvas split dragging, cost-share visuals, proportional framing, and responsive screenshot review |
| 20 | [v0.15 redesign, 3D and fallbacks](docs/20-v015-redesign-3d-and-fallbacks.md) | One design system, rebuilt roof geometry for 16 home styles, studio finishes and lighting, the key-free property-view fallback chain, and backend caching and limits |

**Research**

| # | Document | What's in it |
|---|---|---|
| 1 | [Data sources](docs/01-data-sources.md) | Zillow, Redfin, MLS, property-record APIs, footprints/lidar, street and aerial imagery, measurement vendors: what each provides, access, cost, terms/licensing |
| 2 | [Estimates](docs/02-estimation.md) | Siding/window/door methods, expected accuracy, the homeowner inputs that matter most |
| 3 | [Visualization](docs/03-visualization.md) | Real-time vs pre-rendered, tools and APIs, guardrails |
| 4 | [Architecture and roadmap](docs/04-architecture-and-roadmap.md) | System design, data model, unit costs, phases 0–4 |
| 5 | [Assessment](docs/05-assessment.md) | Honest take: risks, what to change, what's missing |
| 11 | [Open map option](docs/11-open-map-option.md) | OpenStreetMap stack (MapLibre, OpenFreeMap, PMTiles, Overture): licenses, hosted-service rules, CSP fit |
| 12 | [3D and AI-generated maps](docs/12-3d-and-ai-map-alternatives.md) | Google 3D, Flight Simulator (Blackshark.ai), Cesium, open 3D OSM, AI world generators, phone capture: real vs AI-guessed, cost |
| — | [Research corrections](docs/research-corrections.md) | Fixes to earlier research claims |
| — | [Back-test template](data/backtest-template.csv) | Columns to export from past jobs for Phase 0 |

## Roadmap (not built yet)

1. Pull property details and building geometry from licensed sources or open building footprints,
   so measurements start pre-filled.
2. Sign-in with Google or Apple, so projects follow the homeowner across devices.
3. Calibrate prices and ranges against completed jobs.
4. ✅ First cut built: the 3D remodel studio restyles a measurement-sized model. Next, shape that
   same editable model from a reviewed footprint and LiDAR heights so it matches the real outline.

## Research summary

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
