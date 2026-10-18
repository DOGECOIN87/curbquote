import { isIP } from 'node:net';
import { z } from 'zod';
import { validateAddress } from '../address.js';
import { PROPERTY_FIELDS, canonicalValue, canImportProperty, validatePropertyContext } from '../property-data.js';
import { fetchPropertyJson } from './property-transport.mjs';

export class PropertyLookupError extends Error {
  constructor(message, status = 503, code = 'PROVIDER_UNAVAILABLE') { super(message); this.name = 'PropertyLookupError'; this.status = status; this.code = code; }
}
const configError = () => new PropertyLookupError('Authorized property data is not configured. Census matching and manual estimating remain available.', 503, 'PROPERTY_NOT_CONFIGURED');
const date = z.string().datetime({ offset: true }).nullable().default(null);
const grantSchema = z.object({
  status: z.enum(['pending', 'approved', 'suspended', 'expired']), agreement_reference: z.string().trim().min(1).max(240),
  allowed_purposes: z.array(z.enum(['estimate'])).min(1), allowed_fields: z.array(z.enum(Object.keys(PROPERTY_FIELDS))).min(1),
  coverage_regions: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1),
  may_store: z.boolean().default(false), may_display: z.boolean().default(false), may_process_with_ai: z.boolean().default(false), may_export: z.boolean().default(false),
  retention_days: z.number().int().min(1).max(36500).nullable().default(null), effective_at: date, expires_at: date
}).strict();
const safePath = value => typeof value === 'string' && value.length <= 240 && (value === '' || value.split('.').every(part => /^[a-zA-Z0-9_-]+$/.test(part) && !['__proto__', 'prototype', 'constructor'].includes(part)));
export function nestedValue(value, path) {
  if (!safePath(path)) throw configError();
  for (const part of path ? path.split('.') : []) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

export function readPropertyConfig(env = process.env, now = Date.now()) {
  if (env.DATA_USE_APPROVED !== 'true') throw configError();
  try {
    const grant = grantSchema.parse(JSON.parse(env.PROPERTY_GRANT_JSON || 'null'));
    if (grant.status !== 'approved' || !grant.may_display || !grant.allowed_purposes.includes('estimate') || grant.effective_at && Date.parse(grant.effective_at) > now || grant.expires_at && Date.parse(grant.expires_at) <= now) throw configError();
    const template = env.PROPERTY_LOOKUP_URL;
    if (typeof template !== 'string' || (template.match(/\{address\}/g) || []).length !== 1) throw configError();
    const url = new URL(template.replace('{address}', 'curbquote-address'));
    const hosts = String(env.PROPERTY_ALLOWED_HOSTS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port && url.port !== '443' || isIP(url.hostname) || !hosts.includes(url.hostname) || url.hostname === 'localhost' || !url.hostname.includes('.') || !url.pathname.includes('curbquote-address') && !url.search.includes('curbquote-address')) throw configError();
    const provider = env.PROPERTY_PROVIDER_NAME;
    if (!provider || provider.length > 100 || /[<>\x00-\x1f\x7f]/.test(provider)) throw configError();
    const map = env.PROPERTY_FIELD_MAP ? JSON.parse(env.PROPERTY_FIELD_MAP) : Object.fromEntries(Object.keys(PROPERTY_FIELDS).map(key => [key, key]));
    if (!map || Array.isArray(map) || typeof map !== 'object' || Object.entries(map).some(([field, path]) => !Object.hasOwn(PROPERTY_FIELDS, field) || !safePath(path) || !path)) throw configError();
    const responsePath = env.PROPERTY_RESPONSE_PATH || '', updatedPath = env.PROPERTY_SOURCE_UPDATED_PATH || '';
    if (!safePath(responsePath) || !safePath(updatedPath)) throw configError();
    const apiKey = env.PROPERTY_API_KEY || '';
    if (/[\r\n]/.test(apiKey) || apiKey.length > 8000) throw configError();
    return { template, origin: url.origin, provider: provider.trim(), grant, map, responsePath, updatedPath, apiKey };
  } catch { throw configError(); }
}

export function propertyAvailability(env = process.env) {
  try { const config = readPropertyConfig(env); return { configured: true, provider: config.provider, reason: 'An authorized property source is configured. Returned facts require homeowner review.' }; }
  catch { return { configured: false, reason: 'No authorized property provider is configured. Census location matching and manual inputs are available.' }; }
}

export function authorizePropertyContext(value, env = process.env) {
  if (!value) return;
  try {
    const context = validatePropertyContext(value), config = readPropertyConfig(env), grant = config.grant;
    if (context.source.provider !== config.provider || !grant.may_store || !grant.may_process_with_ai || !grant.may_export || grant.retention_days !== null || grant.expires_at !== null || Object.keys(context.facts).some(field => !grant.allowed_fields.includes(field))) throw new Error('Restricted');
  } catch { throw new PropertyLookupError('The current property-source grant does not permit these saved facts in the AI assistant. Automatic planning remains available.', 403, 'PROPERTY_USE_DENIED'); }
}

export async function resolveProperty(value, { env = process.env, fetchJson = fetchPropertyJson, now = Date.now(), forAgent = false } = {}) {
  const address = validateAddress(value), config = readPropertyConfig(env, now), grant = config.grant;
  const permissions = { mayStore: grant.may_store, mayDisplay: grant.may_display, mayProcessWithAI: grant.may_process_with_ai, mayExport: grant.may_export };
  const expiresAt = [grant.expires_at, grant.retention_days ? new Date(now + grant.retention_days * 86400000).toISOString() : null].filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b))[0] || null;
  const source = { provider: config.provider, retrievedAt: new Date(now).toISOString(), sourceUpdatedAt: null, permissions, retentionDays: grant.retention_days, expiresAt };
  if (forAgent && !canImportProperty(source)) throw new PropertyLookupError('This property grant does not permit use in the assistant and saved estimate workflow.', 403, 'PROPERTY_USE_DENIED');
  const url = new URL(config.template.replace('{address}', encodeURIComponent(address)));
  if (url.origin !== config.origin) throw configError();
  const signal = AbortSignal.timeout(6500);
  let response;
  try { response = await fetchJson(url, { apiKey: config.apiKey, signal }); signal.throwIfAborted(); }
  catch (error) {
    if (signal.aborted || ['TimeoutError', 'AbortError'].includes(error?.name)) throw new PropertyLookupError('Property lookup timed out. Manual estimating is available.', 504, 'PROPERTY_TIMEOUT');
    throw new PropertyLookupError('The property provider could not return a usable response. Continue with manual details.', 502, 'INVALID_PROPERTY_RESPONSE');
  }
  if (response.status === 404) throw new PropertyLookupError('No property record was returned for this address.', 404, 'PROPERTY_NO_MATCH');
  if (response.status !== 200) throw new PropertyLookupError('The property provider is unavailable. Continue with manual details.', response.status === 429 ? 503 : 502, 'PROVIDER_UNAVAILABLE');
  let object = nestedValue(response.payload, config.responsePath);
  if (Array.isArray(object)) {
    if (!object.length) throw new PropertyLookupError('No property record was returned for this address.', 404, 'PROPERTY_NO_MATCH');
    if (object.length !== 1) throw new PropertyLookupError('Multiple property records were returned. Add the unit or a more complete address.', 409, 'PROPERTY_AMBIGUOUS');
    [object] = object;
  }
  if (!object || typeof object !== 'object' || Array.isArray(object)) throw new PropertyLookupError('Property data was incomplete. Continue with manual details.', 502, 'INVALID_PROPERTY_RESPONSE');
  // A regional grant must be checked against the record, not guessed from the entered string.
  const region = canonicalValue('region', nestedValue(object, config.map.region || 'region'));
  if (!grant.coverage_regions.includes('US') && (!region || !grant.coverage_regions.includes(region.toUpperCase()))) throw new PropertyLookupError('The returned property is outside the configured source coverage.', 403, 'PROPERTY_COVERAGE_DENIED');
  const facts = {}, warnings = [];
  for (const field of grant.allowed_fields) {
    if (!Object.hasOwn(config.map, field)) continue;
    const raw = nestedValue(object, config.map[field]), normalized = canonicalValue(field, raw);
    if (normalized !== null) facts[field] = normalized;
    else if (raw !== undefined && raw !== null && raw !== '') warnings.push(`The source supplied an unsupported ${PROPERTY_FIELDS[field][0].toLowerCase()} value; it was omitted.`);
  }
  if (!Object.keys(facts).length) throw new PropertyLookupError('No permitted usable property facts were returned.', 502, 'INVALID_PROPERTY_RESPONSE');
  if (config.updatedPath) {
    const updated = nestedValue(object, config.updatedPath);
    if (typeof updated === 'string' && Number.isFinite(Date.parse(updated)) && Date.parse(updated) <= now) source.sourceUpdatedAt = new Date(updated).toISOString();
  }
  if (!facts.address) warnings.push('The source did not provide a displayable address; its record cannot be applied to this estimate.');
  warnings.push('Living area and lot size do not measure exterior walls. Opening counts and dimensions remain homeowner inputs.');
  return { facts, source, warnings: warnings.slice(0, 8) };
}
