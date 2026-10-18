import test from 'node:test';
import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { readPropertyConfig, resolveProperty, PropertyLookupError, nestedValue, authorizePropertyContext } from '../lib/property.mjs';
import { fetchPropertyJson, isPublicAddress } from '../lib/property-transport.mjs';
import { propertySuggestions, canImportProperty, validatePropertyContext, validatePropertyRecord } from '../property-data.js';
import { ingestOne } from '../scripts/property-ingest.mjs';
import { createPropertyHandler } from '../api/property.js';
import { createAppServer } from '../lib/web.mjs';
import { DEFAULT_INPUT } from '../estimate.js';
import { DEFAULT_PROJECT } from '../project.js';
import { validateSnapshot, buildContractorBrief } from '../planning.js';
import { validateSavedProject } from '../storage.js';
import { createProjectTools } from '../lib/agent.mjs';
import { propertyEnv, providerObject, propertyRecord } from '../qa/fixtures/property.mjs';

const address = '123 Test St, Austin, TX 78701';
const lookup = (env = propertyEnv(), payload = providerObject(), options = {}) => resolveProperty(address, { env, fetchJson: async () => ({ status: 200, payload }), ...options });

test('provider configuration requires approval, a usable grant and an exact HTTPS host allowlist', () => {
  for (const env of [propertyEnv({}, { DATA_USE_APPROVED: 'false' }), propertyEnv({ status: 'pending' }), propertyEnv({ status: 'suspended' }), propertyEnv({ may_display: false }), propertyEnv({ expires_at: '2020-01-01T00:00:00Z' }), propertyEnv({ effective_at: '2100-01-01T00:00:00Z' }), propertyEnv({}, { PROPERTY_LOOKUP_URL: 'http://api.example.com/{address}' }), propertyEnv({}, { PROPERTY_LOOKUP_URL: 'https://127.0.0.1/{address}', PROPERTY_ALLOWED_HOSTS: '127.0.0.1' }), propertyEnv({}, { PROPERTY_LOOKUP_URL: 'https://user:secret@api.example.com/{address}' }), propertyEnv({}, { PROPERTY_ALLOWED_HOSTS: 'other.example.com' }), propertyEnv({}, { PROPERTY_LOOKUP_URL: 'https://{address}/v1' }), propertyEnv({}, { PROPERTY_FIELD_MAP: '{"owner":"owner"}' }), propertyEnv({}, { PROPERTY_RESPONSE_PATH: '__proto__.constructor' })]) assert.throws(() => readPropertyConfig(env), error => error.code === 'PROPERTY_NOT_CONFIGURED');
  assert.equal(readPropertyConfig(propertyEnv()).provider, 'Synthetic test provider');
  assert.equal(nestedValue({ records: [{ year: 1965 }] }, 'records.0.year'), 1965);
  assert.equal(nestedValue({}, 'missing.year'), undefined);
});

test('normalization returns only permitted canonical facts, separate source dates and no inferred geometry', async () => {
  const result = await lookup();
  assert.equal(result.facts.stories, 1); assert.equal(result.facts.living_area_sqft, 1800);
  assert.equal(result.facts.owner_name, undefined); assert.equal(result.facts.estimated_windows, undefined);
  assert.equal(result.source.sourceUpdatedAt, '2025-12-01T00:00:00.000Z');
  assert.notEqual(result.source.sourceUpdatedAt, result.source.retrievedAt);
  assert.deepEqual(propertySuggestions(result), { stories: 1, yearBuilt: 1965 });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE FIELD|test-fixture-not-a-real-secret|api\.example\.com/);
  const sparse = await lookup(propertyEnv({ allowed_fields: ['stories'] }));
  assert.deepEqual(sparse.facts, { stories: 1 });
  assert.ok(sparse.warnings.some(value => value.includes('address')));
});

test('nested mappings normalize numeric strings and omit invalid values without leaking raw data', async () => {
  const env = propertyEnv({}, { PROPERTY_RESPONSE_PATH: 'data.records', PROPERTY_FIELD_MAP: JSON.stringify({ address: 'address.full', region: 'address.state', living_area_sqft: 'building.area', stories: 'building.levels', year_built: 'building.year', bedrooms: 'building.beds', bathrooms: 'building.baths' }) });
  const result = await lookup(env, { data: { records: [{ address: { full: '123 Test St', state: 'TX' }, building: { area: '1800', levels: '1', year: '1965', beds: true, baths: { unsafe: 'private' } } }] } });
  assert.equal(result.facts.living_area_sqft, 1800); assert.equal(result.facts.year_built, 1965);
  assert.equal(result.facts.bedrooms, undefined); assert.equal(result.facts.bathrooms, undefined);
  assert.equal(result.warnings.length, 3);
  assert.deepEqual(propertySuggestions(propertyRecord({ stories: 1.5, year_built: 1500 })), {});
});

