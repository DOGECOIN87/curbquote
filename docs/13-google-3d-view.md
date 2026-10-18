# Google 3D view — v0.7

When a 3D credential is configured and the browser supports WebGL2, Google Photorealistic 3D Tiles
open automatically after an address match. They're rendered with CesiumJS (Apache-2.0) around the
approximate Census point. Without a credential the page behaves as before, with the USGS aerial
photo.

## Homeowner flow

1. **Match an address.** The 3D view loads CesiumJS (about 4.6 MB, first time only). It frames
   the address point from about 190 m, looking down at 35°, with a green dot on the point. No USGS
   image is requested while 3D is showing.
2. **Move around.** Drag to orbit; scroll or pinch to zoom.
   - **Top view** looks straight down, using the same sharp Google imagery.
   - **⟳** rotates a quarter turn.
   - **Recenter** returns to the starting angle.
   - The north marker and the USGS credit hide while 3D is shown.
3. **Switch views.** **Aerial photo** switches to the USGS image; **View in 3D** switches back.
   Editing the address closes the 3D view.
4. **If 3D fails**, the page falls back to the aerial photo: for example a refused credential, a
   used-up quota or a WebGL error. A manual retry that fails says "The 3D view is unavailable right
   now". Estimating is never blocked.

**Display only.** Nothing from the 3D view is measured, stored, exported, or sent to the estimator
or the AI assistant. Google's Map Tiles policies forbid image analysis, geodata extraction and
caching ([policies](https://developers.google.com/maps/documentation/tile/policies)). CesiumJS shows
Google's logo and data attributions on screen.

## Setup and staying in the free tier

1. In Google Cloud, create a project with billing, enable the **Map Tiles API**, and create an API
   key ([Google's steps](https://developers.google.com/maps/documentation/tile/get-api-key)).
2. Restrict the key:
   - **APIs:** Map Tiles API only.
   - **Websites:** your Vercel domains, plus `http://localhost:3000/*` for local testing.
3. Under the Map Tiles API **Quotas**, set root tileset requests per day to **30**.
   30 × 31 = 930, under Google's 1,000 free monthly sessions. Past the cap, Google refuses
   requests instead of billing.
4. Add a small billing budget alert as a backstop.
5. Set `GOOGLE_MAP_TILES_KEY` in Vercel's environment variables. Locally, set it in `.env.local`
   (see `.env.example`).

**Testing without Google billing.** Set `CESIUM_ION_TOKEN` instead:
- **The token:** a Cesium ion token with only the `assets:read` scope, restricted to your site's URLs.
- **What it does:** CesiumJS then requests the same Google tiles through Cesium ion. The free
  Community plan allows 1,000 a month, for personal use and evaluation only, so not for launch.
- **Which credential is used:** a Google key wins when both are set, and the ion token is then
  never sent to the browser.
- **Treat it as public:** like the Google key, it reaches the browser. Never paste either one into
  a chat or a screenshot.

`GET /api/map3d` returns `{ configured: false }`, `{ configured: true, provider, key }` or `{ configured: true, provider, ionToken }`. It's a
browser key by design: Google's tiles are requested from the browser, so the key's restrictions
and quota are what protect it.

**One session per visit.** CesiumJS creates the tileset once, the first time 3D is opened, and
reuses it for later addresses on the same page. One Google root request covers up to 3 hours of
viewing.

## Security and privacy changes

The page's Content Security Policy widened only as far as CesiumJS needs. Development
(`lib/web.mjs`) and Vercel (`vercel.json`) use the same policy:

- `connect-src` adds `https://tile.googleapis.com`, plus `https://api.cesium.com` and `https://assets.ion.cesium.com` for the ion option.
- `img-src` adds `blob:` and `https://assets.ion.cesium.com`, which hosts the Google logo and the
  ion credit images.
- `script-src` adds `'wasm-unsafe-eval'`, for the mesh decoder. `worker-src` allows `'self'` and
  `blob:`.
- Exactly four CesiumJS inline styles are allowed by hash: the credit stylesheet, a feature probe, and the Cesium ion and Google logo credits. **No `unsafe-eval` and no
  `unsafe-inline`.**
- The bundled knockout library looks up the global object with `eval`. The build and the dev
  server replace that one expression with `globalThis` (`patchCesium`). It refuses to run if a
  CesiumJS upgrade changes the code, and `tests/map3d.test.js` recomputes every hash from the
  installed version.

`Referrer-Policy` changed from `no-referrer` to `strict-origin`, so Google can check a
website-restricted key:
- Requests send only the site origin, never the path.
- USGS images still send no referrer.
- Google sees the viewer's network address and the area viewed. Cesium's CDN sees the logo
  request.

The CesiumJS runtime is vendored from `node_modules/cesium` with an allowlist (`CESIUM_FILES`):
the ESM bundle, workers, WASM decoders, assets and the widget stylesheet, about 12 MB in `dist/`.
No CDN script is loaded.

## Verification

- `npm run check`: 64 Node tests. They cover the config endpoint, the vendored-file allowlist,
  WASM content type, the patched bundle and the CSP hashes.
- `npm run test:browser`: 36 Chromium checks.
  - The toggle stays hidden without a key.
  - With a synthetic key and a denied Google response, CesiumJS loads under the CSP with no
    violations.
  - Google receives only the origin as referrer, and the page returns to the aerial view.
- **Checked live from a cloud session:** with an invalid key, the real Google endpoint answers 400
  and the page falls back cleanly, with no CSP violations.
- **Checked live through Cesium ion (October 18, 2026):**
  - Real Census and USGS data, plus Google 3D tiles for the Census Bureau address.
  - The 3D view opens automatically, and Top view, rotate and Aerial photo work.
  - No CSP violations and no page errors.
  - Not yet checked live: a direct Google key, which needs Google Cloud billing.

## Open questions before launch

- **Census geocoding next to Google tiles.** CesiumJS warns that "only the Google geocoder can be
  used with Google Photorealistic 3D Tiles". Google's published Map Tiles policies, as indexed in
  October 2026, didn't show that rule. Confirm with Google whether placing the camera from Census
  results is allowed, or switch the 3D view to Google Geocoding.
- **Coverage and detail vary.** Many cities have full 3D, while rural areas can look flat.
- **Hardware.** Older phones without WebGL2 never see the button.
