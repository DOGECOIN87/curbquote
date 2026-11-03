import test from 'node:test';
import assert from 'node:assert/strict';
import { COLOR_LOOKS, createVisualizeHandler, designChanges, restylePrompt } from '../api/visualize.js';
import { COLORS } from '../project.js';
import { ROOF_COLORS, TRIM_COLORS } from '../house-spec.js';
import { ChainError, editPhoto, imageSize, modelChain, usableImage } from '../lib/image-ai.mjs';

const call = async (handler, req) => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; await handler(req, res); return res; };
// Real headers: a 1280 x 853 PNG and a 640 x 480 baseline JPEG (SOF0 after an APP0 segment).
const png = (w, h) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const jpeg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
const photo = `data:image/jpeg;base64,${jpeg(1280, 853).toString('base64')}`;
const design = { siding: { product: 'fiber', color: 'navy' }, roof: { color: 'onyx' }, trim: 'white', windows: { product: 'fiberglass' }, door: { product: 'steel' }, gutters: true };
const file = (w, h) => ({ mediaType: 'image/png', base64: png(w, h).toString('base64') });

test('image headers: PNG, JPEG (after APP segments) and WebP sizes; anything else is null', () => {
  assert.deepEqual(imageSize(png(1280, 853)), { width: 1280, height: 853 });
  assert.deepEqual(imageSize(jpeg(640, 480)), { width: 640, height: 480 });
  const webp = Buffer.alloc(32); webp.write('RIFF', 0); webp.write('WEBP', 8); webp.write('VP8X', 12); webp.writeUIntLE(1279, 24, 3); webp.writeUIntLE(852, 27, 3);
  assert.deepEqual(imageSize(webp), { width: 1280, height: 853 });
  assert.equal(imageSize(Buffer.from('not an image')), null);
});

