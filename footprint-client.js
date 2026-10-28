/**
 * Shared public building-footprint geometry parser (OpenStreetMap Overpass & ODbL GeoJSON) and
 * browser client. Pure planar math computes area, perimeter and street-aligned rectangle bounds;
 * Census coordinates only locate nearby mapped outlines and never supply dimensions themselves.
 */
import { STATIC_SITE } from './config.js';
import { hasAerialCoverage } from './property-view.js';
import { DEFAULT_HOME_STYLE, resolveHomeStyle, suggestStyleFromFootprint } from './home-styles.js';
import { nearbyBuildings } from './osm-tiles.js';
import { solarOutline, solarRoof } from './google-maps.js';

export const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const EARTH_RADIUS_M = 6378137;
const DEG = Math.PI / 180;
const M_TO_FT = 3.280839895013123;
const M2_TO_SQFT = 10.763910416709722;

function toLocalMeters(ring, originLon, originLat) {
  const cosLat = Math.cos(originLat * DEG);
  return ring.map(([lon, lat]) => [
    (lon - originLon) * DEG * EARTH_RADIUS_M * cosLat,
    (lat - originLat) * DEG * EARTH_RADIUS_M
  ]);
}

function pointInRing(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/** Computes area (sq ft), perimeter (ft) and minimum-area oriented rectangle (lengthFt × widthFt). */
export function measurePolygonRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return null;
  const coords = ring.filter(pt => Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1]));
  if (coords.length < 4) return null;
  const closed = coords[0][0] === coords.at(-1)[0] && coords[0][1] === coords.at(-1)[1] ? coords : [...coords, coords[0]];
  const open = closed.slice(0, -1);
  if (open.length < 3) return null;
  const originLon = open.reduce((s, p) => s + p[0], 0) / open.length;
  const originLat = open.reduce((s, p) => s + p[1], 0) / open.length;
  const pts = toLocalMeters(open, originLon, originLat);
  let shoelace = 0, perimM = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    shoelace += x1 * y2 - x2 * y1;
    perimM += Math.hypot(x2 - x1, y2 - y1);
  }
  const areaM2 = Math.abs(shoelace) / 2;
  if (!Number.isFinite(areaM2) || areaM2 < 8) return null;
  let bestArea = Infinity, bestSpanA = 0, bestSpanB = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    const edgeLen = Math.hypot(x2 - x1, y2 - y1);
    if (edgeLen < 1e-4) continue;
    const ux = (x2 - x1) / edgeLen, uy = (y2 - y1) / edgeLen;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [px, py] of pts) {
      const u = px * ux + py * uy, v = -px * uy + py * ux;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const spanU = maxU - minU, spanV = maxV - minV;
    if (spanU * spanV < bestArea) {
      bestArea = spanU * spanV;
      bestSpanA = spanU * M_TO_FT;
      bestSpanB = spanV * M_TO_FT;
    }
  }
  const lengthFt = Math.round(Math.max(bestSpanA, bestSpanB) * 10) / 10;
  const widthFt = Math.round(Math.min(bestSpanA, bestSpanB) * 10) / 10;
  return {
    polygon: { type: 'Polygon', coordinates: [closed.map(([lon, lat]) => [Math.round(lon * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7])] },
    areaSqFt: Math.round(areaM2 * M2_TO_SQFT * 10) / 10,
    perimeterFt: Math.round(perimM * M_TO_FT * 10) / 10,
    lengthFt,
    widthFt,
    centroid: { lon: originLon, lat: originLat },
    localPoints: pts
  };
}

