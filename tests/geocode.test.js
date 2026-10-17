import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAddress, validateAddress } from '../lib/geocode.mjs';

const address = '4600 Silver Hill Rd, Washington, DC 20233';
const ok = { ok: true, json: async () => ({ result: { addressMatches: [{ matchedAddress: '4600 SILVER HILL RD, WASHINGTON, DC, 20233', coordinates: { x: -76.9, y: 38.84 } }] } }) };
test('US Census address matching is requested with official endpoint', async () => {
  const result = await resolveAddress(address, async (url, options) => {
    assert.match(url, /^https:\/\/geocoding\.geo\.census\.gov\/geocoder\/locations\/onelineaddress\?/);
    assert.equal(new URL(url).searchParams.get('benchmark'), 'Public_AR_Current');
    assert.equal(new URL(url).searchParams.get('address'), address);
    assert.equal(options.headers.Accept, 'application/json');
    return ok;
  });
  assert.equal(result.matchedAddress, '4600 SILVER HILL RD, WASHINGTON, DC, 20233');
  assert.deepEqual(result.coordinates, { lat: 38.84, lon: -76.9 });
});
test('rejects invalid addresses and provider no-match', async () => {
  assert.throws(() => validateAddress(''), /Enter/);
  assert.throws(() => validateAddress('123'), /Enter/);
  assert.throws(() => validateAddress('<script>alert(1)</script>'), /Enter/);
  await assert.rejects(resolveAddress(address, async () => ({ ok: true, json: async () => ({ result: { addressMatches: [] } }) })), /No U.S. Census address match/);
  await assert.rejects(resolveAddress(address, async () => ({ ok: true, json: async () => ({ result: { addressMatches: [1, 2] } }) })), /Multiple address matches/);
  await assert.rejects(resolveAddress(address, async () => ({ ok: false })), /service returned an error/);
  await assert.rejects(resolveAddress(address, async () => { throw new Error('timeout'); }), /unavailable/);
});
