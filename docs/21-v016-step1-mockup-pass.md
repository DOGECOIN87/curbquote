# 21 — CurbQuote v0.16: Step 1 toward the owner's mock-ups

The owner's four concept images show Step 1 as a full-bleed photo-real 3D view circling the house, a
measuring overlay, and a few small glass panels. This pass moves the live Step 1 toward them. The
estimate maths, the consent flow and the "Is this your home?" rule are unchanged: a measured size only
reaches the estimate after the homeowner confirms it. No eyebrow labels were added (the mock-ups'
uppercase card captions are sentence case here).

## What changed

- **Camera.** The Google 3D view looks down at 42° (was 35°) from farther out (70–220 m, scaled to
  the building), so the street and the neighbours frame the house. The camera aims a little in front
  of the house so it sits in the open area between the floating panels instead of behind the price card
  and the chat bar; the offset follows the camera as it circles.
- **One 3D button.** The 3D tools moved from a text toolbar at the top right to round buttons at the
  bottom right, as on a map: compass (face north), quarter turn, top view, **3D** (circle the home) and
  new zoom in / zoom out. On phones the toolbar used to be hidden; now compass, 3D and zoom show.
  "Aerial photo / View in 3D" joined Explore map and Use my photo at the bottom left.
- **One measuring card.** "Exterior measurements" and "Is this your home?" read as one panel.
- **Labels stay readable.** A dimension label that would land under a panel moves just clear of it
  (`clearOf` in `measure-overlay.js`, unit-tested), as in the third mock-up.
- **Loading.** "Loading the 3D view…" shows until the tiles around the building have arrived, instead
  of an empty green frame.
- **The price card says what it is.** It reads "Estimate for a typical home" until the size comes from
  the home itself, then "Estimate for this address", and it is a slimmer bar above the chat bar.
- **Phones.** The view options sit under the search box, the measuring card sits low beside the 3D
  stack, the price fits on one line, and Google's credits get their own strip under the chat bar.

| | Before | After |
|---|---|---|
| Desktop | ![Before, 1440](assets/ui-review/v016-step1-before-1440.png) | ![After, 1440](assets/ui-review/v016-step1-after-1440.png) |
| Phone | ![Before, 390](assets/ui-review/v016-step1-before-390.png) | ![After, 390](assets/ui-review/v016-step1-after-390.png) |

The screenshots use the synthetic tileset from `qa/fixtures/tiles3d.mjs`; the same layout was checked
against real Google 3D tiles on the live Pages configuration, without committing real-address imagery.

## Verification

```text
npm run check          # syntax checks, 116 Node tests, public build
npm run test:browser   # 64 Chromium checks
npm run test:exterior  # 9 checks
```

## Google Maps Platform extras and photo concepts

With one public `GOOGLE_MAPS_KEY` (see [SETUP §1b](SETUP.md#1b-google-maps-platform-extras-optional-one-key)),
called straight from the browser so the Pages demo works too (`google-maps.js`):

- **Address suggestions** (Places API New) under the search box, as a keyboard combobox with Google
  Maps attribution. A pick runs the usual Census lookup (`address-suggest.js`).
- **Street View front photo** in "Is this your home?", aimed from the nearest panorama at the measured
  building, shown unmodified with its date and Google credit.
- **Solar API outline**: when OpenStreetMap has no outline, Google's roof data gives a rectangle turned
  to the roof's main direction (unit-tested), measured in the 3D view and still confirmed by the homeowner.
- **Aerial View flyover**: a Flyover button when Google already has a video of the address; it leads
  when the device has no WebGL. Only the free metadata lookup runs until the homeowner asks for it.
- **Photo concepts** (`api/visualize.js`): the homeowner's own photo restyled with their chosen siding,
  colour, trim and roof through the AI Gateway, labelled as an illustrative AI concept. Server only.

Every feature switches itself off without its key or coverage, and none of them changes the estimate
on its own.

## Less on screen, especially on phones

- One name for the price everywhere: "Your estimate" (Step 1 says "Estimate for a typical home" until
  the size comes from the home). "Instant estimate", "Estimate so far", "Preliminary range",
  "Working estimate" and "Preliminary project range" are gone, and the "not a contractor quote" and
  "concept model" notices appear once instead of on several panels.
- While "Is this your home?" asks, it replaces the measuring card instead of repeating it, and the
  question is shorter. The camera re-aims whenever that card appears or goes.
- Phones, once a home is found: a one-row header (logo, step numbers, Saved), the question at the top,
  the house in the open middle, and two round buttons: **3D** and **More views** (Aerial photo,
  Explore map, Use my photo, Flyover). Pinch zooms and two fingers turn the view; the map's credits
  stay visible. Short windows (browser bars showing) tighten the panels further.
