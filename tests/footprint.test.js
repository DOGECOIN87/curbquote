import test from 'node:test';
import assert from 'node:assert/strict';
import {
  measurePolygonRing,
  parseOverpassFootprint,
  parseGeoJsonFootprint,
  buildOverpassQuery
} from '../footprint-client.js';
import {
  FootprintLookupError,
  footprintAvailability,
  resolveFootprint
} from '../lib/footprint.mjs';
import { createFootprintHandler } from '../api/footprint.js';
import { validateSavedProject } from '../storage.js';
import { DEFAULT_INPUT } from '../estimate.js';
import { DEFAULT_PROJECT } from '../project.js';

// ~18.29 m (60 ft) east-west by ~10.97 m (36 ft) north-south near Austin TX (30.2856, -97.7494) -> ~2,160 sq ft
const AUSTIN_CENTER = { lat: 30.2856, lon: -97.7494 };
const DEG_LAT_M = 1 / 111319.49;
const DEG_LON_M = 1 / (111319.49 * Math.cos(30.2856 * Math.PI / 180));
const HOUSE_RING = [
  [-97.7494 - 9.144 * DEG_LON_M, 30.2856 - 5.4864 * DEG_LAT_M],
  [-97.7494 + 9.144 * DEG_LON_M, 30.2856 - 5.4864 * DEG_LAT_M],
  [-97.7494 + 9.144 * DEG_LON_M, 30.2856 + 5.4864 * DEG_LAT_M],
  [-97.7494 - 9.144 * DEG_LON_M, 30.2856 + 5.4864 * DEG_LAT_M],
  [-97.7494 - 9.144 * DEG_LON_M, 30.2856 - 5.4864 * DEG_LAT_M]
];

test('measurePolygonRing computes accurate sq ft area, perimeter and rectangle bounds', () => {
  const measured = measurePolygonRing(HOUSE_RING);
  assert.ok(measured);
  assert.ok(Math.abs(measured.lengthFt - 60) < 0.6, `got ${measured.lengthFt}`);
  assert.ok(Math.abs(measured.widthFt - 36) < 0.6, `got ${measured.widthFt}`);
  assert.ok(Math.abs(measured.areaSqFt - 2160) < 25, `got ${measured.areaSqFt}`);
  assert.ok(Math.abs(measured.perimeterFt - 192) < 2, `got ${measured.perimeterFt}`);
});

test('parseOverpassFootprint prefers main building containing address over detached garage', () => {
  const garageRing = HOUSE_RING.map(([lon, lat]) => [lon * 1 + 0.00022, lat]);
  const overpass = {
    elements: [
      {
        type: 'way',
        tags: { building: 'garage' },
        geometry: garageRing.map(([lon, lat]) => ({ lon, lat }))
      },
      {
        type: 'way',
        tags: { building: 'house', 'building:levels': '2', height: '7.5', 'building:architecture': 'craftsman' },
        geometry: HOUSE_RING.map(([lon, lat]) => ({ lon, lat }))
      }
    ]
  };
  const parsed = parseOverpassFootprint(overpass, AUSTIN_CENTER);
  assert.equal(parsed.stories, 2);
  assert.equal(parsed.suggestedStyle, 'craftsman-bungalow');
  assert.ok(Math.abs(parsed.areaSqFt - 2160) < 25);
});

test('resolveFootprint enforces consent and contiguous U.S. bounds', async () => {
  await assert.rejects(
    () => resolveFootprint({ coordinates: AUSTIN_CENTER, consented: false }, { env: {} }),
    err => err instanceof FootprintLookupError && err.status === 403 && err.code === 'FOOTPRINT_CONSENT_REQUIRED'
  );
  // Honolulu HI is outside contiguous U.S. coverage
  await assert.rejects(
    () => resolveFootprint({ coordinates: { lat: 21.3069, lon: -157.8583 }, consented: true }, { env: {} }),
    err => err instanceof FootprintLookupError && err.status === 422 && err.code === 'OUT_OF_COVERAGE'
  );
  assert.throws(() => buildOverpassQuery({ lat: 61.2181, lon: -149.9003 }), RangeError);
});

test('resolveFootprint walks EarthDefine -> EagleView -> ATTOM -> Microsoft ODbL -> Overpass cleanly', async () => {
  const calls = [];
  const licensedResult = await resolveFootprint(
    { address: '2310 San Gabriel St, Austin, TX 78705', coordinates: AUSTIN_CENTER, consented: true },
    {
      env: { DATA_USE_APPROVED: 'true', EARTHDEFINE_KEY: 'earthdefine-secret-key', EAGLEVIEW_KEY: 'eagleview-secret-key' },
      fetchJson: async url => {
        calls.push(url.hostname);
        if (url.hostname.includes('earthdefine')) throw new Error('upstream timeout');
        return {
          status: 200,
          payload: {
            footprint: {
              polygon: { type: 'Polygon', coordinates: [HOUSE_RING] },
              stories: 2,
              roofPitch: '7:12',
              architecture: 'colonial'
            }
          }
        };
      },
      fetchOverpass: async () => { throw new Error('should not hit Overpass when EagleView succeeded'); },
      now: Date.parse('2026-10-22T12:00:00Z')
    }
  );
  assert.deepEqual(calls, ['api.earthdefine.com', 'api.eagleview.com']);
  assert.equal(licensedResult.source.provider, 'EagleView Property Data');
  assert.equal(licensedResult.suggestedStyle, 'colonial-2story');

  // Commercial keys stay unused when DATA_USE_APPROVED !== 'true'; open ODbL still resolves.
  const openCalls = [];
  const openResult = await resolveFootprint(
    { coordinates: AUSTIN_CENTER, consented: true },
    {
      env: { DATA_USE_APPROVED: 'false', EARTHDEFINE_KEY: 'earthdefine-secret-key' },
      fetchJson: async url => { openCalls.push(url.hostname); return { status: 500, payload: null }; },
      fetchOverpass: async () => ({
        elements: [{ type: 'way', tags: { building: 'yes', 'building:levels': '1' }, geometry: HOUSE_RING.map(([lon, lat]) => ({ lon, lat })) }]
      }),
      now: Date.parse('2026-10-22T12:00:00Z')
    }
  );
  assert.deepEqual(openCalls, []);
  assert.equal(openResult.source.provider, 'OpenStreetMap / Overpass (ODbL)');
  assert.equal(footprintAvailability({ DATA_USE_APPROVED: 'true', EARTHDEFINE_KEY: 'earthdefine-key' }).configured, true);
  assert.equal(footprintAvailability({ DATA_USE_APPROVED: 'false', EARTHDEFINE_KEY: 'earthdefine-key' }).configured, false);
});

