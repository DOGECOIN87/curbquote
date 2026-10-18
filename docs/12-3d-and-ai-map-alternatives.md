# 3D and AI-generated map alternatives — research, October 2026

> **How to read the sources.** As with [docs/11](11-open-map-option.md), this session couldn't load
> pages directly. Facts come from search-indexed copies of the cited pages. Prices and terms change
> often, so confirm them with each vendor.

This note looks for alternatives to the Google Earth and Microsoft Flight Simulator 3D view of a
house, including AI-generated ones. It judges each against CurbQuote's needs:

1. Can it show the homeowner **their actual house**?
2. Can anything shown be **measured or stored**?
3. Does it meet the **open-source** preference set for [docs/11](11-open-map-option.md)?

## Short answer

- **Flight Simulator's world is AI-*guessed*, not captured.** Blackshark.ai generated about 1.5
  billion buildings from satellite imagery. The shapes look plausible but aren't accurate. It's
  sold to enterprises and as an Unreal Engine plugin, with no self-serve API. **Not usable for a
  quote.**
- **The best-looking real 3D is Google's Photorealistic 3D Tiles, but it's display-only.** Google's
  tile policies bar image analysis, object detection, geodata extraction and caching. It's also
  paid and closed.
- **AI world generators invent what they show.** World Labs Marble and Google's Project Genie make
  explorable worlds from text or photos, so any detail of a real house would be made up.
  Inspiration only.
- **Open-source 3D gives honest block shapes.** MapLibre's extruded buildings use real footprints
  and approximate heights from OSM/Overture, with no photo texture. It's free and builds on the
  docs/11 stack.
- **For a real, measurable 3D model of *this* house, the homeowner's phone is the source.**
  Photogrammetry or Gaussian-splat capture (Polycam, Scaniverse, KIRI Engine, or commercially
  Hover, per [docs/03](03-visualization.md)) gives real geometry that the homeowner provides and
  that can be scaled and measured.

## Options compared

