import test from 'node:test';
import assert from 'node:assert/strict';
import { GeoJSONVT } from '@maplibre/geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import { decodeBuildings, nearbyBuildings, tileFor } from '../osm-tiles.js';
import { fromMapTiles } from '../footprint-client.js';
import { resolveFootprint } from '../lib/footprint.mjs';

const POINT = { lat: 29.45678, lon: -98.49152 };
const kx = 111320 * Math.cos(POINT.lat * Math.PI / 180), ky = 110540;
/** A rectangle `w` × `d` metres whose centre is `east`, `north` metres from the point. */
const rect = (east, north, w, d) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]].map(([x, y]) => [POINT.lon + (east + x) / kx, POINT.lat + (north + y) / ky]);
const building = (ring, properties = {}) => ({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [ring] } });
// A 14 × 12 m house 15 m north of the address point (mapped height 7.3 m), and a large building 90 m away.
const features = [building(rect(0, 15, 14, 12), { render_height: 7.3 }), building(rect(90, 0, 30, 20), { render_height: 5 })];
const tile = tileFor(POINT.lon, POINT.lat);
const encoded = Buffer.from(fromGeojsonVt({ building: new GeoJSONVT({ type: 'FeatureCollection', features }, { maxZoom: 14, tolerance: 0 }).getTile(tile.z, tile.x, tile.y) }, { version: 2 }));
const tiles = { ok: true, json: async () => ({ tiles: ['https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf'] }) };
const fetchImpl = async url => url.endsWith('/planet') ? tiles : { ok: true, arrayBuffer: async () => encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) };

test('building outlines and heights decode from a vector tile', () => {
  const decoded = decodeBuildings(encoded, tile);
  assert.equal(decoded.length, 2);
  const house = decoded.find(item => item.renderHeight === 7.3), corners = rect(0, 15, 14, 12);
  assert.ok(house, 'the mapped height survives');
  for (const [lon, lat] of corners) assert.ok(house.ring.some(([x, y]) => Math.abs(x - lon) * kx < .5 && Math.abs(y - lat) * ky < .5), 'each corner within half a metre');
});

test('only buildings near the point come back, measured like an Overpass answer', async () => {
  const payload = await nearbyBuildings(POINT, { fetchImpl });
  assert.equal(payload.elements.length, 1);
  assert.equal(payload.elements[0].tags.height, '7.3');
  const record = await fromMapTiles(POINT, 'colonial-2story', undefined, fetchImpl);
  assert.equal(record.source.provider, 'OpenStreetMap via OpenFreeMap (ODbL)');
  assert.ok(Math.abs(record.lengthFt - 14 * 3.28084) < 2.5 && Math.abs(record.widthFt - 12 * 3.28084) < 2.5, `${record.lengthFt} × ${record.widthFt}`);
  assert.equal(record.stories, 2);
  const nothing = { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
  assert.equal(await fromMapTiles(POINT, 'colonial-2story', undefined, async url => url.endsWith('/planet') ? tiles : nothing), null);
});

test('the server reads the same outlines from the map tiles when Overpass is down or answers nothing', async () => {
  const lookup = deps => resolveFootprint({ coordinates: POINT, openOnly: true }, { env: {}, fetchMapTiles: (point, options) => nearbyBuildings(point, { ...options, fetchImpl }), ...deps });
  const down = await lookup({ fetchOverpass: async () => { throw new Error('Overpass HTTP 429'); } });
  assert.equal(down.source.provider, 'OpenStreetMap via OpenFreeMap (ODbL)');
  const empty = await lookup({ fetchOverpass: async () => ({ elements: [], remark: 'runtime error: Query timed out' }) });
  assert.equal(empty.source.provider, 'OpenStreetMap via OpenFreeMap (ODbL)');
  await assert.rejects(lookup({ fetchOverpass: async () => { throw new Error('down'); }, fetchMapTiles: async () => { throw new Error('down'); } }), error => error.code === 'FOOTPRINT_UPSTREAM_UNAVAILABLE');
  await assert.rejects(lookup({ fetchOverpass: async () => ({ elements: [] }), fetchMapTiles: async () => ({ elements: [] }) }), error => error.code === 'FOOTPRINT_NO_MATCH');
});
