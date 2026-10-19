# Open map option (OpenStreetMap stack) — research, October 2026

> **How to read the sources.** This session's network policy blocked direct page loads, so the
> service policies below come from search-indexed copies of the cited pages. The MapLibre facts were
> checked directly in the `maplibre-gl@6.12.0` npm package. Confirm the policies on the live pages
> before launch.

No separate mapping product called "OpenMap" turned up. Every relevant result pointed to the
OpenStreetMap (OSM) ecosystem, so this note evaluates that. (BBN's older OpenMap is a Java
toolkit and doesn't fit a browser app.)

## Implementation update — October 18, 2026

v0.8 now implements this display-only hybrid as **Explore map**, with lazy self-hosted MapLibre, source attribution, temporary building highlights and the static aerial fallback. OpenFreeMap’s live commercial-use/attribution guidance and MapLibre’s CSP guidance were reviewed. Actual browser requests to the public metadata/vector/glyph service returned HTTP 200. See [implementation and verification](14-interactive-property-map.md). The original planning notes below remain as research context.

## Verdict

**It meets the open-source bar. Adopt it as a map layer next to the existing NAIP aerial image,
not as a replacement.**

- **The code is open source.** MapLibre GL JS is BSD-3-Clause, OpenFreeMap's server code is MIT,
  and Protomaps/PMTiles is BSD-3-Clause.
- **The data is open.** OSM data is under ODbL. It's free for commercial use, but it requires
  visible attribution, and a *derived database* you distribute must stay under ODbL.
- **What it adds:** street names, house-level building outlines, a map that pans and zooms
  smoothly, and a way to tap a building to select it. Later it can suggest a footprint perimeter
  as the starting point for siding.
- **What it doesn't add:**
  - **No aerial or satellite imagery.** OSM and OpenFreeMap serve drawn maps only, so USGS NAIP
    stays.
  - **No wall heights, window counts or measurements.**
  - **No address search as you type.** The public geocoder forbids it, so Census stays.

## The pieces

| Piece | Open option | License / cost | Usage rules for the hosted service | Fit for CurbQuote |
|---|---|---|---|---|
| Map renderer | **MapLibre GL JS** 6.x (6.12.0 is the pinned renderer version) | BSD-3-Clause, free, no key | Self-hosted library, so no service rules apply. v6 is ESM-only and **requires WebGL2**. About 300 KB of gzipped JS (main 152 KB, shared 147 KB, worker 6 KB) plus 11 KB of CSS. | ✅ Use it |
| Basemap tiles (hosted) | **[OpenFreeMap](https://openfreemap.org)** public instance (Liberty / Bright / Positron styles) | Free, no key, no sign-up, no stated view limits. Commercial use is allowed with attribution: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" ([site](https://openfreemap.org), [OSM wiki](https://wiki.openstreetmap.org/wiki/OpenFreeMap)) | **No SLA.** One maintainer, running on about $500/month in donations. A 2025 load spike of about 100K requests/second still answered 96% of requests ([author's post](https://blog.hyperknot.com/p/openfreemap-survived-100000-requests)). No geocoding, routing or satellite. | ✅ Fine for the prototype and an early launch. Sponsor it if you depend on it. |
| Basemap tiles (self-hosted) | **[Protomaps](https://protomaps.com/faq) PMTiles**: one static file served with HTTP range requests | Free software. You pay only for your own storage and bandwidth. | You control it. Cut a U.S. extract and put it on object storage. | ✅ Move here before scale or if OpenFreeMap becomes a risk |
| OSMF's own tiles | `tile.openstreetmap.org` (raster), `vector.openstreetmap.org` | Free | Donation-funded, best effort, with no SLA. Can block you without notice. No bulk or prefetch downloads, and a valid identifying User-Agent is required ([raster policy](https://operations.osmfoundation.org/policies/tiles/), [vector policy](https://operations.osmfoundation.org/policies/vector/)) | ❌ Not for a commercial production site |
| OSM US Tileservice | `tiles.openstreetmap.us` | Free tier is for low-volume, **non-commercial** use only | Revenue-generating use needs written permission ([policy](https://tiles.openstreetmap.us/usage-policy/)) | ❌ Not without an agreement |
| Geocoding | Public **Nominatim** | Free | **Max 1 request/second, no client-side autocomplete**, and results must be cached ([policy](https://operations.osmfoundation.org/policies/nominatim/)). CurbQuote's 700 ms automatic lookup counts as search-as-you-type. | ❌ Keep the Census geocoder. Self-hosted Nominatim or Photon is an option later. |
| Building outlines (display) | OSM `building` layer in OpenFreeMap tiles (includes `render_height`) | ODbL | Comes with the tiles | ⚠️ U.S. coverage is uneven, and many OSM buildings have no address or height |
| Building outlines (measurement) | **Overture Maps** buildings, which merge OSM, Microsoft, Google and Esri footprints ([Overture](https://overturemaps.org/?p=1003)) | ODbL | Bulk download (GeoParquet). Needs a server-side pipeline. | ✅ Best open source for a perimeter suggestion, as [docs/01](01-data-sources.md) already recommends |
| Aerial imagery | None in OSM. Keep **USGS NAIP**. | Public domain | Government service, no key | ✅ Already integrated. Esri World Imagery and MapTiler satellite are commercial, not open. |

## How it fits the v0.6 prototype

Today the preview is one static NAIP `exportImage` JPEG (`property-view.js`, `property-preview.js`).
It loads with no remote scripts, and its CSP allows only same-origin scripts and connections. An
open map can keep that strict security posture:

1. **Self-host MapLibre.** Copy `maplibre-gl.mjs`, `maplibre-gl-shared.mjs`,
   `maplibre-gl-worker.mjs` and `maplibre-gl.css` into `dist/` from `scripts/build.mjs`. No CDN is
   involved. The 6.12.0 source starts the worker as a plain module `Worker` when its URL is
   same-origin and only falls back to a `blob:` wrapper for cross-origin URLs. That means
   `script-src 'self'` holds and the CSP only needs `worker-src 'self'`.
2. **Widen the CSP** in `lib/web.mjs` (the static demo derives its meta-tag policy from it):
   - `connect-src 'self' https://tiles.openfreemap.org`: style, tiles, fonts and sprites. MapLibre
     fetches tiles instead of using `<img>` tags.
   - Add the NAIP origin to `connect-src` if NAIP is loaded as map tiles.
   - Add `blob:` to `img-src`, which [MapLibre's docs](https://maplibre.org/maplibre-gl-js/docs/)
     list as required.
3. **Build a hybrid view.** Add NAIP as a MapLibre raster source with the `{bbox-epsg-3857}` token:
   `…/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image`.
   MapLibre emits `minx,miny,maxx,maxy`, which matches the ArcGIS `bbox` order (checked in the
   package source; not yet run against the live service). Then draw the OSM street labels and
   building outlines on top.
4. **Keep the current static image as the fallback** for devices without WebGL2 or when the tile
   service fails. The existing retry, timeout and stale-result handling can wrap the map's `load`
   and `error` events.
5. **Show attribution** in MapLibre's attribution control: "OpenFreeMap © OpenMapTiles Data from
   OpenStreetMap" plus the existing USGS/USDA credit.
6. **Update the privacy text.** OpenFreeMap would see the viewer's IP address and the area being
   viewed, the same exposure USGS has today.
7. **Keep the estimator boundary unchanged.** The map stays display-only. Tapping a building can
   recenter or highlight it, but no map geometry enters the estimate until the perimeter work
   below is designed and tested.

## Recommended path

1. **v0.7 (prototype):**
   - Build a MapLibre + OpenFreeMap + NAIP hybrid preview, display-only, with the static NAIP
     image as a fallback.
   - Add fixture tiles and styles to the Chromium QA so CI doesn't depend on OpenFreeMap.
   - Add an opt-in live check, like `test:preview:live`.
2. **Before public launch:**
   - Choose between the public OpenFreeMap instance (sponsor it) and a self-hosted U.S. PMTiles
     extract.
   - Confirm the policies above on their live pages.
3. **Later:**
   - Join Overture footprints to the matched address on the server.
   - Offer "suggested perimeter from map data" as an editable, source-labeled starting value that
     the homeowner confirms.
   - Get counsel's read on ODbL share-alike before storing or exporting derived footprint data.

## Sources

- OpenFreeMap: [site and quick start](https://openfreemap.org/quick_start/), [styles repo](https://github.com/hyperknot/openfreemap-styles), [OSM wiki entry](https://wiki.openstreetmap.org/wiki/OpenFreeMap), [load-spike post](https://blog.hyperknot.com/p/openfreemap-survived-100000-requests)
- OSMF policies: [raster tiles](https://operations.osmfoundation.org/policies/tiles/), [vector tiles](https://operations.osmfoundation.org/policies/vector/), [Nominatim](https://operations.osmfoundation.org/policies/nominatim/), [attribution guideline](https://osmfoundation.org/wiki/Attribution)
- [OSM US Tileservice usage policy](https://tiles.openstreetmap.us/usage-policy/)
- MapLibre: [docs (CSP directives)](https://maplibre.org/maplibre-gl-js/docs/), [style spec sources (`{bbox-epsg-3857}`)](https://maplibre.org/maplibre-style-spec/sources), [v6 release](https://maplibre.org/news/2026-08-02-maplibre-newsletter-jul-2026/)
- [Protomaps FAQ](https://protomaps.com/faq)
- [Overture buildings release notes](https://overturemaps.org/?p=1003)
- [MapTiler Cloud pricing](https://www.maptiler.com/cloud/pricing/) (commercial alternative, for comparison)
