/** Shared input and response checks; an address match never supplies measurements. */
export class AddressLookupError extends Error {
  constructor(message, status = 400, code = 'INVALID_ADDRESS') {
    super(message); this.name = 'AddressLookupError'; this.status = status; this.code = code;
  }
}

export function validateAddress(value) {
  if (typeof value !== 'string') throw new AddressLookupError('Enter one U.S. street address.');
  if (/[<>\x00-\x1f\x7f]/.test(value)) throw new AddressLookupError('Address includes unsupported characters.');
  const address = value.trim().replace(/\s+/g, ' ');
  if (address.length < 10 || address.length > 120 || !/^\d{1,8}(?:-\d{1,8})?[a-z]?\s+\S/i.test(address)) {
    throw new AddressLookupError('Enter a street number and complete U.S. address (120 characters max).');
  }
  return address;
}

export function isAddressMatch(value) {
  return typeof value?.matchedAddress === 'string' && value.matchedAddress.trim().length > 0 &&
    value.matchedAddress.length <= 240 && !/[\x00-\x1f\x7f]/.test(value.matchedAddress) &&
    typeof value.coordinates?.lat === 'number' && Number.isFinite(value.coordinates.lat) &&
    typeof value.coordinates?.lon === 'number' && Number.isFinite(value.coordinates.lon) &&
    Math.abs(value.coordinates.lat) <= 90 && Math.abs(value.coordinates.lon) <= 180;
}

/** Wait for a ZIP code or state at the end, rather than searching every street-name fragment. */
export function isAutomaticAddressReady(value) {
  let address;
  try { address = validateAddress(value); } catch { return false; }
  return /\s\d{5}(?:-\d{4})?$/.test(address) || /\b(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|PR|VI|GU|AS|MP|Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|District of Columbia|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\.?$/i.test(address);
}
/** One Census address-range match, or a public error. Shared by the server route and the static demo. */
export function parseCensusResult(payload) {
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