test('api/footprint enforces no-store headers, same-origin check and rate limits', async () => {
  const makeRes = () => {
    const headers = {};
    return {
      headers,
      statusCode: 200,
      payload: null,
      setHeader(k, v) { headers[k.toLowerCase()] = v; },
      status(code) { this.statusCode = code; return this; },
      json(data) { this.payload = data; return this; }
    };
  };
  let allowed = true;
  const handler = createFootprintHandler({
    available: () => ({ openFallback: true }),
    resolve: async () => ({ areaSqFt: 1800, lengthFt: 50, widthFt: 36, source: { provider: 'OpenStreetMap / Overpass (ODbL)' } }),
    allow: () => allowed
  });
  const getRes = makeRes();
  await handler({ method: 'GET', headers: {} }, getRes);
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.headers['cache-control'], 'no-store');

  const crossOrigin = makeRes();
  await handler({ method: 'POST', headers: { origin: 'https://evil.example', host: 'curbquote.example', 'content-type': 'application/json' }, body: '{}' }, crossOrigin);
  assert.equal(crossOrigin.statusCode, 403);

  const okRes = makeRes();
  await handler({
    method: 'POST',
    headers: { origin: 'https://curbquote.example', host: 'curbquote.example', 'content-type': 'application/json' },
    body: JSON.stringify({ coordinates: AUSTIN_CENTER, consented: true })
  }, okRes);
  assert.equal(okRes.statusCode, 200);
  assert.equal(okRes.headers['cache-control'], 'no-store');

  allowed = false;
  const limitedRes = makeRes();
  await handler({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ coordinates: AUSTIN_CENTER, consented: true })
  }, limitedRes);
  assert.equal(limitedRes.statusCode, 429);
});

test('parseGeoJsonFootprint and storage persistence preserve footprint metadata safely', () => {
  const geo = parseGeoJsonFootprint({
    type: 'Feature',
    properties: { num_floors: 2, architecture: 'foursquare' },
    geometry: { type: 'Polygon', coordinates: [HOUSE_RING] }
  });
  assert.equal(geo.suggestedStyle, 'foursquare');
  const saved = validateSavedProject({
    id: '12345678-aaaa-bbbb-cccc-1234567890ab',
    name: 'Austin Craftsman Test',
    address: '2310 San Gabriel St, Austin, TX 78705',
    updatedAt: '2026-10-22T12:00:00Z',
    inputs: DEFAULT_INPUT,
    options: { ...DEFAULT_PROJECT, homeStyle: 'craftsman-bungalow' },
    footprintData: { ...geo, source: { provider: 'Microsoft Global ML Building Footprints (ODbL)', license: 'ODbL-1.0', retrievedAt: '2026-10-22T12:00:00Z' } }
  });
  assert.equal(saved.options.homeStyle, 'craftsman-bungalow');
  assert.equal(saved.footprintData.source.approximate, true);
});

test('the automatic open-data lookup needs no confirmation, skips licensed providers and never sends the address', async () => {
  const licensedCalls = [], microsoftUrls = [];
  const result = await resolveFootprint(
    { address: '123 Example St, Austin, TX 78701', coordinates: AUSTIN_CENTER, consented: false, openOnly: true },
    {
      env: { DATA_USE_APPROVED: 'true', EARTHDEFINE_KEY: 'earthdefine-secret-key', MICROSOFT_FOOTPRINTS_URL: 'https://footprints.example/v1' },
      fetchJson: async url => { if (url.hostname === 'footprints.example') { microsoftUrls.push(url); return { status: 500, payload: null }; } licensedCalls.push(url.hostname); return { status: 200, payload: {} }; },
      propertyResolver: async () => { licensedCalls.push('property'); throw new Error('must not run'); },
      fetchOverpass: async () => ({ elements: [{ type: 'way', tags: { building: 'yes' }, geometry: HOUSE_RING.map(([lon, lat]) => ({ lon, lat })) }] }),
      now: Date.parse('2026-10-22T12:00:00Z')
    }
  );
  assert.deepEqual(licensedCalls, []);
  assert.equal(microsoftUrls.length, 1);
  assert.equal(microsoftUrls[0].searchParams.has('address'), false);
  assert.equal(result.source.provider, 'OpenStreetMap / Overpass (ODbL)');
  await assert.rejects(() => resolveFootprint({ coordinates: AUSTIN_CENTER, consented: false }, { env: {} }), error => error.code === 'FOOTPRINT_CONSENT_REQUIRED');
  const handler = createFootprintHandler({ resolve: async body => ({ received: body }), allow: () => true });
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
  await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ coordinates: AUSTIN_CENTER, consented: false, openOnly: true }) }, res);
  assert.equal(res.code, 200);
  assert.equal(res.data.received.openOnly, true);
});
