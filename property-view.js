/** A display-only aerial view. No image or map dimensions enter the estimator. */
export const AERIAL_ENDPOINT = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage';
export const VIEW_WIDTH = 960;
export const VIEW_HEIGHT = 600;
export const DEFAULT_VIEW_METERS = 180;
const RADIUS = 6378137;
const degrees = 180 / Math.PI;

export function hasAerialCoverage(coordinates) {
  return typeof coordinates?.lat === 'number' && typeof coordinates?.lon === 'number' &&
    Number.isFinite(coordinates.lat) && Number.isFinite(coordinates.lon) &&
    coordinates.lat >= 24 && coordinates.lat <= 50 && coordinates.lon >= -125 && coordinates.lon <= -66;
}
export function projectPoint({ lat, lon }) {
  if (!hasAerialCoverage({ lat, lon })) throw new RangeError('The aerial preview currently covers the contiguous U.S.');
  return { x: RADIUS * lon / degrees, y: RADIUS * Math.log(Math.tan(Math.PI / 4 + lat / degrees / 2)) };
}
export function unprojectPoint({ x, y }) {
  return { lat: (2 * Math.atan(Math.exp(y / RADIUS)) - Math.PI / 2) * degrees, lon: x / RADIUS * degrees };
}
export function aerialView(center, widthMeters = DEFAULT_VIEW_METERS) {
  const point = projectPoint(center);
  if (!Number.isFinite(widthMeters) || widthMeters < 60 || widthMeters > 1200) throw new RangeError('Aerial view width must be 60–1200 meters.');
  const width = widthMeters / Math.cos(center.lat / degrees), height = width * VIEW_HEIGHT / VIEW_WIDTH;
  const bbox = [point.x - width / 2, point.y - height / 2, point.x + width / 2, point.y + height / 2];
  const query = new URLSearchParams({ bbox: bbox.map(n => n.toFixed(3)).join(','), bboxSR: '3857', imageSR: '3857', size: `${VIEW_WIDTH},${VIEW_HEIGHT}`, format: 'jpg', interpolation: 'RSP_BilinearInterpolation', f: 'image' });
  return { url: `${AERIAL_ENDPOINT}?${query}`, bbox, widthMeters };
}
export function moveView(view, horizontal, vertical) {
  const [left, bottom, right, top] = view.bbox;
  return unprojectPoint({ x: (left + right) / 2 + (right - left) * horizontal, y: (bottom + top) / 2 - (top - bottom) * vertical });
}
export function pointInView(view, coordinates) {
  const point = projectPoint(coordinates), [left, bottom, right, top] = view.bbox;
  return { x: (point.x - left) / (right - left) * VIEW_WIDTH, y: (top - point.y) / (top - bottom) * VIEW_HEIGHT };
}
