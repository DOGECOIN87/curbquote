/**
 * Alco Products: offices, the communities it serves and the lines the app shows, from
 * alcoproductsinc.com (October 2026). The service check only informs: an estimate is never blocked.
 */
export const ALCO = Object.freeze({
  name: 'Alco Products',
  website: 'https://www.alcoproductsinc.com',
  terms: 'https://www.alcoproductsinc.com/terms',
  privacy: 'https://www.alcoproductsinc.com/privacy-policy',
  trust: 'Family-owned since 1956 · Limited lifetime labor warranty'
});
export const OFFICES = Object.freeze({
  bethesda: Object.freeze({ name: 'North Bethesda showroom', phone: '(301) 593-1691', tel: '3015931691', address: '4921 Wyaconda Road, North Bethesda, MD 20852' }),
  tysons: Object.freeze({ name: 'Tysons Corner office', phone: '(703) 534-3349', tel: '7035343349', address: '1750 Tysons Blvd, Ste 1500, Tysons Corner, VA 22102' })
});
// Communities named on alcoproductsinc.com/service-areas; all of Washington, DC is served.
const COMMUNITIES = Object.freeze({
  MD: ['Adelphi', 'Annapolis', 'Ashton', 'Bethesda', 'Burtonsville', 'Chevy Chase', 'Columbia', 'Ellicott City', 'Fort Washington', 'Gaithersburg', 'Germantown', 'Hyattsville', 'Kensington', 'North Bethesda', 'Olney', 'Potomac', 'Rockville', 'Silver Spring', 'Wheaton'],
  VA: ['Alexandria', 'Annandale', 'Arlington', 'Burke', 'Centreville', 'Dunn Loring', 'Fairfax', 'Falls Church', 'McLean', 'Oakton', 'Reston', 'Tysons', 'Tysons Corner', 'Vienna']
});
// ZIP prefixes around those communities: the DC suburbs of Maryland and Northern Virginia.
const METRO_ZIP3 = Object.freeze({ MD: ['206', '207', '208', '209', '210', '211', '212', '214'], VA: ['201', '220', '221', '222', '223'] });
const key = text => text.toLowerCase().replace(/[^a-z]/g, '');   // "MC LEAN" and "McLean" match.
const served = Object.fromEntries(Object.entries(COMMUNITIES).map(([state, names]) => [state, new Set(names.map(key))]));
const titleCase = text => text.toLowerCase().replace(/\bmc\s+(?=[a-z])/g, 'mc').replace(/\b[a-z]/g, letter => letter.toUpperCase()).replace(/\bMc([a-z])/g, (_, letter) => `Mc${letter.toUpperCase()}`);

/** City, state and ZIP from a matched address ("4600 SILVER HILL RD, WASHINGTON, DC, 20233" or "…, Bethesda, MD 20817, USA"). */
export function addressParts(address) {
  const parts = String(address || '').split(',').map(part => part.trim()).filter(part => part && !/^(usa|united states)$/i.test(part));
  for (let i = parts.length - 1; i > 0; i--) {
    const match = parts[i].match(/^([A-Za-z]{2})(?:\s+(\d{5})(?:-\d{4})?)?$/);
    if (!match) continue;
    const zip = match[2] || parts[i + 1]?.match(/^(\d{5})(?:-\d{4})?$/)?.[1] || null;
    return { city: titleCase(parts[i - 1]), state: match[1].toUpperCase(), zip };
  }
  return null;
}

/** The nearer office: Tysons Corner for Virginia, North Bethesda for everywhere else. */
export const officeFor = state => state === 'VA' ? OFFICES.tysons : OFFICES.bethesda;

/**
 * Whether Alco serves an address: 'served' (DC or a listed community), 'nearby' (a DC-area ZIP in Maryland
 * or Virginia that isn't listed, so call to confirm), 'outside', or 'unknown' when the address can't be read.
 */
export function serviceArea(address) {
  const parts = addressParts(address);
  if (!parts) return { status: 'unknown', office: OFFICES.bethesda, message: '' };
  const { city, state, zip } = parts, office = officeFor(state);
  let status = 'outside';
  if (state === 'DC' || served[state]?.has(key(city))) status = 'served';
  else if (METRO_ZIP3[state] && (!zip || METRO_ZIP3[state].includes(zip.slice(0, 3)))) status = 'nearby';
  const message = {
    served: `${ALCO.name} serves ${state === 'DC' ? 'Washington, DC' : city}. Questions? Call ${office.phone}.`,
    nearby: `${ALCO.name} serves much of the DC area. Call ${office.phone} to confirm ${city} is covered.`,
    outside: `This address looks outside ${ALCO.name}' service area (Washington, DC, the Maryland suburbs and Northern Virginia). You can still explore an estimate; call ${office.phone} to check.`
  }[status];
  return { status, city, state, zip, office, message };
}