| Option | What you see | Real or AI-guessed | Open source? | Cost | Measure or store? | Fit |
|---|---|---|---|---|---|---|
| **Microsoft Flight Simulator / [Blackshark.ai](https://people.blackshark.ai/?p=2206) SYNTH3D globe** | Photoreal 3D world. Buildings are AI-reconstructed from Maxar satellite imagery. | AI-guessed | No | Enterprise deals or Unreal plugin. No public price found. | No | ❌ |
| **[Google Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/policies)** | Photo-textured 3D mesh of real places | Real (photogrammetry) | No | Enterprise SKU billed per root-tile request. One request starts a viewing session of up to 3 hours. First **1,000/month free**, then **$6.00 per 1,000** (up to 100K), stepping down to $2.40 above 5M. Cap of 10,000 per day ([pricing list](https://developers.google.com/maps/billing-and-pricing/pricing), [billing](https://developers.google.com/maps/documentation/tile/usage-and-billing)). | **No.** No analysis, object detection, geodata extraction or caching. Google logo required. | ⚠️ Display-only "is this your house?" |
| Same tiles via **[Cesium ion](https://cesium.com/platform/cesium-ion/pricing/)** | Same | Real | CesiumJS is open source (Apache-2.0). The service isn't. | Commercial plan **$149/month** with 1,000 root tiles/month. Premium **$499/month** with 5,000. The free plan is non-commercial only. | No (Google terms still apply) | ⚠️ Costs more than going to Google directly. CesiumJS can load the tiles with a Google key and no Cesium ion plan. |
| **[Google Aerial View API](https://developers.google.com/maps/documentation/aerial-view/usage-and-billing)** | Ready-made cinematic flyover video of an address | Real (rendered from 3D) | No | About **$16 per 1,000** successful lookups (docs dated June 2025). Address coverage not confirmed here. | No | ⚠️ Polished intro moment, if paid Google is acceptable |
| **[Mapbox Standard](https://docs.mapbox.com/map-styles/standard/guides)** | 3D buildings plus modeled landmarks | Modeled | No (proprietary license since GL JS v2) | 50,000 free web map loads/month. Paid rates are reported inconsistently, so check [pricing](https://www.mapbox.com/pricing). | No | ⚠️ Not open source |
| **MapLibre extruded buildings** (OpenFreeMap / Overture heights) | 3D blocks with real footprints and approximate heights | Real footprints, rough heights | **Yes** | Free (see docs/11) | Footprints yes. Walls and windows no. | ✅ Cheapest 3D upgrade |
| **CesiumJS + own data** (Overture footprints, USGS 3DEP lidar) | 3D globe or scene with your own layers | Real data | **Yes** (Apache-2.0) | Free renderer. Cesium's hosted data isn't free for commercial use. | Heights to about half a story ([docs/01](01-data-sources.md)) | ✅ Later, if a true 3D scene matters |
| **[Streets GL](https://wiki.openstreetmap.org/wiki/Streets_GL)**, OSM Buildings, OSM2World | Open-source 3D renderers of OSM | Real OSM data | **Yes** | Free | No | ❌ Streets GL is early-stage, uses 2023 data and isn't tuned for phones. Good reference, not an embed. |
| **[F4map](https://wiki.openstreetmap.org/wiki/F4_Map)** | Detailed 3D OSM map | Real OSM data | No, and no license stated | — | No | ❌ |
| **FlightGear [osm2city](https://osm2city.readthedocs.io/en/latest/how_it_works.html)** | Flight-sim scenery generated procedurally from OSM | Procedural ("plausible rather than exact") | **Yes** | Free | No | ❌ Game scenery |
| **[GeoFS](https://cesium.com/blog/2021/12/06/geofs-is-a-flight-simulator-that-showcases-global-satellite/)** | Browser flight simulator built on CesiumJS | Imagery-based | No (a game) | Free / HD subscription | No | ❌ Shows what CesiumJS can do in a browser |
| **[World Labs Marble](https://docs.worldlabs.ai/api/pricing.md)** | Explorable 3D world from text, photo or video. Gaussian-splat (`.spz`/`.ply`) or mesh export. | **AI-invented** | No | API about $0.12 per draft, about $1.20 per world, +$2.80 for an HQ mesh | No | ⚠️ Mood or "dream exterior" scenes only, never presented as the real house |
| **[Google Project Genie](https://blog.google/innovation-and-ai/models-and-research/google-deepmind/project-genie/)** (Genie 3) | Interactive AI worlds, 60-second sessions | **AI-invented** | No | Google AI Ultra subscribers in the U.S. only. No API. | No | ❌ |
| **Phone capture**: Polycam, Scaniverse, KIRI Engine ([overview](https://radiancefields.com/luma-ai-alternatives)). Hover commercially. | The homeowner's own house as a 3D splat or mesh | **Real** | Apps are proprietary, with free tiers. KIRI lists an API. | KIRI Pro $17.99/month ([pricing](https://www.kiriengine.app/pricing)). Polycam Pro about $20–27/month (reports conflict). Hover about $59–139 per exterior job (third-party reports). | **Yes**, once scaled. Polycam has measuring tools. Accuracy for house exteriors isn't documented. | ✅ Best path to real 3D and measurement |
| **Satellite → street-view AI** ([CrossViewDiff](https://arxiv.org/abs/2408.14765v1), [pose-controlled synthesis](https://arxiv.org/pdf/2502.03498)) | Generated street-level views from overhead images | **AI-invented** | Research code | — | No | ❌ Research only. Invents facades. |

Two adjacent facts:
- Bing Maps for Enterprise, the imagery behind earlier Flight Simulator releases, is
  [being retired](https://support.vertigis.com/hc/de/community/posts/19455807579666-Bing-Maps-for-Enterprise-is-deprecated-and-will-be-retired).
  Free accounts ended in 2025, and enterprise accounts must move to Azure Maps by June 30, 2028.
- Apple MapKit JS offers 250,000 free map views a day with an Apple Developer membership, but its
  terms are closed and give Apple broad discretion
  ([forum](https://developer.apple.com/forums/thread/127493)).

## Recommendation

1. **Now (open source):** add extruded 3D buildings to the docs/11 MapLibre map. Label them
   "approximate shape from map data". They're free and introduce no new vendor.
2. **Real 3D of the house:** evaluate homeowner phone capture. Start with KIRI Engine's API, Polycam
   and Hover's homeowner capture link. This is also the route to measurements.
3. **Only if paid Google is acceptable:** Google Aerial View video or 3D Tiles as a display-only
   confirmation step, with Google's logo and no analysis or storage. Both fail the open-source
   preference.
4. **AI world generators:** keep them for design inspiration. Any AI-generated view must be
   labeled, must never be shown as the real house, and must never feed the estimate. This follows
   the guardrails in [docs/03](03-visualization.md).
