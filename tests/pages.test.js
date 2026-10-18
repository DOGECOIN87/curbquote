import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPagesSite, pagesPolicy } from '../scripts/build-pages.mjs';
import { parseCensusResult } from '../address.js';
import { SECURITY_HEADERS } from '../lib/web.mjs';

async function build(t, env) {
  const destination = await mkdtemp(join(tmpdir(), 'curbquote-pages-'));
  t.after(() => rm(destination, { recursive: true, force: true }));
  await buildPagesSite(destination, env);
  return destination;
}

test('the GitHub Pages build is static, relative and carries its security policy in meta tags', async t => {
  const site = await build(t, {});
  const html = await readFile(join(site, 'index.html'), 'utf8');
  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${pagesPolicy()}">`));
  assert.ok(html.includes('<meta name="referrer" content="strict-origin">'));
  // Project sites live under /<repo>/, so nothing may point at the domain root.
  assert.doesNotMatch(html, /(href|src)="\/(?!\/)/);
  assert.match(await readFile(join(site, 'config.js'), 'utf8'), /STATIC_SITE = true;[\s\S]*STATIC_MAP3D = \{"configured":false\}/);
  assert.ok((await stat(join(site, '.nojekyll'))).isFile());
  assert.ok((await stat(join(site, 'vendor/cesium/index.js'))).isFile());
});
test('the Pages policy only adds the Census JSONP endpoint and drops the header-only directive', () => {
  const policy = pagesPolicy(), server = SECURITY_HEADERS['Content-Security-Policy'];
  assert.match(policy, /script-src 'self' https:\/\/geocoding\.geo\.census\.gov\/geocoder\/locations\/onelineaddress 'wasm-unsafe-eval';/);
  assert.doesNotMatch(policy, /frame-ancestors|'unsafe-eval'|'unsafe-inline'/);
  assert.equal(policy.replace(' https://geocoding.geo.census.gov/geocoder/locations/onelineaddress', ''), server.replace("; frame-ancestors 'none'", ''));
});
test('a 3D credential set at build time ships in config.js, with a Google key taking precedence', async t => {
  const ionToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzeW50aGV0aWMiOnRydWV9.c3ludGhldGljLXNpZ25hdHVyZQ';
  assert.match(await readFile(join(await build(t, { CESIUM_ION_TOKEN: ionToken }), 'config.js'), 'utf8'), new RegExp(`"ionToken":"${ionToken}"`));
  const both = await readFile(join(await build(t, { CESIUM_ION_TOKEN: ionToken, GOOGLE_MAP_TILES_KEY: 'AIzaSyEXAMPLE-key_0123456789' }), 'config.js'), 'utf8');
  assert.match(both, /"key":"AIzaSyEXAMPLE-key_0123456789"/);
  assert.doesNotMatch(both, /ionToken/);
});
test('browser and server share one Census parser', () => {
  const payload = { result: { addressMatches: [{ matchedAddress: ' 4600 SILVER HILL RD, WASHINGTON, DC, 20233 ', coordinates: { x: -76.93, y: 38.85 } }] } };
  assert.deepEqual(parseCensusResult(payload), { matchedAddress: '4600 SILVER HILL RD, WASHINGTON, DC, 20233', coordinates: { lat: 38.85, lon: -76.93 }, source: 'U.S. Census Geocoder — address-range approximation' });
  assert.throws(() => parseCensusResult({ result: { addressMatches: [] } }), /No U.S. Census address match/);
  assert.throws(() => parseCensusResult({ result: { addressMatches: [{}, {}] } }), /Multiple address matches/);
  assert.throws(() => parseCensusResult({}), /invalid data/);
});
