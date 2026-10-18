# Interactive property map — v0.8

This continues the newer `claude/zen-ride-rl7azi` branch: its optional Google/Cesium 3D viewer and research are retained, and the installed MapLibre renderer is now connected. The current estimate and automatic Census → aerial flow remain intact.

## Homeowner flow

- Type an address as before. The automatic aerial preview remains the first view.
- **Explore map** opens a display-only interactive map. It lazily loads the self-hosted MapLibre 6.12.0 runtime, worker and stylesheet, then requests OpenFreeMap's OpenMapTiles data. No account, map API key or paid integration is needed for this view.
- **Hybrid** overlays mapped street labels and building outlines on USGS NAIP aerial tiles. **Map** displays the drawn map. Loading imagery has a separate status; navigation works while the imagery loads. Failed aerial tiles switch to the drawn map rather than blocking navigation.
- Drag to pan, use the zoom buttons, or use two fingers on a touch screen. Arrow keys pan; plus/minus zoom. Tapping an available outline highlights it. Enter highlights an outline at the center; Escape or **Clear highlight** removes it. **Recenter** returns to the approximate address point.
- The highlighted polygon is only a visual guide. It does not confirm the building's identity or enter the estimator, source context, AI requests, local project storage, reports or exports. Untrusted feature properties are discarded. Highlight geometry is bounded and remains inside the renderer.
- **Back to aerial view** restores the existing image and controls. Address edits close the map, clear highlights, remove the renderer and prevent delayed requests from restoring an old location. Map and Google 3D views close one another when switching modes.
- WebGL2 is required for the interactive map. Devices without it keep the existing aerial preview. Map-runtime loading has a ten-second deadline; initial vector data has a twenty-second deadline. Failed map data returns to the aerial view. An unsupported aerial location, including Alaska or Hawaii, may still be explored in drawn-map mode if map data is available.

## Sources, privacy and deployment

The public [OpenFreeMap service](https://openfreemap.org/) states commercial use is allowed and requires attribution. Its service and [MapLibre guidance](https://maplibre.org/maplibre-gl-js/docs/) were checked on October 18, 2026. Service policies and availability can change; there is no application uptime guarantee from this prototype.

The visible source links credit OpenFreeMap, OpenMapTiles and OpenStreetMap contributors whenever the interactive map is open. USGS/USDA attribution stays visible for aerial imagery. No OpenStreetMap Foundation tile service or public Nominatim autocomplete is used.

Public map URLs contain the viewed area or tile coordinates, not the address text. Map requests omit credentials and HTTP referrers. OpenFreeMap and USGS still see the viewer's network address and requested area. MapLibre has no application telemetry in this integration. The existing optional Google 3D viewer remains separately configured and credited; see [3D notes](13-google-3d-view.md).

The build copies only the three MapLibre production ES modules, stylesheet and BSD license into `vendor/maplibre/`. The development server uses the same exact allowlist; source files, source maps and development bundles are not served. Existing Cesium assets remain allowlisted and lazy-loaded. Vendor JavaScript is served with the correct module content type. No new package was installed for the map beyond the MapLibre dependency already added on the Claude branch.

The matching Node and Vercel Content Security Policies add only `https://tiles.openfreemap.org` and the existing exact USGS export path to `connect-src`. Script and worker files stay local. The optional Cesium CSP hashes are retained; no `unsafe-eval` or `unsafe-inline` was added.

## Verification

```sh
npm run check
npm run test:python
npm run test:browser
LIVE_PROPERTY_PREVIEW=1 LIVE_PROPERTY_MAP=1 npm run test:preview:live
```

- 63 Node tests cover calculations, public builds, exact vendor allowlists, source attribution controls, safe highlight data and existing APIs.
- Five Python ingestion tests remain intact.
- The browser command runs both the existing homeowner/3D regressions and ten new map check groups using the real self-hosted MapLibre renderer, worker, synthetic vector tiles and PNG raster fixtures. Both check ten screen sizes. Fixtures are QA-only and are never shipped as property data.
- Map checks cover deferred loading, real rendering, tap/keyboard highlighting, navigation, mode switching, attribution, unchanged measurements, teardown, stale data, tile failure, deadlines and devices without WebGL2. Console JavaScript and CSP errors fail the suite.
- The opt-in live check uses the public Census Bureau example address and exercises live Census, USGS imagery and OpenFreeMap data. It does not open Google 3D or use a paid provider. Screenshots and network evidence are written only to ignored `qa-output/`.

This adds navigation and visual context. Automated property identification, parcel matching, footprint-based quantities, height estimation, street-level photos and professionally calibrated quotes still require separate integration and validation.
