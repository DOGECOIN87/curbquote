/** Public, provider-neutral contract. Living area is never treated as wall geometry. */
export const PROPERTY_FIELDS = Object.freeze({
  address: ['Property address', 'text', 240], street: ['Street', 'text', 160], unit: ['Unit', 'text', 40], city: ['City', 'text', 100], region: ['State', 'text', 40], postal_code: ['ZIP code', 'text', 16],
  parcel_id: ['Parcel ID', 'text', 100], property_type: ['Property type', 'text', 100],
  living_area_sqft: ['Living area', 'number', 1, 10000000], lot_area_sqft: ['Lot area', 'number', 1, 100000000],
  bedrooms: ['Bedrooms', 'integer', 0, 100], bathrooms: ['Bathrooms', 'number', 0, 100], stories: ['Stories', 'number', 0.5, 200], year_built: ['Year built', 'integer', 1000, 2100],
  latitude: ['Latitude', 'number', -90, 90], longitude: ['Longitude', 'number', -180, 180]
});

export function canonicalValue(field, value) {
  const spec = PROPERTY_FIELDS[field];
  if (!spec || value === null || value === undefined || typeof value === 'boolean' || typeof value === 'object') return null;
  if (spec[1] === 'text') {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value).trim().replace(/\s+/g, ' ');
    return text && text.length <= spec[2] && !/[<>\x00-\x1f\x7f]/.test(text) ? text : null;
  }
  if (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= spec[2] && number <= spec[3] && (spec[1] !== 'integer' || Number.isInteger(number)) ? number : null;
}

export function canImportProperty(source) {
  // The existing app saves drafts and allows exports/AI. Bounded-retention or restricted grants remain display-only.
  return source?.permissions?.mayStore === true && source.permissions.mayDisplay === true && source.permissions.mayProcessWithAI === true && source.permissions.mayExport === true && source.retentionDays === null && source.expiresAt === null;
}
export function propertySuggestions(record) {
  const facts = record?.facts || {}, inputs = {};
  if (Number.isInteger(facts.stories) && facts.stories >= 1 && facts.stories <= 4) inputs.stories = facts.stories;
  if (Number.isInteger(facts.year_built) && facts.year_built >= 1700 && facts.year_built <= 2100) inputs.yearBuilt = facts.year_built;
  return inputs;
}
export function validatePropertyRecord(value) {
  const source = value?.source;
  if (!source || typeof source.provider !== 'string' || !source.provider.trim() || source.provider.length > 100 || /[<>\x00-\x1f\x7f]/.test(source.provider) || typeof source.retrievedAt !== 'string' || !Number.isFinite(Date.parse(source.retrievedAt)) || !value.facts || Array.isArray(value.facts) || typeof value.facts !== 'object') throw new Error('Property source data is invalid.');
  const facts = {};
  for (const [field, input] of Object.entries(value.facts)) { const normalized = canonicalValue(field, input); if (normalized !== null) facts[field] = normalized; }
  const date = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;
  const permissions = Object.fromEntries(['mayStore', 'mayDisplay', 'mayProcessWithAI', 'mayExport'].map(key => [key, source.permissions?.[key] === true]));
  if (!permissions.mayDisplay) throw new Error('This source does not permit display.');
  if (source.expiresAt !== null && !date(source.expiresAt)) throw new Error('Property source expiration is invalid.');
  const retentionDays = source.retentionDays;
  if (retentionDays !== null && (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 36500)) throw new Error('Property source retention is invalid.');
  const expiresAt = [source.expiresAt, retentionDays ? new Date(Date.parse(source.retrievedAt) + retentionDays * 86400000).toISOString() : null].filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b))[0] || null;
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) throw new Error('Property source data has expired. Request a fresh lookup.');
  return { facts, source: { provider: source.provider.trim(), retrievedAt: source.retrievedAt, sourceUpdatedAt: date(source.sourceUpdatedAt), expiresAt, retentionDays, permissions }, warnings: Array.isArray(value.warnings) ? value.warnings.filter(text => typeof text === 'string' && text.length <= 240).slice(0, 8) : [] };
}

/** Only facts compatible with existing browser persistence, exports and AI can become saved inputs. */
export function validatePropertyContext(value) {
  if (value === undefined || value === null) return undefined;
  const record = validatePropertyRecord(value);
  if (!canImportProperty(record.source)) throw new Error('This property source is restricted to temporary display.');
  if (typeof value.lookupAddress !== 'string' || value.lookupAddress.length > 120 || !value.lookupAddress.trim()) throw new Error('Property source address is invalid.');
  const suggestions = propertySuggestions(record), appliedFields = Array.isArray(value.appliedFields) ? [...new Set(value.appliedFields.filter(field => Object.hasOwn(suggestions, field)))] : [];
  const corrections = {};
  for (const field of appliedFields) {
    const c = value.corrections?.[field];
    if (c && Number.isInteger(c.value) && (field === 'stories' ? c.value >= 1 && c.value <= 4 : c.value >= 1700 && c.value <= 2100) && typeof c.updatedAt === 'string' && Number.isFinite(Date.parse(c.updatedAt))) corrections[field] = { value: c.value, updatedAt: c.updatedAt, actor: 'homeowner' };
  }
  // Minimize persistence to fields actually applied, retaining the original facts separately from corrections.
  const facts = {};
  if (appliedFields.includes('stories')) facts.stories = record.facts.stories;
  if (appliedFields.includes('yearBuilt')) facts.year_built = record.facts.year_built;
  const previousInputs = {};
  for (const field of appliedFields) { const n = value.previousInputs?.[field]; if (typeof n === 'number' && Number.isFinite(n) && (field === 'stories' ? Number.isInteger(n) && n >= 1 && n <= 4 : Number.isInteger(n) && n >= 1700 && n <= 2100)) previousInputs[field] = n; }
  return { source: record.source, facts, lookupAddress: value.lookupAddress.trim(), appliedFields, corrections, previousInputs };
}

export function propertySourceLines(context) {
  if (!context) return [];
  const p = validatePropertyContext(context), suggestions = propertySuggestions(p);
  const line = value => String(value).replace(/[\r\n\u2028\u2029]/g, ' ');
  return [`Property source: ${line(p.source.provider)}; retrieved ${p.source.retrievedAt}; source updated ${p.source.sourceUpdatedAt || 'not reported'}`,
    ...p.appliedFields.map(field => `${field === 'stories' ? 'Stories' : 'Year built'}: source reported ${suggestions[field]}${p.corrections[field] ? `; homeowner correction ${p.corrections[field].value} (${p.corrections[field].updatedAt})` : '; imported, not independently verified'}`),
    'Living area, lot size, bedrooms and bathrooms were not converted into exterior dimensions or opening counts.'];
}
