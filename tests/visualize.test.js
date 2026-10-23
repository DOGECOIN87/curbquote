import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisualizeHandler, restylePrompt } from '../api/visualize.js';

const call = async (handler, req) => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; await handler(req, res); return res; };
const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const design = { siding: 'Fiber cement', color: 'Deep navy', trim: 'Classic white', roof: 'Onyx black Standing-seam metal' };

test('photo concepts: off without AI, validated, rate-limited, and only the homeowner photo goes to the model', async () => {
  assert.deepEqual((await call(createVisualizeHandler({ configured: () => false }), { method: 'GET' })).body, { available: false });
  assert.equal((await call(createVisualizeHandler({ configured: () => false }), { method: 'POST', body: JSON.stringify({ image: photo, design }) })).code, 503);
  let sent = null;
  const handler = createVisualizeHandler({ configured: () => true, allow: () => true, model: 'test/image', generate: async request => { sent = request; return { files: [{ mediaType: 'image/png', base64: 'iVBORw0KGgo=' }] }; } });
  const ok = await call(handler, { method: 'POST', headers: {}, socket: {}, body: JSON.stringify({ image: photo, design }) });
  assert.equal(ok.code, 200); assert.equal(ok.body.image, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(sent.model, 'test/image'); assert.equal(sent.messages[0].content[1].image, '/9j/4AAQSkZJRg=='); assert.equal(sent.messages[0].content[1].mediaType, 'image/jpeg');
  assert.match(sent.messages[0].content[0].text, /deep navy fiber cement.*classic white.*onyx black standing-seam metal.*Keep everything else/);
  for (const bad of [{ image: 'https://example.com/x.jpg', design }, { image: photo, design: { ...design, color: '<script>' } }, { image: photo, design, extra: 1 }])
    assert.equal((await call(handler, { method: 'POST', body: JSON.stringify(bad) })).code, 400);
  assert.equal((await call(createVisualizeHandler({ configured: () => true, allow: () => false }), { method: 'POST', headers: {}, socket: {}, body: JSON.stringify({ image: photo, design }) })).code, 429);
  const failed = createVisualizeHandler({ configured: () => true, allow: () => true, generate: async () => ({ files: [] }) });
  assert.equal((await call(failed, { method: 'POST', headers: {}, socket: {}, body: JSON.stringify({ image: photo, design }) })).code, 502);
  assert.doesNotMatch(restylePrompt({ siding: 'Vinyl lap siding', color: 'Sage' }), /trim|roof to/);
});
