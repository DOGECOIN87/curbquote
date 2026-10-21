/** Reviewed prototype coverage. A nearby address must never inherit this model. */
export const EXTERIOR_EXAMPLE = Object.freeze({
  id: 'neill-cochran', name: 'Neill-Cochran House Museum',
  matchedAddress: '2310 SAN GABRIEL ST, AUSTIN, TX, 78705',
  coordinates: Object.freeze({ lon: -97.74825016366779, lat: 30.28748144026809 }),
  source: 'Public museum example — City of Austin building footprint, USGS 2017 lidar',
  model: 'assets/exteriors/neill-cochran/model.glb',
  manifest: 'assets/exteriors/neill-cochran/manifest.json'
});
const normalize = value => typeof value === 'string' ? value.toUpperCase().replace(/[,\.]/g, ' ').replace(/\bSTREET\b/g, 'ST').replace(/\s+/g, ' ').trim() : '';
export function exteriorForLocation(location) {
  if (normalize(location?.matchedAddress) !== normalize(EXTERIOR_EXAMPLE.matchedAddress)) return null;
  const { lon, lat } = location.coordinates || {};
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  // Allow the Census street-range offset, but reject unrelated coordinates.
  const north = (lat - EXTERIOR_EXAMPLE.coordinates.lat) * 111320;
  const east = (lon - EXTERIOR_EXAMPLE.coordinates.lon) * 111320 * Math.cos(lat * Math.PI / 180);
  return Math.hypot(north, east) <= 75 ? EXTERIOR_EXAMPLE : null;
}
