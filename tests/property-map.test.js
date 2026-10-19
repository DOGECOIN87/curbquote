import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { MAPLIBRE_FILES, createAppServer, isMapLibreFile } from '../lib/web.mjs';
import { buildingHighlight, emptySelection, propertyMapStyle, MAP_DATA_URL } from '../map-style.js';

const location = { coordinates: { lat: 30.2, lon: -97.7 } };
test('map uses public fixed sources and a separate approximate address point', () => {
  const style = propertyMapStyle(location);
  assert.equal(style.sources.openmaptiles.url, MAP_DATA_URL);
  assert.match(style.sources.naip.tiles[0], /bbox=\{bbox-epsg-3857\}/);
  assert.deepEqual(style.sources.address.data.geometry.coordinates, [-97.7, 30.2]);
  assert.deepEqual(style.sources.selected.data, emptySelection());
  assert.ok(style.layers.some(layer => layer['source-layer'] === 'building'));
  assert.equal(propertyMapStyle({ coordinates: { lat: 61.2, lon: -149.9 } }).sources.naip, undefined);
});
test('building highlights keep only transient bounded polygons, never provider facts', () => {
  const feature = { type: 'Feature', properties: { name: '<script>bad</script>', owner: 'not allowed', height: 42 }, geometry: { type: 'Polygon', coordinates: [[[-97.7, 30.2], [-97.6999, 30.2], [-97.6999, 30.2001], [-97.7, 30.2]]] } };
  const selected = buildingHighlight(feature);
  assert.deepEqual(selected.properties, {}); assert.deepEqual(selected.geometry, feature.geometry);
  selected.geometry.coordinates[0][0][0] = 0; assert.equal(feature.geometry.coordinates[0][0][0], -97.7);
  for (const geometry of [null, { type: 'Point', coordinates: [0, 0] }, { type: 'Polygon', coordinates: [] }, { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [2, 0], [3, 0]]] }, { type: 'Polygon', coordinates: [[[0, 0], [200, 0], [1, 0], [0, 0]]] }, { type: 'Polygon', coordinates: [Array.from({ length: 5001 }, () => [0, 0])] }]) assert.equal(buildingHighlight({ geometry }), null);
});
test('only the pinned MapLibre runtime and its license are public, including ES module content types', async t => {
  const server = createAppServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/vendor/maplibre/`;
  for (const file of MAPLIBRE_FILES) {
    assert.equal(isMapLibreFile(file), true); const response = await fetch(base + file); assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), file.endsWith('.mjs') ? /javascript/ : file.endsWith('.css') ? /text\/css/ : /text\/plain/);
  }
  for (const file of ['maplibre-gl-dev.mjs', 'maplibre-gl.mjs.map', 'src/index.ts', '../package.json']) { assert.equal(isMapLibreFile(file), false); assert.equal((await fetch(base + file)).status, 404); }
});
