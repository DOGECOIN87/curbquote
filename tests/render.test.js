import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderHandler, DEFAULT_CHATGPT_IMAGE_MODEL } from '../api/render.js';

const call = async (handler, req) => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; await handler(req, res); return res; };
const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

test('chatgpt image route: off without AI, validated, rate-limited, prompt and optional image reach the model', async () => {
  assert.equal(DEFAULT_CHATGPT_IMAGE_MODEL, 'openai/gpt-image-1');
  assert.deepEqual((await call(createRenderHandler({ configured: () => false }), { method: 'GET' })).body, { available: false });
  assert.equal((await call(createRenderHandler({ configured: () => false }), { method: 'POST', body: JSON.stringify({ prompt: 'A photoreal render of a ranch home at dusk' }) })).code, 503);
  let sent = null;
  const handler = createRenderHandler({ configured: () => true, allow: () => true, model: 'test/image', generate: async request => { sent = request; return { images: [{ mediaType: 'image/png', base64: 'iVBORw0KGgo=' }] }; } });
  const generated = await call(handler, { method: 'POST', headers: {}, socket: {}, body: JSON.stringify({ prompt: 'A photoreal render of a ranch home at dusk' }) });
  assert.equal(generated.code, 200); assert.equal(generated.body.image, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(sent.model, 'test/image'); assert.equal(sent.image, null); assert.equal(sent.size, '1024x1024');
  const edited = await call(handler, { method: 'POST', headers: {}, socket: {}, body: JSON.stringify({ prompt: 'Same house with deep navy siding and a black metal roof', image: photo, size: '1536x1024' }) });
  assert.equal(edited.code, 200);
  assert.equal(sent.image.mediaType, 'image/jpeg'); assert.equal(sent.image.data, '/9j/4AAQSkZJRg=='); assert.equal(sent.size, '1536x1024');
  for (const bad of [
    { prompt: 'short' },
    { prompt: 'A perfectly fine prompt <script>alert(1)</script>' },
    { prompt: 'A perfectly fine prompt for a render', image: 'https://example.com/x.jpg' },
    { prompt: 'A perfectly fine prompt for a render', size: '4000x4000' },
    { prompt: 'A perfectly fine prompt for a render', extra: 1 }
  ]) assert.equal((await call(handler, { method: 'POST', body: JSON.stringify(bad) })).code, 400, JSON.stringify(bad));
  assert.equal((await call(createRenderHandler({ configured: () => true, allow: () => false }), { method: 'POST', headers: {}, socket: {}, body: JSON.stringify({ prompt: 'A photoreal render of a ranch home at dusk' }) })).code, 429);
  const failed = createRenderHandler({ configured: () => true, allow: () => true, generate: async () => ({ images: [] }) });
  assert.equal((await call(failed, { method: 'POST', headers: {}, socket: {}, body: JSON.stringify({ prompt: 'A photoreal render of a ranch home at dusk' }) })).code, 502);
});