export function parseHeightFt(rawHeight) {
  if (rawHeight === null || rawHeight === undefined) return null;
  if (typeof rawHeight === 'number' && Number.isFinite(rawHeight) && rawHeight > 0) {
    return Math.round(rawHeight * M_TO_FT * 10) / 10;
  }
  const text = String(rawHeight).trim();
  const feetInches = text.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)(?:\s*(\d+(?:\.\d+)?)\s*(?:"|in))?$/i);
  if (feetInches) return Math.round((Number(feetInches[1]) + (Number(feetInches[2] || 0) / 12)) * 10) / 10;
  const meters = text.match(/^(\d+(?:\.\d+)?)\s*m?$/i);
  if (meters && Number(meters[1]) > 0) return Math.round(Number(meters[1]) * M_TO_FT * 10) / 10;
  return null;
}

export function buildOverpassQuery({ lat, lon }, radiusMeters = 35) {
  if (!hasAerialCoverage({ lat, lon })) {
    throw new RangeError('Public building footprints currently cover the contiguous U.S.');
  }
  const r = Math.min(60, Math.max(15, Math.round(radiusMeters)));
  return `[out:json][timeout:6];way(around:${r},${lat.toFixed(6)},${lon.toFixed(6)})["building"];out body geom;`;
}

/** Parses an Overpass JSON response around `{ lat, lon }` into a normalized building footprint. */
export function parseOverpassFootprint(payload, center, styleId = DEFAULT_HOME_STYLE) {
  const elements = Array.isArray(payload?.elements) ? payload.elements : null;
  if (!elements) return null;
  const candidates = [];
  for (const el of elements) {
    if (!Array.isArray(el?.geometry) || el.geometry.length < 4) continue;
    const ring = el.geometry.map(pt => [Number(pt.lon), Number(pt.lat)]);
    const measured = measurePolygonRing(ring);
    if (!measured || measured.areaSqFt < 120) continue;
    const [targetX, targetY] = toLocalMeters([[center.lon, center.lat]], measured.centroid.lon, measured.centroid.lat)[0];
    const contains = pointInRing(targetX, targetY, measured.localPoints);
    const distanceM = Math.hypot(targetX, targetY);
    const tags = el.tags && typeof el.tags === 'object' ? el.tags : {};
    const accessory = ['garage', 'garages', 'shed', 'carport', 'roof', 'gazebo'].includes(String(tags.building || '').toLowerCase());
    candidates.push({ measured, tags, contains, distanceM, accessory });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) =>
    Number(b.contains) - Number(a.contains) ||
    Number(a.accessory) - Number(b.accessory) ||
    a.distanceM - b.distanceM
  );
  const chosen = candidates[0];
  const { measured, tags } = chosen;
  const levels = Number(tags['building:levels']);
  const heightFt = parseHeightFt(tags.height);
  const stories = Number.isFinite(levels) && levels >= 1
    ? Math.min(4, Math.max(1, Math.round(levels)))
    : heightFt ? Math.min(4, Math.max(1, Math.round((heightFt / M_TO_FT) / 3))) : null;
  const roofPitch = tags['roof:angle'] ? `${tags['roof:angle']}deg` : null;
  const base = {
    polygon: measured.polygon,
    areaSqFt: measured.areaSqFt,
    perimeterFt: measured.perimeterFt,
    lengthFt: measured.lengthFt,
    widthFt: measured.widthFt,
    heightFt,
    stories,
    roofPitch,
    roofShape: typeof tags['roof:shape'] === 'string' ? tags['roof:shape'].slice(0, 40) : null,
    architecture: typeof tags['building:architecture'] === 'string' ? tags['building:architecture'].slice(0, 60) : null
  };
  base.suggestedStyle = suggestStyleFromFootprint({ ...base, tags }) || resolveHomeStyle(styleId).id;
  return base;
}

