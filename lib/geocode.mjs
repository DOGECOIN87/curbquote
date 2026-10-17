import { AddressLookupError, isAddressMatch, validateAddress } from '../address.js';
export { validateAddress } from '../address.js';

export const LOOKUP_TIMEOUT_MS = 7000; // Leave time for JSON within the 10-second function budget.

export async function resolveAddress(value, fetchImpl = fetch) {
  const address = validateAddress(value);
  const query = new URLSearchParams({ address, benchmark: 'Public_AR_Current', format: 'json' });
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${query}`;
  const signal = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
  let payload;
  try {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal, redirect: 'error' });
    if (!response.ok) {
      throw new AddressLookupError('Address service returned an error. Continue with manual details.',
        response.status === 429 || response.status === 503 ? 503 : 502, 'PROVIDER_UNAVAILABLE');
    }
    try { payload = await response.json(); }
    catch (error) {
      if (signal.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError') throw error;
      throw new AddressLookupError('Address service returned invalid data. Continue with manual details.', 502, 'INVALID_PROVIDER_DATA');
    }
    signal.throwIfAborted();
  } catch (error) {
    if (error instanceof AddressLookupError) throw error;
    if (signal.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new AddressLookupError('Address lookup timed out. You can still estimate manually.', 504, 'LOOKUP_TIMEOUT');
    }
    throw new AddressLookupError('Address lookup is temporarily unavailable. You can still estimate manually.', 503, 'PROVIDER_UNAVAILABLE');
  }
  const matches = payload?.result?.addressMatches;
  if (!Array.isArray(matches)) throw new AddressLookupError('Address service returned invalid data.', 502, 'INVALID_PROVIDER_DATA');
  if (matches.length !== 1) {
    throw new AddressLookupError(matches.length ? 'Multiple address matches; please be more specific.' : 'No U.S. Census address match. Manual estimates still work.',
      422, matches.length ? 'AMBIGUOUS_ADDRESS' : 'NO_MATCH');
  }
  const match = matches[0];
  const result = {
    matchedAddress: match?.matchedAddress,
    coordinates: { lat: match?.coordinates?.y, lon: match?.coordinates?.x },
    source: 'U.S. Census Geocoder — address-range approximation'
  };
  if (!isAddressMatch(result)) throw new AddressLookupError('Address service returned incomplete location data.', 502, 'INVALID_PROVIDER_DATA');
  result.matchedAddress = result.matchedAddress.trim();
  return result;
}
