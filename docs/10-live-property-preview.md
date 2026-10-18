# Automatic property preview — v0.6

The property address and actual aerial preview are the first interactive controls on the page. The former decorative house graphic has been replaced; the separate design-studio illustration remains labeled as an example.

## Homeowner flow

1. Enter a street address with a state or ZIP code. After a 700 ms pause, the browser calls the existing `/api/geocode` Census handler. Short street fragments do not trigger automatic requests. Find property or Enter searches immediately; input-method composition waits until text entry completes.
2. A single valid match opens an aerial view centered on the **approximate Census address-range point**. It can land in the street or near a different building. No building identity is confirmed by the image or marker.
3. Use zoom, direction buttons, keyboard arrows, mouse dragging, or a tap on the image to bring the intended building into the center. Recenter returns to the original address point. These actions change only the view; they never change estimate dimensions or indicate a verified parcel boundary.
4. Address edits immediately remove the image and cancel in-flight lookups. Request serials prevent late address responses or imagery from reappearing on a different project. Saved-project and draft restoration refresh the address preview; AI-supplied Census matches use the same preview.
5. If a separately authorized property source is configured, automatic matching can also request its facts. Imports still require review and selection. Without a configured source, automatic previews make no paid-provider request. See [provider configuration](09-property-data-adapter.md).

## Imagery source and coverage

- Fixed endpoint: `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage`.
- USGS's [service metadata](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/info/iteminfo?f=pjson), checked October 17, 2026, describes natural-color aerial imagery, primarily 0.6-meter resolution, and public-domain NAIP downloads for the conterminous U.S. The service credits USGS, USDA and The National Map. Actual image resolution and acquisition dates vary.
- This implementation displays the NAIP image service directly. It does not use the separate USGS Imagery Topo Base Map [scheduled for retirement](https://www.usgs.gov/the-national-map-data-delivery/news/imagery-topo-base-map-retirement) on November 16, 2026.
- Current UI coverage is limited to the contiguous U.S. bounding region. Alaska, Hawaii and territories show an explicit unavailable state. Within the supported region, there can still be gaps, cloud/tree cover, older buildings, or blank imagery.
- The initial ground-view width is 180 meters, adjustable from 60–1200 meters. Web Mercator geometry accounts for latitude; the marker remains at the matched address coordinate when panning. View width is a navigation aid, not a building measurement.
- No vendor key, purchase, or subscription is configured for imagery. Public-service uptime and performance are outside the application's control. Cold requests can take several seconds; a 25-second client deadline exposes Retry imagery. Failures never block manual estimation or the existing homeowner-photo editor.

## Privacy and implementation boundaries

Typed complete addresses go to Census through the existing server route. Image URLs contain a numeric map bounding box, not address text. Images are loaded directly from USGS with `referrerPolicy=no-referrer`; USGS can see the client's network address and requested area. Panning can request nearby areas. The application does not persist these images, export them, perform computer vision, or send them to the AI assistant.

`property-view.js` contains projection, coverage and URL construction. `property-preview.js` owns display/cancellation, image loading and view controls. `main.js` schedules address searches and coordinates saved/assistant state. The browser's Content Security Policy permits external images only from the exact government export path; scripts and API connections remain same-origin. Both Node development and Vercel configurations use the same policy. No remote map JavaScript, iframe or new package was added. v0.7 widens the policy for the optional Google 3D view and changes `Referrer-Policy` to `strict-origin`; see [the 3D view notes](13-google-3d-view.md).

## Verification

- `npm run check`: syntax checks, 57 Node tests and the explicit public-asset build.
- `npm run test:python`: five existing ingestion tests.
- `npm run test:browser`: fixture-backed full homeowner flow, including automatic debounce, composition, image readiness, keyboard/pointer controls, retry, timeout, stale results and coverage fallback; checks ten screen sizes. Imagery fixtures are explicitly synthetic and are not shipped in the app.
- `LIVE_PROPERTY_PREVIEW=1 npm run test:preview:live`: opt-in browser → Node → live Census → live USGS image check using the public Census Bureau example address. Produces ignored screenshots and JSON evidence under `qa-output/`. No personal address or provider subscription is used. Requires Chromium and network access to both government services. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` selects a local Chromium when needed.

This does not add street-level imagery, parcel/building matching, a 3D house model, automatic exterior quantities or contractor-calibrated prices. Those still require separate data rights, integration and validation.