/** Normalizes a Microsoft Global ML Building Footprints / Overture Maps GeoJSON feature (ODbL). */
export function parseGeoJsonFootprint(feature, styleId = DEFAULT_HOME_STYLE) {
  const geom = feature?.geometry || feature;
  const ring = geom?.type === 'Polygon' ? geom.coordinates?.[0]
    : geom?.type === 'MultiPolygon' ? geom.coordinates?.[0]?.[0]
    : null;
  const style = resolveHomeStyle(styleId);
  const props = feature?.properties && typeof feature.properties === 'object' ? feature.properties : {};
  const measured = ring ? measurePolygonRing(ring) : null;
  const rawAreaSqFt = measured?.areaSqFt ?? (Number.isFinite(Number(props.areaSqFt)) ? Number(props.areaSqFt) : Number.isFinite(Number(props.area_m2)) ? Number(props.area_m2) * M2_TO_SQFT : null);
  if (!rawAreaSqFt || rawAreaSqFt < 80) return null;
  const widthFt = measured ? measured.widthFt : Math.round(Math.sqrt(rawAreaSqFt / style.ratio) * 10) / 10;
  const lengthFt = measured ? measured.lengthFt : Math.round((rawAreaSqFt / widthFt) * 10) / 10;
  const perimeterFt = measured ? measured.perimeterFt : Math.round(2 * (lengthFt + widthFt) * 10) / 10;
  const heightMeters = Number(props.height ?? props.height_m);
  const heightFt = Number.isFinite(Number(props.heightFt)) && Number(props.heightFt) > 0
    ? Math.round(Number(props.heightFt) * 10) / 10
    : Number.isFinite(heightMeters) && heightMeters > 0 ? Math.round(heightMeters * M_TO_FT * 10) / 10 : null;
  const stories = Number.isFinite(Number(props.stories ?? props.num_floors)) && Number(props.stories ?? props.num_floors) >= 1
    ? Math.min(4, Math.max(1, Math.round(Number(props.stories ?? props.num_floors))))
    : heightFt ? Math.min(4, Math.max(1, Math.round((heightFt / M_TO_FT) / 3))) : null;
  const result = {
    polygon: measured ? measured.polygon : null,
    areaSqFt: Math.round(rawAreaSqFt * 10) / 10,
    perimeterFt,
    lengthFt: Math.max(lengthFt, widthFt),
    widthFt: Math.min(lengthFt, widthFt),
    heightFt,
    stories,
    roofPitch: typeof props.roofPitch === 'string' ? props.roofPitch.slice(0, 32) : null,
    roofShape: typeof props.roof_shape === 'string' ? props.roof_shape.slice(0, 40) : null,
    architecture: typeof props.architecture === 'string' ? props.architecture.slice(0, 60) : null
  };
  result.suggestedStyle = suggestStyleFromFootprint(result);
  return result;
}

const OPEN_WARNINGS = Object.freeze([
  'Derived from public OpenStreetMap building outlines — approximate, not your surveyed footprint.',
  'Porch, dormer and shutter previews are visual only and are not priced.'
]);
/** The same OpenStreetMap outlines, read from OpenFreeMap's map tiles; null when none is near. */
export async function fromMapTiles(coordinates, styleId, signal, fetchImpl) {
  const parsed = parseOverpassFootprint(await nearbyBuildings(coordinates, { signal, fetchImpl }), coordinates, styleId);
  return parsed && {
    ...parsed,
    source: { provider: 'OpenStreetMap via OpenFreeMap (ODbL)', license: 'ODbL-1.0', retrievedAt: new Date().toISOString(), approximate: true },
    warnings: [...OPEN_WARNINGS]
  };
}

const SOLAR_WARNINGS = Object.freeze([
  'Derived from Google Solar API building data — approximate, not your surveyed footprint.',
  'Porch, dormer and shutter previews are visual only and are not priced.'
]);
/**
 * The building at this point from Google's Solar API, as a footprint result, or null. Solar is the
 * primary source: its imagery-derived building (a rectangle turned to the roof's main direction)
 * is usually tighter and far more consistently available than the volunteer-mapped outline.
 */
