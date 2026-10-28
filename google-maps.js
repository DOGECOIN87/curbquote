/**
 * Google Maps Platform services that sharpen Step 1: address suggestions (Places), a Street View photo
 * of the front of the house, the building's roof outline (Solar API) and a pre-rendered flyover video
 * (Aerial View). The browser calls Google directly with the site's public key, restricted to this
 * site's domains, so the static Pages demo works the same as Vercel. Every call resolves null when no
 * key is set, the place has no coverage or the request fails, and the page carries on without it.
 * Nothing here reaches the estimate until the homeowner confirms a size.
 */
import { STATIC_SITE, STATIC_MAPS } from './config.js';

let config = null;
/** The public Maps key, or null. Read once per visit. */
export function mapsKey() {
  config ??= (STATIC_SITE ? Promise.resolve(STATIC_MAPS) : fetch('api/map3d', { headers: { Accept: 'application/json' }, cache: 'no-store' }).then(response => response.ok ? response.json() : {}).then(body => ({ key: body.mapsKey })))
    .then(value => typeof value?.key === 'string' && /^[\w-]{20,120}$/.test(value.key) ? value.key : null)
    .catch(() => null);
  return config;
}
const metresPerDegree = lat => [111320 * Math.cos(lat * Math.PI / 180), 110540];
/** Compass bearing in degrees (0 = north, clockwise) from one [lat, lon] point to another. */
export function bearing([lat1, lon1], [lat2, lon2]) {
  const [kx, ky] = metresPerDegree((lat1 + lat2) / 2);
  return (Math.atan2((lon2 - lon1) * kx, (lat2 - lat1) * ky) * 180 / Math.PI + 360) % 360;
}
export const distanceMetres = ([lat1, lon1], [lat2, lon2]) => { const [kx, ky] = metresPerDegree((lat1 + lat2) / 2); return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * ky); };

/** A random token that groups one address entry's suggestion requests for Google's billing. */
export const suggestionSession = () => (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/[^\w-]/g, '');
/** Up to five U.S. address suggestions for what has been typed: [{ text, main, secondary }]. */
export async function suggestAddresses(input, { session, signal } = {}) {
  const key = await mapsKey(), text = String(input || '').trim();
  if (!key || text.length < 4) return [];
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat' },
      body: JSON.stringify({ input: text.slice(0, 120), sessionToken: session, includedRegionCodes: ['us'], languageCode: 'en' })
    });
    if (!response.ok) return [];
    const { suggestions = [] } = await response.json();
    return suggestions.map(({ placePrediction: p }) => p?.text?.text && {
      // Census matches "…, TX 78212" but not a trailing country.
      text: p.text.text.replace(/,\s*(USA|United States)$/i, ''),
      main: p.structuredFormat?.mainText?.text || p.text.text, secondary: (p.structuredFormat?.secondaryText?.text || '').replace(/,\s*(USA|United States)$/i, '')
    }).filter(Boolean).slice(0, 5);
  } catch { return []; }
}

/**
 * The nearest outdoor Street View panorama, aimed at the house: { url, date, heading } or null.
 * Metadata requests are free; the image is only requested when the page shows it.
 */
export async function streetView([lat, lon], { signal, width = 640, height = 400 } = {}) {
  const key = await mapsKey();
  if (!key) return null;
  try {
    const base = 'https://maps.googleapis.com/maps/api/streetview';
    const meta = await fetch(`${base}/metadata?${new URLSearchParams({ location: `${lat},${lon}`, radius: '60', source: 'outdoor', key })}`, { signal }).then(response => response.json());
    if (meta?.status !== 'OK' || !meta.location || !meta.pano_id) return null;
    const heading = Math.round(bearing([meta.location.lat, meta.location.lng], [lat, lon]));
    const url = `${base}?${new URLSearchParams({ size: `${width}x${height}`, pano: meta.pano_id, heading: String(heading), fov: '70', pitch: '6', source: 'outdoor', return_error_code: 'true', key })}`;
    return { url, date: typeof meta.date === 'string' ? meta.date : null, heading };
  } catch { return null; }
}

/**
 * The building nearest a point from Google's Solar API, as an outline ring of [lon, lat] points
 * (a rectangle turned to the roof's main direction), or null when there is none within `reach` metres.
 */
const solarCache = new Map();
function solarInsights([lat, lon], options = {}) {
  // One request per building per visit: the outline and the roof stats share the same answer.
  const id = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  if (!solarCache.has(id)) solarCache.set(id, findSolar([lat, lon], options));
  return solarCache.get(id);
}
export async function solarOutline(coordinates, options = {}) {
  const insights = await solarInsights(coordinates, options);
  return insights ? outlineFromInsights(insights) : null;
}
/** The roof's measured pitch and main direction from Solar, or null. Pitch is in degrees. */
export async function solarRoof(coordinates, options = {}) {
  const insights = await solarInsights(coordinates, options);
  return insights ? roofFromInsights(insights) : null;
}
async function findSolar([lat, lon], { signal, reach = 35 } = {}) {
  const key = await mapsKey();
  if (!key) return null;
  try {
    const query = new URLSearchParams({ 'location.latitude': String(lat), 'location.longitude': String(lon), requiredQuality: 'MEDIUM', key });
    const response = await fetch(`https://solar.googleapis.com/v1/buildingInsights:findClosest?${query}`, { signal });
    if (!response.ok) return null;
    const insights = await response.json(), centre = insights?.center;
    if (!centre || distanceMetres([lat, lon], [centre.latitude, centre.longitude]) > reach) return null;
    return insights;
  } catch { return null; }
}
/**
 * The sloped roof segments of a Solar buildingInsights answer, reduced to the numbers a model
 * needs: the area-weighted pitch (degrees), the main segment direction (degrees, the azimuth a
 * roof face looks toward), and how many segments were counted. Flat or segment-less roofs → null.
 */