test('no-match, ambiguous, invalid, out-of-coverage and timeout responses retain explicit safe outcomes', async () => {
  for (const [payload, code] of [[[], 'PROPERTY_NO_MATCH'], [[{}, {}], 'PROPERTY_AMBIGUOUS'], [null, 'INVALID_PROPERTY_RESPONSE'], [providerObject({ region: 'CA' }), 'PROPERTY_COVERAGE_DENIED']]) await assert.rejects(lookup(propertyEnv(), payload), error => error.code === code);
  for (const [status, code] of [[404, 'PROPERTY_NO_MATCH'], [302, 'PROVIDER_UNAVAILABLE'], [429, 'PROVIDER_UNAVAILABLE']]) await assert.rejects(lookup(propertyEnv(), {}, { fetchJson: async () => ({ status }) }), error => error.code === code);
  await assert.rejects(lookup(propertyEnv(), {}, { fetchJson: async () => { throw Object.assign(new Error('secret provider body'), { name: 'TimeoutError' }); } }), error => error.code === 'PROPERTY_TIMEOUT' && !error.message.includes('secret'));
});

test('restricted grants remain display-only and are denied before any AI provider request', async () => {
  for (const patch of [{ may_store: false }, { may_process_with_ai: false }, { may_export: false }, { retention_days: 7 }, { expires_at: '2100-01-01T00:00:00Z' }]) {
    const result = await lookup(propertyEnv(patch));
    assert.equal(canImportProperty(result.source), false);
    assert.throws(() => validatePropertyContext({ ...result, lookupAddress: address, appliedFields: ['stories'] }), /temporary display/);
    let calls = 0;
    await assert.rejects(lookup(propertyEnv(patch), providerObject(), { forAgent: true, fetchJson: async () => { calls++; return { status: 200, payload: providerObject() }; } }), error => error.code === 'PROPERTY_USE_DENIED');
    assert.equal(calls, 0);
  }
});
test('bounded retention derives expiration even if a client omits its timestamp; CLI export needs explicit compatible rights', async () => {
  const value = propertyRecord({}, { retentionDays: 1 });
  const result = validatePropertyRecord(value);
  assert.equal(Date.parse(result.source.expiresAt) - Date.parse(value.source.retrievedAt), 86400000);
  assert.throws(() => validatePropertyRecord(propertyRecord({}, { expiresAt: '2000-01-01T00:00:00Z' })), /expired/);
  for (const source of [{ permissions: { mayExport: false } }, { retentionDays: 1 }]) await assert.rejects(ingestOne(address, { resolve: async () => propertyRecord({}, source) }), /CLI export/);
  const exported = await ingestOne(address, { resolve: async () => propertyRecord() });
  assert.equal(exported.provider, 'Synthetic test provider'); assert.equal(exported.facts.stories, 1);
});

test('source facts and homeowner corrections survive save/export separately, while restricted context is rejected', () => {
  const context = { ...propertyRecord(), lookupAddress: address, appliedFields: ['stories', 'yearBuilt'], previousInputs: { stories: 2, yearBuilt: 1998 }, corrections: { stories: { value: 2, updatedAt: new Date().toISOString() } } };
  const project = validateSavedProject({ id: 'property-test-001', name: 'Property test', address, updatedAt: new Date().toISOString(), inputs: { ...DEFAULT_INPUT, stories: 2, yearBuilt: 1965 }, options: DEFAULT_PROJECT, propertyData: context });
  assert.equal(project.propertyData.facts.stories, 1); assert.equal(project.propertyData.corrections.stories.value, 2);
  assert.equal(project.propertyData.facts.living_area_sqft, undefined);
  const brief = buildContractorBrief({ inputs: project.inputs, options: project.options, propertyData: context });
  assert.match(brief, /source reported 1; homeowner correction 2/);
  assert.match(brief, /Living area.*were not converted/);
  const restricted = { ...context, source: { ...context.source, retentionDays: 1 } };
  assert.throws(() => validateSnapshot({ inputs: DEFAULT_INPUT, options: DEFAULT_PROJECT, propertyData: restricted }), /temporary display/);
  const windowProject = validateSavedProject({ ...project, inputs: { ...project.inputs, stories: 1 }, options: { ...DEFAULT_PROJECT, siding: false } });
  assert.equal(windowProject.inputs.stories, 1);
  assert.doesNotThrow(() => authorizePropertyContext(context, propertyEnv()));
  assert.throws(() => authorizePropertyContext(context, propertyEnv({ may_process_with_ai: false })), error => error.code === 'PROPERTY_USE_DENIED');
  assert.throws(() => authorizePropertyContext(context, propertyEnv({ allowed_fields: ['address'] })), error => error.code === 'PROPERTY_USE_DENIED');
  assert.throws(() => authorizePropertyContext(context, {}), error => error.code === 'PROPERTY_USE_DENIED');
});

