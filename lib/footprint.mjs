/**
 * Server-side building footprint & exterior dimension adapter.
 * Priority waterfall:
 *   1. EarthDefine 3D Building Footprints (`EARTHDEFINE_KEY` + `DATA_USE_APPROVED=true` + consent)
 *   2. EagleView Property Data (`EAGLEVIEW_KEY` + `DATA_USE_APPROVED=true` + consent)
 *   3. ATTOM Building Footprints (`ATTOM_KEY` or licensed `resolveProperty` + `DATA_USE_APPROVED=true` + consent)
 *   4. Microsoft Global ML Building Footprints / Overture GeoJSON (`MICROSOFT_FOOTPRINTS_URL`, ODbL)
 *   5. OpenStreetMap Overpass (`https://overpass-api.de/api/interpreter`, ODbL)
 *
 * Guardrails:
 *   - Contiguous U.S. only (`hasAerialCoverage`).
 *   - Never derives dimensions from Census address ranges alone, Google Photorealistic 3D Tiles,
 *     Google Solar/Street View, USGS NAIP raster pixels, or Zillow/Redfin/MLS listings.
 *   - Zero server-side caching (`Cache-Control: no-store`).
 */
import { validateAddress } from '../address.js';
import { hasAerialCoverage } from '../property-view.js';
import { canImportProperty } from '../property-data.js';
import { DEFAULT_HOME_STYLE, resolveHomeStyle, suggestStyleFromFootprint } from '../home-styles.js';
import {
  OVERPASS_ENDPOINT,
  buildOverpassQuery,
  measurePolygonRing,
  parseGeoJsonFootprint,
  parseHeightFt,
  parseOverpassFootprint
} from '../footprint-client.js';
import { resolveProperty } from './property.mjs';
import { nearbyBuildings } from '../osm-tiles.js';
import { fetchPropertyJson } from './property-transport.mjs';

export class FootprintLookupError extends Error {
  constructor(message, status = 503, code = 'FOOTPRINT_UNAVAILABLE') {
    super(message);
    this.name = 'FootprintLookupError';
    this.status = status;
    this.code = code;
  }
}

export const LICENSED_FOOTPRINT_ENDPOINTS = Object.freeze({
  earthdefine: 'https://api.earthdefine.com/v1/buildings/footprint',
  eagleview: 'https://api.eagleview.com/property-data/v3/footprint',
  attom: 'https://api.attomdata.com/propertyapi/v1.0.0/property/buildingfootprint'
});

const cleanKey = value => typeof value === 'string' && !/[\r\n\s]/.test(value.trim()) && value.trim().length >= 8 && value.trim().length <= 4096 ? value.trim() : '';

export function footprintAvailability(env = process.env) {
  const approved = env.DATA_USE_APPROVED === 'true';
  const licensed = [];
  if (approved && cleanKey(env.EARTHDEFINE_KEY)) licensed.push('EarthDefine 3D Building Footprints');
  if (approved && cleanKey(env.EAGLEVIEW_KEY)) licensed.push('EagleView Property Data');
  if (approved && cleanKey(env.ATTOM_KEY)) licensed.push('ATTOM Building Footprints');
  return {
    configured: licensed.length > 0,
    licensedProviders: licensed,
    openFallback: true,
    providers: [...licensed, 'Microsoft Global ML Building Footprints (ODbL)', 'OpenStreetMap / Overpass (ODbL)'],
    reason: licensed.length
      ? `Licensed footprint source active (${licensed[0]}), with public ODbL fallback.`
      : 'Public OpenStreetMap / ODbL building footprints available on demand for contiguous U.S. coordinates.'
  };
}