test('photo concepts: every Alco choice becomes one plain instruction, built from the catalog', () => {
  const lines = designChanges(design);
  assert.equal(lines.length, 6);
  assert.match(lines[0], /James Hardie fiber cement lap siding in deep navy, a deep navy blue \(#3e4f63\)\. The new colour must be clearly visible.*Leave any brick/);
  assert.match(lines[1], /CertainTeed architectural asphalt shingles in onyx black, black \(#2a2c2f\)/);
  assert.match(lines[2], /trim classic white, bright white/);
  // Every catalog colour has a plain description, so a new colour cannot reach the model as a bare name.
  assert.deepEqual(Object.keys(COLOR_LOOKS.siding).sort(), Object.keys(COLORS).sort());
  assert.deepEqual(Object.keys(COLOR_LOOKS.roof).sort(), Object.keys(ROOF_COLORS).sort());
  assert.deepEqual(Object.keys(COLOR_LOOKS.trim).sort(), Object.keys(TRIM_COLORS).filter(key => TRIM_COLORS[key].hex).sort()); assert.match(lines[3], /Marvin fiberglass windows .* white frames/);
  assert.match(lines[4], /ProVia steel door with a deep teal/); assert.match(lines[5], /seamless gutters .* in classic white/);
  // Only what the homeowner chose changes; the rest of the photo is kept.
  const sidingOnly = restylePrompt({ siding: { product: 'vinyl', color: 'sage' } });
  assert.match(sidingOnly, /CertainTeed vinyl lap siding in sage, a soft grey-green/); assert.doesNotMatch(sidingOnly, /Roof:|Trim:|Windows:|Gutters:/); assert.match(sidingOnly, /Keep everything else exactly as it is/);
  assert.match(designChanges({ siding: 'Vinyl lap siding', color: 'Sage' })[0], /sage vinyl lap siding/, 'the older page format still reads');
  // With the marker, the siding is painted magenta for the page to recolour; the other choices are unchanged.
  const marked = designChanges(design, { marker: true });
  assert.match(marked[0], /lap siding painted a flat, vivid magenta \(#ff00ff\).*nowhere else in the photo/); assert.doesNotMatch(marked[0], /navy/);
  assert.deepEqual(marked.slice(1), lines.slice(1));
});

test('photo concepts: off without AI, validated, rate-limited, and only the homeowner photo goes to the models', async () => {
  assert.deepEqual((await call(createVisualizeHandler({ configured: () => false }), { method: 'GET' })).body, { available: false });
  assert.equal((await call(createVisualizeHandler({ configured: () => false }), { method: 'POST', body: JSON.stringify({ image: photo, design }) })).code, 503);
  let sent = null;
  const handler = createVisualizeHandler({ configured: () => true, allow: () => true, models: ['test/a', 'test/b'], edit: async request => { sent = request; return { mediaType: 'image/png', base64: 'iVBORw0KGgo=', model: 'test/a' }; } });
  const ok = await call(handler, { method: 'POST', headers: {}, socket: {}, body: JSON.stringify({ image: photo, design }) });
  assert.equal(ok.code, 200); assert.equal(ok.body.image, 'data:image/png;base64,iVBORw0KGgo=');
  assert.deepEqual(sent.models, ['test/a', 'test/b']); assert.equal(sent.image.mediaType, 'image/jpeg'); assert.deepEqual(sent.image.size, { width: 1280, height: 853 });
  assert.match(sent.prompt, /deep navy[\s\S]*onyx black[\s\S]*Keep everything else/);
  const markedReply = await call(handler, { method: 'POST', headers: {}, socket: {}, body: JSON.stringify({ image: photo, design, marker: true }) });
  assert.equal(markedReply.body.marker, '#ff00ff'); assert.match(sent.prompt, /vivid magenta/);
  const sidingOff = await call(handler, { method: 'POST', headers: {}, socket: {}, body: JSON.stringify({ image: photo, design: { roof: { color: 'onyx' } }, marker: true }) });
  assert.equal(sidingOff.body.marker, undefined, 'no siding change, no marker'); assert.doesNotMatch(sent.prompt, /magenta/);
  assert.equal((await call(handler, { method: 'POST', headers: {}, socket: {}, body: JSON.stringify({ image: photo, design: { roof: { color: 'onyx' } }, marker: false }) })).code, 200, 'marker: false is fine');
  for (const bad of [{ image: photo, design, marker: 'yes' }, { image: 'https://example.com/x.jpg', design }, { image: photo, design: { ...design, trim: '<script>' } }, { image: photo, design: { siding: { product: 'brick', color: 'sage' } } }, { image: photo, design: {} }, { image: photo, design, extra: 1 }, { image: 'data:image/jpeg;base64,AAAA', design }])
    assert.equal((await call(handler, { method: 'POST', body: JSON.stringify(bad) })).code, 400, JSON.stringify(bad).slice(0, 80));
  assert.equal((await call(createVisualizeHandler({ configured: () => true, allow: () => false }), { method: 'POST', headers: {}, socket: {}, body: JSON.stringify({ image: photo, design }) })).code, 429);
  const failed = createVisualizeHandler({ configured: () => true, allow: () => true, edit: async () => { throw new ChainError(['test/a: timed out']); } });
  assert.equal((await call(failed, { method: 'POST', headers: {}, socket: {}, body: JSON.stringify({ image: photo, design }) })).code, 502);
});

test('model chain: primary, fallback, then the primary again; a failed or unusable answer falls through', async () => {
  assert.deepEqual(modelChain('a', 'b'), ['a', 'b', 'a']); assert.deepEqual(modelChain('a', 'a'), ['a', 'a']); assert.deepEqual(modelChain('a'), ['a', 'a']);
  const image = { data: 'x', mediaType: 'image/jpeg', size: { width: 1280, height: 853 } }, calls = [], logs = [];
  // Gemini answers through generateText; other models through generateImage.
  const text = async ({ model }) => { calls.push(model); if (model === 'google/one') return { files: [file(1024, 1024)] }; throw Object.assign(new Error('x'), { statusCode: 503 }); };
  const picture = async ({ model, prompt, providerOptions }) => { calls.push(model); assert.deepEqual(prompt.images, ['x']); assert.equal(providerOptions.openai.outputFormat, 'jpeg', 'OpenAI images come back as JPEG'); return { images: [file(1536, 1024)] }; };
  const result = await editPhoto({ models: ['google/one', 'openai/two', 'google/one'], prompt: 'p', image, text, picture, log: line => logs.push(line) });
  assert.equal(result.model, 'openai/two', 'a square crop of a 3:2 photo is not shown'); assert.equal(result.attempts, 2); assert.deepEqual(calls, ['google/one', 'openai/two']);
  assert.match(logs[0], /google\/one: no usable image/);
  await assert.rejects(editPhoto({ models: ['google/x', 'google/x'], prompt: 'p', image, text, picture, log: () => {} }), error => error instanceof ChainError && error.tried.length === 2 && /503/.test(error.tried[0]));
  let clock = 0;
  await assert.rejects(editPhoto({ models: ['google/x', 'google/x', 'google/x'], prompt: 'p', image, budgetMs: 30000, now: () => clock, text: async () => { clock += 25000; throw new Error('slow'); }, picture, log: () => {} }), error => error.tried.length === 1, 'the chain stops before the function budget runs out');
  assert.equal(usableImage(file(200, 200), image.size), null); assert.equal(usableImage({ mediaType: 'text/html', base64: 'eA==' }), null);
  assert.equal(usableImage(file(1248, 832), image.size).width, 1248);
});
