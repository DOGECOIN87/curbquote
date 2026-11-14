/**
 * Where the company works and which office answers, from the skin in use. The service check only
 * informs: an estimate is never blocked.
 */
import { BRAND, possessive } from './brand.js';

export const COMPANY = BRAND.company;
export const OFFICES = BRAND.offices;
const AREA = BRAND.serviceArea ?? null;
const key = text => text.toLowerCase().replace(/[^a-z]/g, '');   // "MC LEAN" and "McLean" match.
const served = Object.fromEntries(Object.entries(AREA?.communities ?? {}).map(([state, names]) => [state, new Set(names.map(key))]));
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

/** The office for a state: the one that lists it, otherwise the first office. */
export const officeFor = state => OFFICES.find(office => office.states?.includes(state)) ?? OFFICES[0];

/**
 * Whether the company serves an address: 'served' (a state served everywhere, or a listed community),
 * 'nearby' (a ZIP around those communities that isn't listed, so call to confirm), 'outside', or
 * 'unknown' when the address can't be read or the skin names no service area.
 */
export function serviceArea(address) {
  const parts = AREA && addressParts(address);
  if (!parts) return { status: 'unknown', office: OFFICES[0], message: '' };
  const { city, state, zip } = parts, office = officeFor(state), name = COMPANY.name, everywhere = AREA.states?.[state];
  let status = 'outside';
  if (everywhere || served[state]?.has(key(city))) status = 'served';
  else if (AREA.nearbyZip3?.[state] && (!zip || AREA.nearbyZip3[state].includes(zip.slice(0, 3)))) status = 'nearby';
  const message = {
    served: `${name} serves ${everywhere || city}. Questions? Call ${office.phone}.`,
    nearby: `${name} serves much of ${AREA.region || 'the area'}. Call ${office.phone} to confirm ${city} is covered.`,
    outside: `This address looks outside ${possessive(name)} service area (${AREA.description}). You can still explore an estimate; call ${office.phone} to check.`
  }[status];
  return { status, city, state, zip, office, message };
}