function finalizeRecord(raw, { provider, license, now, warnings = [], styleId = DEFAULT_HOME_STYLE }) {
  const style = resolveHomeStyle(styleId);
  let { polygon = null, areaSqFt = null, perimeterFt = null, lengthFt = null, widthFt = null, heightFt = null, stories = null, roofPitch = null, roofShape = null, architecture = null } = raw;
  if (polygon?.type === 'Polygon' && Array.isArray(polygon.coordinates?.[0])) {
    const measured = measurePolygonRing(polygon.coordinates[0]);
    if (measured) {
      areaSqFt ??= measured.areaSqFt;
      perimeterFt ??= measured.perimeterFt;
      lengthFt ??= measured.lengthFt;
      widthFt ??= measured.widthFt;
    }
  }
  areaSqFt = Number.isFinite(Number(areaSqFt)) && Number(areaSqFt) > 60 ? Math.round(Number(areaSqFt) * 10) / 10 : null;
  if ((!Number.isFinite(Number(lengthFt)) || !Number.isFinite(Number(widthFt))) && areaSqFt) {
    widthFt = Math.round(Math.sqrt(areaSqFt / style.ratio) * 10) / 10;
    lengthFt = Math.round((areaSqFt / widthFt) * 10) / 10;
  }
  if (!areaSqFt && Number.isFinite(Number(lengthFt)) && Number.isFinite(Number(widthFt))) {
    areaSqFt = Math.round(Number(lengthFt) * Number(widthFt) * 10) / 10;
  }
  if (!areaSqFt) return null;
  const hi = Math.max(Number(lengthFt), Number(widthFt));
  const lo = Math.min(Number(lengthFt), Number(widthFt));
  lengthFt = Math.round(hi * 10) / 10;
  widthFt = Math.round(lo * 10) / 10;
  perimeterFt = Number.isFinite(Number(perimeterFt)) && Number(perimeterFt) > 20
    ? Math.round(Number(perimeterFt) * 10) / 10
    : Math.round(2 * (lengthFt + widthFt) * 10) / 10;
  heightFt = heightFt !== null && Number.isFinite(Number(heightFt)) && Number(heightFt) > 0
    ? Math.round(Number(heightFt) * 10) / 10
    : parseHeightFt(heightFt);
  stories = Number.isFinite(Number(stories)) && Number(stories) >= 1
    ? Math.min(4, Math.max(1, Math.round(Number(stories))))
    : heightFt ? Math.min(4, Math.max(1, Math.round(heightFt / 9.84))) : null;
  roofPitch = typeof roofPitch === 'string' && roofPitch.trim() ? roofPitch.trim().slice(0, 32)
    : typeof roofPitch === 'number' && Number.isFinite(roofPitch) ? String(Math.round(roofPitch * 100) / 100) : null;
  const record = {
    polygon: polygon?.type === 'Polygon' ? polygon : null,
    areaSqFt,
    perimeterFt,
    lengthFt,
    widthFt,
    heightFt,
    stories,
    roofPitch,
    roofShape: typeof roofShape === 'string' ? roofShape.slice(0, 40) : null,
    architecture: typeof architecture === 'string' ? architecture.slice(0, 60) : null,
    source: {
      provider,
      license,
      retrievedAt: new Date(now).toISOString(),
      approximate: true
    },
    warnings: [
      `Style variant sized from ${provider} — approximate, not your surveyed footprint.`,
      ...warnings
    ].slice(0, 6)
  };
  record.suggestedStyle = suggestStyleFromFootprint(record) || style.id;
  return record;
}

function extractVendorPayload(vendor, payload, styleId) {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload.building || payload.footprint || payload.property?.[0] || payload.data || payload.features?.[0] || payload;
  if (root?.type === 'Feature' || root?.geometry) return parseGeoJsonFootprint(root, styleId);
  const polygon = root.polygon || root.geometry || null;
  const areaSqFt = root.areaSqFt ?? root.footprint_sqft ?? root.area_sqft ?? root.building?.size?.groundfloorsize ?? root.summary?.groundFloorSqFt ?? null;
  const perimeterFt = root.perimeterFt ?? root.perimeter_ft ?? root.wallExteriorPerimeterFt ?? null;
  const heightFt = root.heightFt ?? root.eaveHeightFt ?? (Number.isFinite(Number(root.height_m)) ? Number(root.height_m) * 3.280839895 : null);
  const stories = root.stories ?? root.levels ?? root.building?.summary?.levels ?? null;
  const roofPitch = root.roofPitch ?? root.roof_pitch ?? root.roof?.predominantPitch ?? null;
  const roofShape = root.roofShape ?? root.roof_shape ?? root.roof?.shape ?? null;
  const architecture = root.architecture ?? root.building?.summary?.archStyle ?? null;
  return { polygon, areaSqFt, perimeterFt, lengthFt: root.lengthFt ?? null, widthFt: root.widthFt ?? null, heightFt, stories, roofPitch, roofShape, architecture };
}

