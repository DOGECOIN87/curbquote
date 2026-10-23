# Setup: services, keys and links

Everything CurbQuote talks to, what each service is for, whether it needs an account or a key, and
the exact steps.

**Only two parts are needed to run the MVP: hosting and the free government services.** Everything
else is optional and adds a feature.

> **Handling keys:** never paste a key or token into a chat, screenshot, issue or commit. Put it
> where this guide says: Vercel environment variables for the live site, `.env.local` on your own
> computer, or the cloud environment's settings for Claude Code sessions. If a key is ever
> exposed, delete it at the provider and create a new one.

## At a glance

| Service | Feature | Account / key | Cost | Variable |
|---|---|---|---|---|
| U.S. Census Geocoder | Address → approximate location | None | Free | — |
| USGS NAIP imagery | Aerial photo | None | Free | — |
| Vercel | Hosting and server functions | Account | Free hobby tier | — |
| Cesium ion | 3D view, testing only | Account + token | Free Community plan, 1,000 Google 3D sessions a month, non-commercial | `CESIUM_ION_TOKEN` |
| Google Map Tiles API | 3D view for launch | Google Cloud project, billing and key | First 1,000 sessions a month free, then $6.00 per 1,000 | `GOOGLE_MAP_TILES_KEY` |
| Vercel AI Gateway | AI project assistant | Vercel account; key or OIDC | Pay per use, $5 free credit a month | `AI_GATEWAY_API_KEY`, `AI_GATEWAY_MODEL` |
| Open ODbL building footprints | Step 3 approximate building dimensions | None (OSM Overpass / ODbL GeoJSON) | Free open data | `MICROSOFT_FOOTPRINTS_URL` (optional) |
| Licensed building footprints | Step 3 commercial building outlines & roof pitch | Provider contract + consent | Varies | `EARTHDEFINE_KEY`, `EAGLEVIEW_KEY`, `ATTOM_KEY`, `DATA_USE_APPROVED` |
| Licensed property data | Pre-filled stories and year built | Provider contract | Varies | `PROPERTY_*`, `DATA_USE_APPROVED` |
| Lead inbox (webhook or email) | "Send to Alco Products" on Step 5 | A form or automation URL, or an inbox | Free tiers available | `LEAD_WEBHOOK_URL`, `LEAD_EMAIL` |

Prices were checked in October 2026 ([docs/12](12-3d-and-ai-map-alternatives.md)); confirm them
with each provider.

## 1. Free government services (nothing to set up)

- **Census Geocoder** turns the typed address into an approximate point. No key. Service:
  https://geocoding.geo.census.gov/geocoder/
- **USGS NAIP imagery** provides the free aerial photo. No key. Service:
  https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer

The only setup is network access. If a host or test environment restricts outbound traffic, allow
`geocoding.geo.census.gov` and `imagery.nationalmap.gov`.

## 2. Hosting on Vercel

1. Sign in at https://vercel.com and import the GitHub repository: https://vercel.com/new
2. Keep the defaults. `vercel.json` sets the build (`npm run build`), the output folder (`dist`),
   the functions in `api/`, and the security headers.
