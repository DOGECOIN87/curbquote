/** US Census geocoder provides approximate address-range coordinates, NOT verified parcels. */
export function validateAddress(value) {
  if (typeof value !== 'string') throw new Error('Enter a U.S. street address.');
  const address = value.trim().replace(/\s+/g, ' ');
  if (address.length < 10 || address.length > 120 || !/^\d{1,8}\s+\S/.test(address)) {
    throw new Error('Enter a street number and complete U.S. address (120 characters max).');
  }
  if (/[<>\x00-\x1f]/.test(address)) throw new Error('Address includes unsupported characters.');
  return address;
}

export async function resolveAddress(value, fetchImpl = fetch) {
  const address = validateAddress(value);
  const query = new URLSearchParams({ address, benchmark: 'Public_AR_Current', format: 'json' });
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${query}`;
  let response;
  try {
    response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
  } catch {
    throw new Error('Address lookup is temporarily unavailable. You can still enter measurements manually.');
  }
  if (!response.ok) throw new Error('Address service returned an error. Continue with manual details.');
  let payload;
  try { payload = await response.json(); } catch { throw new Error('Address service returned invalid data.'); }
  const matches = payload?.result?.addressMatches;
  if (!Array.isArray(matches) || matches.length !== 1) {
    throw new Error(matches?.length ? 'Multiple address matches; please be more specific.' : 'No U.S. Census address match. Manual estimates still work.');
  }
  const match = matches[0];
  const x = Number(match?.coordinates?.x);
  const y = Number(match?.coordinates?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -180 || x > 180 || y < -90 || y > 90 || typeof match.matchedAddress !== 'string') {
    throw new Error('Address service returned incomplete location data.');
  }
  return { matchedAddress: match.matchedAddress, coordinates: { lat: y, lon: x }, source: 'U.S. Census Geocoder — address-range approximation' };
}