async function defaultOverpassFetch(coordinates, { signal }) {
  const response = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Accept: 'application/json',
      'User-Agent': 'CurbQuote-AlcoProducts/0.14 (exterior-estimator)'
    },
    body: `data=${encodeURIComponent(buildOverpassQuery(coordinates))}`,
    credentials: 'omit',
    referrerPolicy: 'strict-origin',
    cache: 'no-store',
    redirect: 'error',
    signal
  });
  if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
  return response.json();
}

export async function resolveFootprint(
  { address = '', coordinates = null, styleId = DEFAULT_HOME_STYLE, consented = false, openOnly = false } = {},
  {
    env = process.env,
    fetchJson = fetchPropertyJson,
    fetchOverpass = defaultOverpassFetch,
    fetchMapTiles = nearbyBuildings,
    propertyResolver = resolveProperty,
    now = Date.now()
  } = {}
) {
  // The automatic open-data lookup needs no confirmation: it skips licensed providers and sends
  // only the coordinate, never the street address, to the open footprint services.
  const licensed = consented === true && openOnly !== true;
  if (!licensed && openOnly !== true) {
    throw new FootprintLookupError('Confirm permission before requesting building dimensions for this address.', 403, 'FOOTPRINT_CONSENT_REQUIRED');
  }
  const normalizedAddress = address && licensed ? validateAddress(address) : '';
  if (!coordinates || !hasAerialCoverage(coordinates)) {
    throw new FootprintLookupError('Public and licensed footprint lookups cover the contiguous U.S. with a matched coordinate.', 422, 'OUT_OF_COVERAGE');
  }

  const approved = env.DATA_USE_APPROVED === 'true';
  const style = resolveHomeStyle(styleId);
  const queryParams = new URLSearchParams({
    ...(normalizedAddress ? { address: normalizedAddress } : {}),
    lat: coordinates.lat.toFixed(6),
    lon: coordinates.lon.toFixed(6)
  });

  // 1-3: Licensed commercial footprint providers (only when DATA_USE_APPROVED === 'true' + consented).
  if (approved && licensed) {
    const licensedChain = [
      ['earthdefine', cleanKey(env.EARTHDEFINE_KEY), env.EARTHDEFINE_URL || LICENSED_FOOTPRINT_ENDPOINTS.earthdefine, 'EarthDefine 3D Building Footprints'],
      ['eagleview', cleanKey(env.EAGLEVIEW_KEY), env.EAGLEVIEW_URL || LICENSED_FOOTPRINT_ENDPOINTS.eagleview, 'EagleView Property Data'],
      ['attom', cleanKey(env.ATTOM_KEY), env.ATTOM_URL || LICENSED_FOOTPRINT_ENDPOINTS.attom, 'ATTOM Building Footprints']
    ];
    for (const [vendor, apiKey, baseUrl, label] of licensedChain) {
      if (!apiKey) continue;
      try {
        const target = new URL(`${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${queryParams}`);
        const res = await fetchJson(target, { apiKey, signal: AbortSignal.timeout(6500) });
        if (res.status === 200) {
          const parsed = extractVendorPayload(vendor, res.payload, style.id);
          const record = parsed && finalizeRecord(parsed, { provider: label, license: 'commercial', now, styleId: style.id });
          if (record) return record;
        }
      } catch {
        // Fall through cleanly to the next configured provider in the chain.
      }
    }

    // Licensed property-record fallback (`lib/property.mjs`: ATTOM/Regrid/Cotality grant) if configured.
    if (normalizedAddress) {
      try {
        const prop = await propertyResolver(normalizedAddress, { env, fetchJson, now });
        if (canImportProperty(prop.source) && prop.facts.living_area_sqft) {
          const stories = Number.isInteger(prop.facts.stories) && prop.facts.stories >= 1 && prop.facts.stories <= 4 ? prop.facts.stories : style.stories;
          const groundSqFt = prop.facts.living_area_sqft / stories;
          const record = finalizeRecord(
            { areaSqFt: groundSqFt, stories },
            {
              provider: `${prop.source.provider} (living-area derivation)`,
              license: 'commercial',
              now,
              styleId: style.id,
              warnings: ['Derived ground footprint as living area ÷ stories; garages and porches are excluded.']
            }
          );
          if (record) return record;
        }
      } catch {
        // Continue to open ODbL sources.
      }
    }
  }

  // 4. Open fallback #1: Microsoft Global ML Building Footprints / Overture GeoJSON endpoint (ODbL).
  if (typeof env.MICROSOFT_FOOTPRINTS_URL === 'string' && env.MICROSOFT_FOOTPRINTS_URL.startsWith('https://')) {
    try {
      const target = new URL(`${env.MICROSOFT_FOOTPRINTS_URL}${env.MICROSOFT_FOOTPRINTS_URL.includes('?') ? '&' : '?'}${queryParams}`);
      const res = await fetchJson(target, { signal: AbortSignal.timeout(6500) });
      if (res.status === 200) {
        const feature = Array.isArray(res.payload?.features) ? res.payload.features[0] : res.payload;
        const parsed = parseGeoJsonFootprint(feature, style.id);
        const record = parsed && finalizeRecord(parsed, {
          provider: 'Microsoft Global ML Building Footprints (ODbL)',
          license: 'ODbL-1.0',
          now,
          styleId: style.id,
          warnings: ['Open ODbL building footprint — verify actual wall lengths before ordering material.']
        });
        if (record) return record;
      }
    } catch {
      // Fall through to OpenStreetMap Overpass.
    }
  }

  // 5. Open fallback #2: OpenStreetMap Overpass (`way(around:35,lat,lon)["building"];out body geom;`).
  // Overpass is often busy, throttles cloud servers and answers an empty list when its own query
  // times out; the same OpenStreetMap outlines are then read from OpenFreeMap's map tiles.
  const osmRecordFrom = (payload, provider) => {
    const parsed = parseOverpassFootprint(payload, coordinates, style.id);
    return parsed && finalizeRecord(parsed, { provider, license: 'ODbL-1.0', now, styleId: style.id, warnings: ['OpenStreetMap community outline — verify wall dimensions on site before ordering material.'] });
  };
  const fromTiles = () => fetchMapTiles(coordinates, { signal: AbortSignal.timeout(6500) }).then(payload => osmRecordFrom(payload, 'OpenStreetMap via OpenFreeMap (ODbL)'));
  let osmPayload = null, overpassDown = false;
  try { osmPayload = await fetchOverpass(coordinates, { signal: AbortSignal.timeout(6500) }); }
  catch { overpassDown = true; }
  const osmRecord = osmPayload && osmRecordFrom(osmPayload, 'OpenStreetMap / Overpass (ODbL)');
  if (!osmRecord) {
    const tiled = await fromTiles().catch(() => undefined);
    if (tiled) return tiled;
    if (overpassDown && tiled === undefined) throw new FootprintLookupError('Public footprint services are unreachable right now. Enter measurements manually or use the satellite measuring guide.', 503, 'FOOTPRINT_UPSTREAM_UNAVAILABLE');
  }
  if (!osmRecord) {
    throw new FootprintLookupError('No mapped building outline was found within 35 m of this address. Enter measurements manually below.', 404, 'FOOTPRINT_NO_MATCH');
  }
  return osmRecord;
}