export async function fromSolar(coordinates, styleId = DEFAULT_HOME_STYLE, signal) {
  const ring = await solarOutline([coordinates.lat, coordinates.lon], { signal }).catch(() => null);
  const measured = ring ? measurePolygonRing(ring) : null;
  if (!measured || measured.areaSqFt < 120) return null;
  // Same cached buildingInsights answer as the outline: the measured roof pitch (degrees) feeds
  // the remodel model's gable rise through the usual pitch parsing, at no extra request.
  const roof = await solarRoof([coordinates.lat, coordinates.lon], { signal }).catch(() => null);
  const result = {
    polygon: measured.polygon,
    areaSqFt: measured.areaSqFt,
    perimeterFt: measured.perimeterFt,
    lengthFt: measured.lengthFt,
    widthFt: measured.widthFt,
    heightFt: null,
    stories: null,
    roofPitch: roof?.pitchDeg ?? null,
    roofAzimuthDeg: roof?.azimuthDeg ?? null,
    roofShape: null,
    architecture: null,
    source: { provider: 'Google Solar API', license: 'Google Maps Platform', retrievedAt: new Date().toISOString(), approximate: true },
    warnings: [...SOLAR_WARNINGS]
  };
  result.suggestedStyle = suggestStyleFromFootprint(result) || resolveHomeStyle(styleId).id;
  return result;
}

/**
 * Fetches building dimensions on demand. Google's Solar API answers first (it needs the Maps
 * key, so on builds without one this step is a no-op); OpenStreetMap is the fallback — relative
 * `api/footprint` when hosted, a direct Overpass lookup on static GitHub Pages builds, and the
 * same outlines read from OpenFreeMap's map tiles when either of those fails.
 */
export async function fetchPublicFootprint(options = {}) {
  const { coordinates, styleId = DEFAULT_HOME_STYLE, signal } = options;
  if (coordinates && hasAerialCoverage(coordinates)) {
    const solar = await fromSolar(coordinates, styleId, signal).catch(() => null);
    if (solar) return solar;
  }
  // Hosted, the server already falls back to the map tiles; the static site has no server.
  if (!STATIC_SITE) return lookupFootprint(options);
  const { fetchImpl = fetch } = options;
  try { return await lookupFootprint(options); }
  catch (error) {
    if (signal?.aborted || error?.consent) throw error;
    const fallback = await fromMapTiles(coordinates, styleId, signal, fetchImpl).catch(() => null);
    if (fallback) return fallback;
    throw error;
  }
}
async function lookupFootprint({ address, coordinates, styleId = DEFAULT_HOME_STYLE, consented = false, openOnly = false, signal, fetchImpl = fetch } = {}) {
  // `openOnly` is the automatic lookup after an address match: open data, coordinate only, no confirmation.
  if (!consented && !openOnly) {
    throw Object.assign(new Error('Confirm that you want to look up public or authorized building dimensions for this address first.'), { consent: true });
  }
  if (!hasAerialCoverage(coordinates)) {
    throw Object.assign(new Error('Public footprint lookup covers the contiguous U.S. Enter measurements manually below.'), { consent: true });
  }
  if (!STATIC_SITE) {
    const response = await fetchImpl('api/footprint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(openOnly ? { coordinates, styleId, consented: false, openOnly: true } : { address: address || undefined, coordinates, styleId, consented: true }),
      credentials: 'omit',
      referrerPolicy: 'strict-origin',
      cache: 'no-store',
      signal
    });
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error('Footprint lookup returned an unreadable response. Enter dimensions manually.'); }
    if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Public footprint data is unavailable here. Enter dimensions manually.');
    return payload;
  }
  const body = `data=${encodeURIComponent(buildOverpassQuery(coordinates))}`;
  const response = await fetchImpl(OVERPASS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
    body,
    credentials: 'omit',
    referrerPolicy: 'strict-origin',
    cache: 'no-store',
    signal
  });
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('OpenStreetMap Overpass is busy right now. Enter measurements manually or trace in satellite view.'); }
  if (!response.ok) throw new Error('OpenStreetMap Overpass is unavailable right now. Enter measurements manually.');
  const parsed = parseOverpassFootprint(payload, coordinates, styleId);
  if (!parsed) throw new Error('No mapped building outline was found within 35 m of this address point. Enter measurements manually.');
  return {
    ...parsed,
    source: {
      provider: 'OpenStreetMap / Overpass (ODbL)',
      license: 'ODbL-1.0',
      retrievedAt: new Date().toISOString(),
      approximate: true
    },
    warnings: [
      'Derived from public OpenStreetMap building outlines — approximate, not your surveyed footprint.',
      'Porch, dormer and shutter previews are visual only and are not priced.'
    ]
  };
}
