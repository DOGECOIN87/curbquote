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