test('agent property tool is bounded, requests the AI-safe audience and reports permission denial honestly', async () => {
  let calls = 0;
  const session = createProjectTools({ inputs: DEFAULT_INPUT, options: DEFAULT_PROJECT }, { propertyLookup: async (_address, options) => { calls++; assert.equal(options.forAgent, true); throw new PropertyLookupError('Grant restricts AI use.', 403, 'PROPERTY_USE_DENIED'); } });
  assert.match((await session.tools.lookupProperty.execute({ address })).error, /restricts AI/);
  assert.match((await session.tools.lookupProperty.execute({ address })).error, /already/);
  assert.equal(calls, 1); assert.equal(session.result().property, null);
});

async function serve(t, options = {}) {
  const server = createAppServer({ dataHandler: createPropertyHandler({ allow: () => true, available: () => ({ configured: true }), ...options }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, send: (body, headers = {}) => fetch(`${base}/api/property`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) };
}
test('property HTTP endpoint validates the purpose, origin, size and shape before any provider access', async t => {
  let calls = 0;
  const { base, send } = await serve(t, { resolve: async value => { calls++; assert.equal(value, address); return propertyRecord(); } });
  assert.equal((await fetch(`${base}/api/property`)).status, 200);
  const result = await send({ address, purpose: 'estimate' }); assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
  for (const body of [{ address, purpose: 'marketing' }, { address, url: 'https://evil.example/' }, { address: [] }]) assert.equal((await send(body)).status, 400);
  assert.equal((await send({ address }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await send({ address: 'x'.repeat(2500) })).status, 413); assert.equal(calls, 1);
});
test('property HTTP hides unexpected provider exceptions and propagates intentional safe errors', async t => {
  const failed = await serve(t, { resolve: async () => { throw new Error('private 123 Test St and provider key'); } });
  const response = await failed.send({ address }); assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /123 Test|key/);
  const denied = await serve(t, { resolve: async () => { throw new PropertyLookupError('Source outside coverage.', 403, 'PROPERTY_COVERAGE_DENIED'); } });
  assert.equal((await denied.send({ address })).status, 403);
  const limited = await serve(t, { allow: () => false }); assert.equal((await limited.send({ address })).status, 429);
});

test('HTTPS transport blocks private, local, mapped and documentation IPs', async () => {
  for (const value of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '169.254.169.254', '192.168.1.1', '0.0.0.0', '100.64.0.1', '198.18.0.1', '203.0.113.4', '::1', '::ffff:127.0.0.1', 'fc00::1', '2001:db8::1']) assert.equal(isPublicAddress(value), false, value);
  assert.equal(isPublicAddress('8.8.8.8'), true); assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  let requested = false;
  await assert.rejects(fetchPropertyJson(new URL('https://api.example.com/'), { signal: AbortSignal.timeout(1000), resolve: async () => [{ address: '127.0.0.1', family: 4 }], requestImpl: () => { requested = true; } }), /not public/);
  assert.equal(requested, false);
});
function transport({ status = 200, body = '{}', headers = {}, inspect = () => {} } = {}) {
  return (_url, options, callback) => {
    inspect(_url, options);
    const req = new EventEmitter(); req.end = () => {
      const response = Readable.from([Buffer.from(body)]);
      response.statusCode = status; response.headers = { 'content-type': 'application/json', ...headers };
      callback(response);
    };
    return req;
  };
}
test('HTTPS pins the verified public DNS result and does not follow redirects or forward credentials', async () => {
  let resolutions = 0, requests = 0;
  const result = await fetchPropertyJson(new URL('https://api.example.com/lookup'), { signal: AbortSignal.timeout(1000), apiKey: 'test-only-key', resolve: async () => { resolutions++; return [{ address: '8.8.8.8', family: 4 }]; }, requestImpl: transport({ status: 302, inspect: (url, options) => {
    requests++; assert.equal(url.hostname, 'api.example.com'); assert.equal(options.headers.Authorization, 'Bearer test-only-key');
    options.lookup('api.example.com', { all: true }, (_error, addresses) => assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]));
  } }) });
  assert.equal(result.status, 302); assert.equal(resolutions, 1); assert.equal(requests, 1);
});
test('HTTPS enforces JSON type, byte limits and a deadline that includes DNS', async () => {
  const base = { signal: AbortSignal.timeout(1000), resolve: async () => [{ address: '8.8.8.8', family: 4 }] };
  for (const options of [{ headers: { 'content-type': 'text/html' } }, { headers: { 'content-length': '2000000' } }, { headers: { 'content-encoding': 'gzip' } }, { body: 'broken' }, { body: ' '.repeat(100), maxBytes: 16 }]) await assert.rejects(fetchPropertyJson(new URL('https://api.example.com/'), { ...base, maxBytes: options.maxBytes, requestImpl: transport(options) }));
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('deadline')), 5);
  try { await assert.rejects(fetchPropertyJson(new URL('https://api.example.com/'), { signal: controller.signal, resolve: () => new Promise(() => {}) }), /deadline/); }
  finally { clearTimeout(timer); }
});
