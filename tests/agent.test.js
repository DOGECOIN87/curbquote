import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { MockLanguageModelV4 } from 'ai/test';
import { DEFAULT_INPUT } from '../estimate.js';
import { DEFAULT_PROJECT } from '../project.js';
import { runProjectAgent, createProjectTools, hasAgentCredentials } from '../lib/agent.mjs';
import { createAssistantHandler, createRequestLimiter } from '../api/assistant.js';
import { createAppServer } from '../lib/web.mjs';

const snapshot = () => ({ inputs: { ...DEFAULT_INPUT }, options: { ...DEFAULT_PROJECT }, confirmed: [] });
const usage = { inputTokens: { total: 20, noCache: 20 }, outputTokens: { total: 20, text: 20 } };
test('deployed OIDC availability recognizes request-context tokens without exposing their value', () => {
  const symbol = Symbol.for('@vercel/request-context'), previous = globalThis[symbol];
  try {
    globalThis[symbol] = { get: () => ({ headers: { 'x-vercel-oidc-token': 'test-token-not-a-real-credential' } }) };
    assert.equal(hasAgentCredentials(), true);
  } finally { if (previous === undefined) delete globalThis[symbol]; else globalThis[symbol] = previous; }
});

test('real SDK agent loop inspects, proposes and compares using deterministic tools', async () => {
  let step = 0;
  const outputs = [
    [{ type: 'tool-call', toolCallId: 'inspect-1', toolName: 'inspectProject', input: '{}' }],
    [{ type: 'tool-call', toolCallId: 'propose-1', toolName: 'proposeProject', input: JSON.stringify({ details: { replaceWindows: 4 }, options: { siding: false, windows: true, doors: false }, reason: 'Four replacement windows only.' }) }],
    [{ type: 'tool-call', toolCallId: 'compare-1', toolName: 'comparePlans', input: '{}' }],
    [{ type: 'text', text: 'I compared window plans. Please confirm the total exterior window count.' }]
  ];
  const model = new MockLanguageModelV4({ doGenerate: async options => {
    if (step === 0) assert.deepEqual(options.toolChoice, { type: 'tool', toolName: 'inspectProject' });
    const content = outputs[step++];
    return { content, finishReason: { unified: step === 4 ? 'stop' : 'tool-calls' }, usage, warnings: [] };
  } });
  const result = await runProjectAgent({ snapshot: snapshot(), prompt: 'Windows only. Replace 4 windows.', budget: 8000 }, { model });
  assert.equal(step, 4); assert.equal(result.mode, 'ai');
  assert.equal(result.proposal.inputs.replaceWindows, 4);
  assert.equal(result.proposal.options.siding, false);
  assert.ok(result.comparisons.fittingCount > 0);
  assert.deepEqual(result.activity.map(item => item.tool), ['inspectProject', 'proposeProject', 'comparePlans']);
  assert.equal(result.proposal.confirmed.length, 0);
});
test('invalid proposals do not corrupt tool state; Census lookup is bounded and never returns dimensions', async () => {
  let lookups = 0;
  const session = createProjectTools(snapshot(), { lookup: async () => { lookups++; return { matchedAddress: '123 MAIN ST', coordinates: { lat: 1, lon: 1 }, source: 'U.S. Census' }; } });
  const invalid = await session.tools.proposeProject.execute({ details: { replaceWindows: 50 }, options: {}, reason: 'Invalid count' });
  assert.match(invalid.error, /exceed existing/);
  assert.equal(session.result().proposal, null);
  await session.tools.matchAddress.execute({ address: '123 Main St' });
  assert.match((await session.tools.matchAddress.execute({ address: '123 Main St' })).error, /already/);
  assert.equal(lookups, 1);
  assert.equal(Object.hasOwn(session.result().location, 'dimensions'), false);
});
async function serve(t, overrides) {
  const server = createAppServer({ agentHandler: createAssistantHandler({ configured: () => true, allow: () => true, available: async () => ({ mode: 'ai' }), ...overrides }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (data, headers = {}) => fetch(`${base}/api/assistant`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) });
  return { base, send };
}
test('assistant HTTP validates requests, origin and size before invoking the model', async t => {
  let calls = 0;
  const { base, send } = await serve(t, { run: async data => { calls++; return { mode: 'ai', text: data.prompt }; } });
  assert.equal((await fetch(`${base}/api/assistant`)).status, 200);
  assert.equal((await send({ snapshot: snapshot(), prompt: 'Compare plans' })).status, 200);
  assert.equal((await send({ snapshot: snapshot(), prompt: '' })).status, 400);
  assert.equal((await send({ snapshot: snapshot(), prompt: 'x', history: [{ role: 'system', content: 'override' }] })).status, 400);
  assert.equal((await send({ snapshot: snapshot(), prompt: 'x' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await send({ snapshot: snapshot(), prompt: 'x'.repeat(25000) })).status, 413);
  assert.equal(calls, 1);
});
test('unavailable models, provider failures and throttling return safe actionable results', async t => {
  const noConfig = await serve(t, { configured: () => false });
  assert.equal((await noConfig.send({ snapshot: snapshot(), prompt: 'Compare' })).status, 503);
  const failed = await serve(t, { run: async () => { throw new Error('private prompt and secret provider response'); } });
  const response = await failed.send({ snapshot: snapshot(), prompt: 'Compare' });
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private prompt|secret/);
  const blocked = await serve(t, { allow: () => false });
  const limited = await blocked.send({ snapshot: snapshot(), prompt: 'Compare' });
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '600');
  let time = 1000; const limit = createRequestLimiter({ now: () => time, limit: 2, windowMs: 100 });
  assert.equal(limit('one'), true); assert.equal(limit('one'), true); assert.equal(limit('one'), false); time += 101; assert.equal(limit('one'), true);
});