export function roofFromInsights(insights) {
  let area = 0, pitchSum = 0, sx = 0, sy = 0, segments = 0;
  for (const segment of insights?.solarPotential?.roofSegmentStats || []) {
    const a = segment?.stats?.areaMeters2, pitch = segment?.pitchDegrees, azimuth = segment?.azimuthDegrees;
    if (!(pitch > 5) || !Number.isFinite(a) || a <= 0 || !Number.isFinite(azimuth)) continue;
    area += a; pitchSum += a * pitch; segments++;
    sx += a * Math.cos(azimuth * Math.PI / 45); sy += a * Math.sin(azimuth * Math.PI / 45);
  }
  if (!segments || !(area > 0)) return null;
  const turn = sx || sy ? Math.atan2(sy, sx) / 4 : 0;
  return {
    pitchDeg: Math.round(pitchSum / area * 2) / 2,
    azimuthDeg: Math.round(((turn * 180 / Math.PI) % 360 + 360) % 360),
    segments
  };
}
/**
 * A rectangle from Solar buildingInsights: the roof's main direction from its sloped segments
 * (weighted by area), and the side lengths that fit that turned rectangle into the north-aligned
 * bounding box. Near 45° the fit is unstable, so a square of the roof's ground area is used.
 */
export function outlineFromInsights(insights) {
  const box = insights?.boundingBox, sw = box?.sw, ne = box?.ne;
  if (![sw?.latitude, sw?.longitude, ne?.latitude, ne?.longitude].every(Number.isFinite)) return null;
  const lat0 = (sw.latitude + ne.latitude) / 2, lon0 = (sw.longitude + ne.longitude) / 2, [kx, ky] = metresPerDegree(lat0);
  const W = (ne.longitude - sw.longitude) * kx, H = (ne.latitude - sw.latitude) * ky;
  if (!(W > 2 && H > 2 && W < 200 && H < 200)) return null;
  // Facades repeat every 90°, so average the roof directions on a circle four times round.
  let sx = 0, sy = 0;
  for (const segment of insights.solarPotential?.roofSegmentStats || []) {
    const area = segment?.stats?.areaMeters2, azimuth = segment?.azimuthDegrees;
    if (!(segment?.pitchDegrees > 5) || !Number.isFinite(area) || !Number.isFinite(azimuth)) continue;
    sx += area * Math.cos(azimuth * Math.PI / 45); sy += area * Math.sin(azimuth * Math.PI / 45);
  }
  const turn = sx || sy ? Math.atan2(sy, sx) / 4 : 0, c = Math.abs(Math.cos(turn)), s = Math.abs(Math.sin(turn)), det = c * c - s * s;
  let length = det > .35 ? (W * c - H * s) / det : 0, width = det > .35 ? (H * c - W * s) / det : 0;
  if (!(length > 2 && width > 2)) {
    const ground = insights.solarPotential?.wholeRoofStats?.groundAreaMeters2;
    length = width = Number.isFinite(ground) && ground > 4 ? Math.sqrt(ground) : Math.min(W, H) / Math.SQRT2;
  }
  // Corners in metres (x east, y north), turned clockwise by the roof direction.
  const cos = Math.cos(turn), sin = Math.sin(turn);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => {
    const x = a * length / 2, y = b * width / 2;
    return [lon0 + (x * cos + y * sin) / kx, lat0 + (-x * sin + y * cos) / ky];
  });
}

/**
 * Whether Google has already made an Aerial View flyover of an address: { videoId } or null. Only
 * existing videos are used; none are commissioned.
 */
const flyoverCache = new Map();
export function flyoverAvailable(address, options = {}) {
  if (!flyoverCache.has(address)) flyoverCache.set(address, findFlyover(address, options));
  return flyoverCache.get(address);
}
async function findFlyover(address, { signal } = {}) {
  const key = await mapsKey();
  if (!key || !address) return null;
  try {
    const response = await fetch(`https://aerialview.googleapis.com/v1/videos:lookupVideoMetadata?${new URLSearchParams({ address, key })}`, { signal });
    if (!response.ok) return null;
    const body = await response.json();
    // The API answers flat: { videoId, state, captureDate, duration } (no metadata wrapper).
    const videoId = body?.videoId || body?.metadata?.videoId;
    return body?.state === 'ACTIVE' && videoId ? { videoId, captureDate: body.captureDate || body.metadata?.captureDate || null } : null;
  } catch { return null; }
}
/** The flyover's short-lived MP4 address for this view (landscape or portrait), or null. Billed per call. */
export async function flyoverVideo(videoId, { portrait = false, signal } = {}) {
  const key = await mapsKey();
  if (!key || !videoId) return null;
  try {
    const response = await fetch(`https://aerialview.googleapis.com/v1/videos:lookupVideo?${new URLSearchParams({ videoId, key })}`, { signal });
    if (!response.ok) return null;
    const uris = (await response.json())?.uris, pick = uris?.MP4_MEDIUM || uris?.MP4_HIGH || uris?.MP4_LOW;
    const url = pick && (portrait ? pick.portraitUri || pick.landscapeUri : pick.landscapeUri);
    return typeof url === 'string' && /^https:\/\/[\w.-]+\.googlevideo\.com\//.test(url) ? url : null;
  } catch { return null; }
}