3. Add environment variables from the sections below under **Project → Settings → Environment
   Variables** ([guide](https://vercel.com/docs/projects/environment-variables)), then
   **redeploy**. Variables only apply to new deployments.
4. Every push to a branch gets its own preview URL in the Vercel dashboard, under **Deployments**.

## 2b. GitHub Pages demo (free, static)

A shareable demo at `https://dogecoin87.github.io/curbquote/`, built by
`.github/workflows/pages.yml` on every push to `main`.

| Part | On GitHub Pages |
|---|---|
| Address lookup | Works. The page asks Census directly (JSONP). |
| Home size from public data | Works. The page asks OpenStreetMap's Overpass for the building outline, and reads the same outlines from OpenFreeMap's map tiles when Overpass is busy. |
| 3D view | Works with `CESIUM_ION_TOKEN` (or `GOOGLE_MAP_TILES_KEY`), which is baked into the public `config.js` at build time. |
| Estimator, plans, saving, photo colours, contractor brief | Works, entirely in the browser. |
| AI assistant | Not available, because Pages has no server. The automatic planner still works. |
| Send to Alco Products | Writes an email to `LEAD_EMAIL` (a repository variable) for the homeowner to send. Without it, the page shows the phone number. |
| Licensed property data | Not available, because it needs a server. |

Setup:
1. **Turn on Pages:** repository **Settings → Pages → Build and deployment → Source: GitHub
   Actions**.
2. **Make a separate Cesium token for the demo:** `assets:read` only, with **Allowed URLs** set
   to `https://dogecoin87.github.io`. The demo's token is public in `config.js`, which is why it
   must be restricted.
3. **Add it as a repository secret:** **Settings → Secrets and variables → Actions → New
   repository secret**, name `CESIUM_ION_TOKEN`.
4. **Merge the code into `main`.** GitHub lists and runs the workflow only once it is on the default
   branch, so a feature branch can't deploy the demo. After the merge, the **Deploy GitHub Pages
   demo** run appears under **Actions**, and you can also start it there with **Run workflow**.
   The address is shown on the run and under **Settings → Pages**.

Build it locally with `npm run build:pages`; the output is in `dist-pages/`.

## 3. 3D view: pick one credential

Use **Cesium ion** to test without a credit card, and switch to **Google** for launch. If both are
set, Google wins.

### Option A: Cesium ion token (testing)

1. Create a free account: https://ion.cesium.com/signup
2. Open **Access Tokens**: https://ion.cesium.com/tokens, then **Create token**.
   - **Name:** for example `curbquote-browser`.
   - **Scopes:** only `assets:read`. Untick everything else.
   - **Allowed URLs:** turn the restriction on and add your Vercel domain(s), your GitHub Pages
     address and `http://localhost:3000`.
3. Copy the token and set **`CESIUM_ION_TOKEN`** (exactly this name; any other name is ignored):
   - **Vercel:** Settings → Environment Variables, tick Production and Preview, then redeploy.
     Vercel only applies a new or changed variable to deployments made after it.
   - **GitHub Pages:** a repository secret with the same name, used on the next push to `main`.
   - **Your computer:** add `CESIUM_ION_TOKEN=...` to `.env.local` and start the dev server with
     `node --env-file=.env.local scripts/dev-server.mjs`.

Cesium's free Community plan is for personal use and evaluation. The 3D view shows "Upgrade for
commercial use" until you move to Google or a paid Cesium plan ([pricing](https://cesium.com/platform/cesium-ion/pricing/)).

### Option B: Google Map Tiles API key (launch)

1. **Create a project:** https://console.cloud.google.com/projectcreate
2. **Turn on billing and link it to the project:** https://console.cloud.google.com/billing and
   https://console.cloud.google.com/billing/linkedaccount. Google requires billing even inside
   the free allowance.
3. **Enable the Map Tiles API:** https://console.cloud.google.com/apis/library/tile.googleapis.com
4. **Create the key:** https://console.cloud.google.com/google/maps-apis/credentials, then
   **Create credentials → API key**, and edit it:
   - **API restrictions:** Map Tiles API only.
   - **Application restrictions → Websites:** your Vercel domain(s) and `http://localhost:3000/*`.
5. **Stay inside the free tier:** at https://console.cloud.google.com/apis/api/tile.googleapis.com/quotas,
   set root tileset requests per day to **30**. 30 × 31 = 930, under the 1,000 free sessions a month.
6. **Add a budget alert as a backstop:** https://console.cloud.google.com/billing/budgets
7. Set **`GOOGLE_MAP_TILES_KEY`** (exactly this name) in Vercel and `.env.local`, and as a GitHub
   secret for the Pages site, then redeploy.

### Until the Google key is live: the fallback order

The property view never depends on a key. It degrades in this order, and each step happens
automatically when the one above is missing or fails (denied key, used-up daily quota, network):

1. Reviewed local exterior (the Austin lidar example only).
2. Google Photorealistic 3D, via `GOOGLE_MAP_TILES_KEY`, or via `CESIUM_ION_TOKEN` for testing.
3. Open 3D buildings: OpenStreetMap heights extruded over the aerial photo. No key; needs WebGL2.
4. USGS / USDA aerial photo (the default after an address match while no 3D credential is set).
5. OpenFreeMap street map.
6. The homeowner's own exterior photo.

Details: [docs/20](20-v015-redesign-3d-and-fallbacks.md#property-view-fallback-chain).

Google's guide: https://developers.google.com/maps/documentation/tile/get-api-key. Pricing:
https://developers.google.com/maps/billing-and-pricing/pricing. Before launch, confirm the open
geocoder question in [docs/13](13-google-3d-view.md).

## 4. AI project assistant (optional)

Without it, the **Automatic planner** still compares plans and handles supported goals.

1. In the Vercel dashboard, open **AI Gateway** and make sure the team has credit; every team gets
   $5 of free usage a month. Docs: https://vercel.com/docs/ai-gateway
2. **On Vercel deployments:** turn on the project's OIDC tokens; the assistant uses them
   automatically. **Locally:** create an AI Gateway API key in the dashboard and set
   **`AI_GATEWAY_API_KEY`**.
3. Optionally set **`AI_GATEWAY_MODEL`** to another tool-capable model from the Gateway catalog.
   The default is in `lib/agent.mjs`.

Details: [docs/08](08-agentic-planning.md).

## 5. Licensed property data (optional, needs a contract)

Pre-fills story count and year built from a provider you're licensed to use. **Don't connect
anything until there's a signed data agreement**: the adapter enforces the grant in
`PROPERTY_GRANT_JSON`. Candidates and their terms are in [docs/01](01-data-sources.md):

- RentCast: https://developers.rentcast.io
- ATTOM: https://support.attomdata.com/articles/3952343496-what-is-the-attom-property-data-api
- Regrid (parcels and building footprints): https://regrid.com/api

Configuration (`PROPERTY_LOOKUP_URL`, `PROPERTY_API_KEY`, field map, grant) is described in
[docs/09](09-property-data-adapter.md) and `.env.example`.

## 5b. Send to Alco Products (optional)

On Step 5 the homeowner can send their estimate summary with their name, email, optional phone
and notes, after ticking a box that lets Alco Products contact them. Nothing is stored by
CurbQuote; the request goes straight to Alco.

1. **Direct delivery (Vercel):** set **`LEAD_WEBHOOK_URL`** to an `https://` address that accepts
   a JSON POST, such as a CRM web-form endpoint, a Zapier or Make "catch hook", or a Power
   Automate HTTP trigger. Each request is
   `{ source, submittedAt, contact: { name, email, phone?, notes? }, estimate: { address?, range? }, brief }`,
   where `brief` is the same text as the downloaded summary. Point the automation at Alco's inbox
   or CRM. Treat the URL like a password: it is only read on the server and never reaches the page.
2. **Email instead (Vercel or GitHub Pages):** set **`LEAD_EMAIL`** to Alco's estimates inbox. With
   no webhook, or if the webhook fails, the page writes the message into the homeowner's own email
   app. For the Pages demo add it under **Settings → Secrets and variables → Actions → Variables**
   (a variable, not a secret: the address ships in `config.js`).
3. Redeploy. `GET /api/lead` should then report `"configured": true` (webhook) or show the email.

Without either, the button explains that online requests are not set up and shows the phone number.
Requests are limited to five per visitor every ten minutes.

## 6. Claude Code cloud sessions (optional)

To let Claude test the live app from a cloud session, open the environment settings (session
title bar → environment menu → **Edit**). Steps:
https://code.claude.com/docs/en/cloud-environments#network-access

1. **Network access → Allowed domains:** add `geocoding.geo.census.gov`,
   `imagery.nationalmap.gov`, `api.cesium.com`, `assets.ion.cesium.com` and
   `tile.googleapis.com`. Keep **Allow package managers** ticked.
2. **Network secrets:** add the Cesium token for host `api.cesium.com` as the header
   `Authorization: Bearer <token>`. The token is then added on the way out and never enters the
   session.
3. Start a new session for the changes to take effect.

## Checklist

- [ ] Vercel project imported and deploying
- [ ] 3D credential set: `CESIUM_ION_TOKEN` for testing, `GOOGLE_MAP_TILES_KEY` for launch
- [ ] Google key restricted, capped at 30 a day, budget alert on (launch only)
- [ ] Redeployed after adding variables
- [ ] Optional: AI Gateway credit and OIDC
- [ ] Optional: `LEAD_WEBHOOK_URL` and/or `LEAD_EMAIL` for "Send to Alco Products"
- [ ] Optional: property-data agreement signed before any `PROPERTY_*` setup
