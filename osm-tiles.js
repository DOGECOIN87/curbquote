/**
 * OpenStreetMap building outlines read from OpenFreeMap's vector tiles: the same ODbL data the free
 * 3D map draws, served from a CDN. Used when Overpass is busy or unreachable, so a mapped outline
 * still sizes the home. Only the building layer of one zoom-14 tile (a few square kilometres) is
 * decoded, with a small reader for the Mapbox Vector Tile format.
 */
import { MAP_DATA_URL } from './map-style.js';

const ZOOM = 14;

/** Protocol Buffers: the few wire types a vector tile uses. */
function fields(bytes, start = 0, end = bytes.length) {
  let pos = start;
  const varint = () => { let value = 0, scale = 1, byte; do { byte = bytes[pos++]; value += (byte & 0x7f) * scale; scale *= 128; } while (byte & 0x80); return value; };
  const out = [];
  while (pos < end) {
    const key = varint(), field = Math.floor(key / 8), wire = key % 8;
    if (wire === 0) out.push({ field, value: varint() });
    else if (wire === 2) { const length = varint(); out.push({ field, start: pos, end: pos + length }); pos += length; }
    else if (wire === 1) { out.push({ field, start: pos, end: pos + 8 }); pos += 8; }
    else if (wire === 5) { out.push({ field, start: pos, end: pos + 4 }); pos += 4; }
    else throw new Error('Unsupported vector tile encoding.');
  }
  return out;
}
function packed(bytes, { start, end }) {
  const values = [];
  for (let pos = start; pos < end;) { let value = 0, scale = 1, byte; do { byte = bytes[pos++]; value += (byte & 0x7f) * scale; scale *= 128; } while (byte & 0x80); values.push(value); }
  return values;
}
const zigzag = n => n % 2 ? -(n + 1) / 2 : n / 2;
const text = (bytes, { start, end }) => new TextDecoder().decode(bytes.subarray(start, end));
function number(bytes, entry) {
  const [value] = fields(bytes, entry.start, entry.end), view = new DataView(bytes.buffer, bytes.byteOffset);
  if (!value) return null;
  if (value.field === 1) return text(bytes, value);
  if (value.field === 2) return view.getFloat32(value.start, true);
  if (value.field === 3) return view.getFloat64(value.start, true);
  if (value.field === 6) return zigzag(value.value);
  return value.value;
}

/** The zoom-14 tile holding a point. */
export function tileFor(lon, lat, z = ZOOM) {
  const n = 2 ** z, rad = lat * Math.PI / 180;
  return { z, x: Math.floor((lon + 180) / 360 * n), y: Math.floor((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2 * n) };
}

/** The outer rings (as [lon, lat]) and render heights of every building in a tile. */
export function decodeBuildings(buffer, { x, y, z }) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer), buildings = [];
  for (const layerEntry of fields(bytes).filter(entry => entry.field === 3)) {
    const parts = fields(bytes, layerEntry.start, layerEntry.end), name = parts.find(part => part.field === 1);
    if (!name || text(bytes, name) !== 'building') continue;
    const keys = parts.filter(part => part.field === 3).map(part => text(bytes, part)), values = parts.filter(part => part.field === 4);
    const extent = parts.find(part => part.field === 5)?.value || 4096, n = 2 ** z;
    const toLonLat = ([px, py]) => {
      const wx = (x + px / extent) / n, wy = (y + py / extent) / n;
      return [wx * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180 / Math.PI];
    };
    for (const featureEntry of parts.filter(part => part.field === 2)) {
      const feature = fields(bytes, featureEntry.start, featureEntry.end);
      if (feature.find(part => part.field === 3)?.value !== 3) continue;   // polygons only
      const tags = feature.find(part => part.field === 2), geometry = feature.find(part => part.field === 4);
      if (!geometry) continue;
      const properties = {}, pairs = tags ? packed(bytes, tags) : [];
      for (let i = 0; i + 1 < pairs.length; i += 2) if (values[pairs[i + 1]]) properties[keys[pairs[i]]] = number(bytes, values[pairs[i + 1]]);
      const commands = packed(bytes, geometry), rings = [];
      let px = 0, py = 0, ring = null;
      for (let i = 0; i < commands.length;) {
        const command = commands[i] % 8, count = Math.floor(commands[i] / 8); i++;
        if (command === 1 || command === 2) for (let c = 0; c < count; c++) {
          px += zigzag(commands[i++]); py += zigzag(commands[i++]);
          if (command === 1) { ring = []; rings.push(ring); }
          ring.push([px, py]);
        } else if (command === 7 && ring) ring.push(ring[0]);
      }
      // Outer rings have a positive area in tile coordinates (y down); holes are negative.
      for (const points of rings) {
        let area = 0;
        for (let i = 0; i + 1 < points.length; i++) area += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1];
        if (area > 0 && points.length >= 4) buildings.push({ ring: points.map(toLonLat), renderHeight: Number(properties.render_height) || null });
      }
    }
  }
  return buildings;
}

let tileUrl = null;
/**
 * Mapped buildings near a point, in the shape of an Overpass answer (`elements` with `geometry` and
 * `tags`) so the same parser chooses and measures the outline. `radius` is in metres.
 */
export async function nearbyBuildings({ lat, lon }, { radius = 35, signal, fetchImpl = fetch } = {}) {
  tileUrl ??= fetchImpl(MAP_DATA_URL, { credentials: 'omit', signal }).then(response => response.ok ? response.json() : Promise.reject(new Error('Map data unavailable.')))
    .then(json => { const url = json?.tiles?.[0]; if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('Map data unavailable.'); return url; })
    .catch(error => { tileUrl = null; throw error; });
  const tile = tileFor(lon, lat), template = await tileUrl;
  const response = await fetchImpl(template.replace('{z}', tile.z).replace('{x}', tile.x).replace('{y}', tile.y), { credentials: 'omit', signal });
  // Tile addresses carry a dated version that OpenFreeMap retires; ask for the current one next time.
  if (!response.ok) { tileUrl = null; throw new Error('Map data unavailable.'); }
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540;
  // Within `radius` of the point: inside the outline, or that close to one of its walls.
  const near = ring => {
    const pts = ring.map(([x, y]) => [(x - lon) * kx, (y - lat) * ky]);
    let inside = false, closest = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j], dx = xj - xi, dy = yj - yi;
      if ((yi > 0) !== (yj > 0) && 0 < dx * (0 - yi) / dy + xi) inside = !inside;
      const t = Math.max(0, Math.min(1, -(xi * dx + yi * dy) / (dx * dx + dy * dy || 1)));
      closest = Math.min(closest, Math.hypot(xi + dx * t, yi + dy * t));
    }
    return inside || closest <= radius;
  };
  const elements = decodeBuildings(new Uint8Array(await response.arrayBuffer()), tile)
    .filter(({ ring }) => near(ring))
    .map(({ ring, renderHeight }) => ({
      geometry: ring.map(([x, y]) => ({ lon: x, lat: y })),
      // OpenMapTiles stores 5 m when a building has no mapped height or levels.
      tags: { building: 'yes', ...(renderHeight && renderHeight !== 5 ? { height: String(renderHeight) } : {}) }
    }));
  return { elements };
}
