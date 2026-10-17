import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAddress, validateAddress } from '../lib/geocode.mjs';
import { AddressLookupError } from '../address.js';

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
  assert.throws(() => validateAddress('<script>alert(1)</script>'), /unsupported/);
  await assert.rejects(resolveAddress(address, async () => ({ ok: true, json: async () => ({ result: { addressMatches: [] } }) })), /No U.S. Census address match/);
  await assert.rejects(resolveAddress(address, async () => ({ ok: true, json: async () => ({ result: { addressMatches: [1, 2] } }) })), /Multiple address matches/);
  await assert.rejects(resolveAddress(address, async () => ({ ok: false })), /service returned an error/);
  await assert.rejects(resolveAddress(address, async () => { throw new Error('timeout'); }), /unavailable/);
});
test('normalizes spacing and accepts U.S. hyphenated and letter-suffix street numbers', () => {
  assert.equal(validateAddress('  4600   Silver Hill Rd, Washington, DC 20233  '), address);
  assert.equal(validateAddress('12-34 Main St, Queens, NY 11354'), '12-34 Main St, Queens, NY 11354');
  assert.equal(validateAddress('123B Main St, Austin, TX 78701'), '123B Main St, Austin, TX 78701');
  assert.throws(() => validateAddress('123 Main St\nAustin TX 78701'), /unsupported/);
});
test('malformed provider envelopes are upstream failures, not a no-match', async () => {
  for (const payload of [null, {}, { result: {} }, { result: { addressMatches: 'none' } }]) {
    await assert.rejects(resolveAddress(address, async () => ({ ok: true, json: async () => payload })),
      error => error.status === 502 && error.code === 'INVALID_PROVIDER_DATA');
  }
});
test('does not turn missing or blank coordinates into a valid location at zero', async () => {
  const invalid = [
    { matchedAddress: 'A valid address', coordinates: { x: null, y: '' } },
    { matchedAddress: 'A valid address', coordinates: { x: '-76.9', y: 38.8 } },
    { matchedAddress: 'A valid address', coordinates: { x: 181, y: 38.8 } },
    { matchedAddress: 'A valid address', coordinates: { x: -76, y: 91 } },
    { matchedAddress: 'A valid address', coordinates: { x: NaN, y: 38.8 } },
    { matchedAddress: '', coordinates: { x: -76, y: 38.8 } },
    { matchedAddress: '   ', coordinates: { x: -76, y: 38.8 } },
    null
  ];
  for (const match of invalid) {
    await assert.rejects(resolveAddress(address, async () => ({ ok: true,
      json: async () => ({ result: { addressMatches: [match] } }) })),
    error => error instanceof AddressLookupError && error.status === 502);
  }
});
test('timeouts and body failures retain appropriate retryable status codes', async () => {
  await assert.rejects(resolveAddress(address, async () => { throw new DOMException('Timed out', 'TimeoutError'); }),
    error => error.status === 504 && error.code === 'LOOKUP_TIMEOUT');
  await assert.rejects(resolveAddress(address, async () => ({ ok: true, json: async () => { throw new DOMException('Timed out', 'AbortError'); } })),
    error => error.status === 504);
  await assert.rejects(resolveAddress(address, async () => ({ ok: true, json: async () => { throw new SyntaxError('HTML'); } })),
    error => error.status === 502);
  await assert.rejects(resolveAddress(address, async () => ({ ok: false, status: 429 })), error => error.status === 503);
});
