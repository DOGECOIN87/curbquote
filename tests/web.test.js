import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppServer, SECURITY_HEADERS, CACHE_RULES, cacheControl } from '../lib/web.mjs';
import { clientKey } from '../lib/rate-limit.mjs';
import { createGeocodeHandler } from '../api/geocode.js';
import { resolveAddress } from '../lib/geocode.mjs';
import { AddressLookupError } from '../address.js';
import { buildPublicAssets } from '../scripts/build.mjs';

async function withServer(t, options) {
  const server = createAppServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}
test('HTTP path invokes the deployed geocoder and returns only the location contract', async t => {
  const base = await withServer(t, { geocodeHandler: createGeocodeHandler(value => resolveAddress(value, async url => {
    assert.equal(new URL(url).searchParams.get('address'), '4600 Silver Hill Rd, Washington, DC 20233');
    return { ok: true, json: async () => ({ result: { addressMatches: [{ matchedAddress: '4600 SILVER HILL RD, WASHINGTON, DC, 20233', coordinates: { x: -76.9, y: 38.84 } }] } }) };
  })) });
  const response = await fetch(`${base}/api/geocode?${new URLSearchParams({ address: '4600 Silver Hill Rd, Washington, DC 20233' })}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  assert.deepEqual(result.coordinates, { lat: 38.84, lon: -76.9 });
  assert.equal(Object.keys(result).length, 3); // No dimensions or ownership claims.
});
test('duplicate addresses, missing queries and unsupported methods do not call the provider', async t => {
  let calls = 0;
  const base = await withServer(t, { geocodeHandler: createGeocodeHandler(async () => { calls++; }) });
  assert.equal((await fetch(`${base}/api/geocode?address=first&address=second`)).status, 400);
  assert.equal((await fetch(`${base}/api/geocode`)).status, 400);
  const post = await fetch(`${base}/api/geocode?address=x`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET');
  assert.equal(calls, 0);
});
test('known failures keep their HTTP status; unexpected exception messages are private', async t => {
  let failure;
  const base = await withServer(t, { geocodeHandler: createGeocodeHandler(async () => { throw failure; }) });
  for (const status of [400, 422, 502, 503, 504]) {
    failure = new AddressLookupError('Safe public error', status, 'TEST_ERROR');
    const response = await fetch(`${base}/api/geocode?address=123`);
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, 'TEST_ERROR');
  }
  failure = new Error('secret 123 private homeowner address');
  const response = await fetch(`${base}/api/geocode?address=123`);
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /secret|private homeowner/);
});
test('public build serves browser modules while keeping backend, research and private paths out', async t => {
  const destination = await mkdtemp(join(tmpdir(), 'curbquote-build-'));
  t.after(() => rm(destination, { recursive: true, force: true }));
  await buildPublicAssets(destination);
  const base = await withServer(t, { assetRoot: destination });
  for (const entry of await readdir(destination, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = entry.name, response = await fetch(`${base}/${file}`);
    assert.equal(response.status, 200, file);
    assert.match(response.headers.get('content-type'), /charset=utf-8/);
    const body = await response.text();
    // Every relative JS import used by the browser must be packaged too.
    for (const [, dependency] of body.matchAll(/from ['"]\.\/([^'"]+)['"]/g)) {
      assert.equal((await fetch(`${base}/${dependency}`)).status, 200, dependency);
    }
  }
  const cesium = await fetch(`${base}/vendor/cesium/index.js`);
  assert.equal(cesium.status, 200);
  assert.doesNotMatch(await cesium.text(), /\(0,eval\)/); // The build ships the CSP-patched bundle.
  assert.equal((await fetch(`${base}/vendor/cesium/ThirdParty/draco_decoder.wasm`)).headers.get('content-type'), 'application/wasm');
  for (const file of ['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css', 'LICENSE.txt']) assert.equal((await fetch(`${base}/vendor/maplibre/${file}`)).status, 200);
  for (const file of ['three.module.js', 'three.core.js', 'LICENSE.txt']) assert.equal((await fetch(`${base}/vendor/three/${file}`)).status, 200);
  assert.equal((await fetch(`${base}/vendor/three/three.webgpu.js`)).status, 404);
  for (const path of ['/lib/geocode.mjs', '/docs/01-data-sources.md', '/.env', '/.git/config', '/package.json', '/vendor/cesium/Cesium.js', '/node_modules/cesium/package.json']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  const html = await fetch(base);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) assert.equal(html.headers.get(key), value);
  assert.equal((await fetch(base, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
});

test('vercel.json security headers match lib/web.mjs byte-for-byte and /api/footprint uses no-store', async t => {
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const configured = Object.fromEntries(vercel.headers[0].headers.map(({ key, value }) => [key, value]));
  assert.deepEqual(configured, SECURITY_HEADERS);
  const base = await withServer(t, {
    dimensionsHandler: (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ openFallback: true });
    }
  });
  const res = await fetch(`${base}/api/footprint`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { openFallback: true });
});


test('vercel.json static cache rules and function budgets match the development server', async t => {
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const rules = vercel.headers.slice(1).map(({ source, headers }) => [source, Object.fromEntries(headers.map(({ key, value }) => [key, value]))['Cache-Control']]);
  assert.deepEqual(rules, CACHE_RULES.map(rule => [...rule]));
  for (const file of ['geocode', 'map3d', 'property', 'footprint', 'assistant']) assert.ok(vercel.functions[`api/${file}.js`].maxDuration <= 30, file);
  assert.ok(vercel.functions['api/assistant.js'].maxDuration * 1000 > 25000, 'the assistant budget covers its 25-second agent deadline');
  assert.equal(cacheControl('/assets/fonts/poppins-latin-400-normal.woff2'), 'public, max-age=31536000, immutable');
  assert.equal(cacheControl('/main.js'), 'no-cache');
  const base = await withServer(t);
  const fresh = await fetch(`${base}/vendor/three/three.module.js`, { headers: { 'Accept-Encoding': 'br' } });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.headers.get('content-encoding'), 'br');
  assert.match(fresh.headers.get('cache-control'), /max-age=604800/);
  assert.match(await fresh.text(), /REVISION/);
  const again = await fetch(`${base}/vendor/three/three.module.js`, { headers: { 'If-None-Match': fresh.headers.get('etag') } });
  assert.equal(again.status, 304);
  const page = await fetch(base, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(page.headers.get('content-encoding'), 'gzip');
  assert.equal(page.headers.get('cache-control'), 'no-cache');
  assert.equal(page.headers.get('permissions-policy'), SECURITY_HEADERS['Permissions-Policy']);
});

test('the geocoder has a per-caller request guard and caller keys never contain the address or IP', async t => {
  let calls = 0;
  const base = await withServer(t, { geocodeHandler: createGeocodeHandler(async () => { calls++; return {}; }, { allow: () => false }) });
  const limited = await fetch(`${base}/api/geocode?address=123`);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '600');
  assert.equal((await limited.json()).code, 'RATE_LIMIT');
  assert.equal(calls, 0);
  const forwarded = clientKey({ headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } });
  assert.equal(forwarded, clientKey({ headers: { 'x-real-ip': '203.0.113.9' } }));
  assert.notEqual(forwarded, clientKey({ headers: { 'x-forwarded-for': '198.51.100.4' } }));
  assert.doesNotMatch(forwarded, /203/);
});
