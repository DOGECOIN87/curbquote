import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeasurePhotoHandler } from '../api/measure-photo.js';
import { ChainError } from '../lib/image-ai.mjs';
import { READING_SCHEMA, measureReading, photoScale } from '../lib/photo-measure.mjs';

const call = async (handler, req) => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; await handler(req, res); return res; };
const jpeg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
const photo = `data:image/jpeg;base64,${jpeg(1200, 800).toString('base64')}`, size = { width: 1200, height: 800 };
// A two-story house seen straight on in a 1200 x 800 photo: the 80-inch door is 120 px tall
// (1/18 ft per px), so the 720 px wall is 40 ft long and its 324 px height is 18 ft (9 ft a story).
const reading = {
  houseExterior: true, view: 'straight-on', side: 'front', stories: 2, windows: 9, entryDoors: 1, garageDoors: 1, frontGables: 1,
  wall: { top: 400, left: 200, bottom: 805, right: 800 }, entryDoor: { top: 655, left: 480, bottom: 805, right: 525 },
  garageDoor: { top: 642.5, left: 600, bottom: 800, right: 750 }, gable: { top: 270, left: 300, bottom: 400, right: 700 },
  masonryPercent: 22, currentSiding: 'vinyl', roofShape: 'gable', confidence: 'high', note: 'Clear photo.'
};

test('photo measuring: the door sets the scale; a straight-on wall gives its length, height per story and gable rise', () => {
  assert.equal(READING_SCHEMA.safeParse(reading).success, true);
  assert.equal(photoScale(reading, size).by, 'front and garage doors');
  const m = measureReading(reading, size);
  assert.equal(m.wallFt, 40); assert.equal(m.storyHeightFt, 9); assert.equal(m.gableRiseFt, 6);
  assert.deepEqual([m.stories, m.windows, m.entryDoors, m.garageDoors, m.masonryPercent], [2, 9, 1, 1, 20]);
  assert.deepEqual(m.boxes.entryDoor, { top: .655, left: .48, bottom: .805, right: .525 });
});

test('photo measuring: sizes are left out when the photo cannot support them', () => {
  // At an angle the wall's length shrinks, so only heights are given.
  const angled = measureReading({ ...reading, view: 'angled' }, size);
  assert.equal(angled.wallFt, null); assert.equal(angled.storyHeightFt, 9);
  // No door, or a "door" with the shape of a window, gives no scale and no sizes; the counts stay.
  const noDoor = measureReading({ ...reading, entryDoor: null, garageDoor: null }, size);
  assert.deepEqual([noDoor.scale, noDoor.wallFt, noDoor.storyHeightFt, noDoor.windows], [null, null, null, 9]);
  assert.equal(photoScale({ ...reading, garageDoor: null, entryDoor: { top: 600, left: 400, bottom: 700, right: 520 } }, size), null);
  // A garage door that disagrees with the front door yields to it (garages often stand nearer the camera).
  assert.equal(photoScale({ ...reading, garageDoor: { top: 560, left: 560, bottom: 800, right: 800 } }, size).by, 'front door');
  // A gable only counts when it faces the camera, and impossible sizes are dropped rather than clamped into the estimate.
  assert.equal(measureReading({ ...reading, frontGables: 0 }, size).gableRiseFt, null);
  assert.equal(measureReading({ ...reading, stories: 1 }, size).storyHeightFt, null, '18 ft for one story is not a story height');
  assert.equal(measureReading({ ...reading, stories: 1.5 }, size).stories, 2);
});

test('photo measuring: real readings of Alco photos, with a dormer and a door set back behind the garage', () => {
  const photo = { width: 1200, height: 800 };
  // A two-story house seen from the back: the small gable is a dormer's, not the roof's, so no gable rise.
  const back = measureReading({ ...reading, side: 'back', windows: 7, garageDoors: 0, frontGables: 1, garageDoor: null,
    wall: { top: 250, left: 130, bottom: 775, right: 815 }, entryDoor: { top: 530, left: 358, bottom: 745, right: 420 }, gable: { top: 198, left: 218, bottom: 265, right: 305 } }, photo);
  assert.deepEqual([back.scale, back.wallFt, back.storyHeightFt, back.gableRiseFt], ['front door', 32, 8, null]);
  // A ranch whose front door stands behind the garage: the doors disagree, so the garage (a 9.8 ft story) sets
  // the height and the front's length is not read; the counts stay.
  const ranch = measureReading({ ...reading, stories: 1, windows: 3, garageDoors: 1, frontGables: 0, gable: null,
    wall: { top: 300, left: 58, bottom: 650, right: 920 }, entryDoor: { top: 415, left: 345, bottom: 560, right: 375 }, garageDoor: { top: 435, left: 445, bottom: 685, right: 825 } }, photo);
  assert.deepEqual([ranch.scale, ranch.wallFt, ranch.storyHeightFt, ranch.windows], ['garage door', null, 10, 3]);
});

test('photo measuring route: off without AI, validated, rate-limited, refuses non-houses, and fails gracefully', async () => {
  assert.deepEqual((await call(createMeasurePhotoHandler({ configured: () => false }), { method: 'GET' })).body, { available: false });
  assert.equal((await call(createMeasurePhotoHandler({ configured: () => false }), { method: 'POST', body: JSON.stringify({ image: photo }) })).code, 503);
  let sent = null;
  const handler = createMeasurePhotoHandler({ configured: () => true, allow: () => true, models: ['test/v'], read: async request => { sent = request; return { reading, model: 'test/v' }; } });
  const ok = await call(handler, { method: 'POST', headers: {}, socket: {}, body: JSON.stringify({ image: photo }) });
  assert.equal(ok.code, 200); assert.equal(ok.body.measured.wallFt, 40); assert.deepEqual(sent.models, ['test/v']); assert.ok(sent.output); assert.match(sent.prompt, /80|door/);
  for (const bad of [{ image: 'https://example.com/x.jpg' }, { image: photo, extra: 1 }, {}]) assert.equal((await call(handler, { method: 'POST', body: JSON.stringify(bad) })).code, 400);
  const notHouse = createMeasurePhotoHandler({ configured: () => true, allow: () => true, read: async () => ({ reading: { ...reading, houseExterior: false } }) });
  assert.equal((await call(notHouse, { method: 'POST', headers: {}, socket: {}, body: JSON.stringify({ image: photo }) })).code, 422);
  assert.equal((await call(createMeasurePhotoHandler({ configured: () => true, allow: () => false }), { method: 'POST', headers: {}, socket: {}, body: JSON.stringify({ image: photo }) })).code, 429);
  const failed = createMeasurePhotoHandler({ configured: () => true, allow: () => true, read: async () => { throw new ChainError([]); } });
  assert.equal((await call(failed, { method: 'POST', headers: {}, socket: {}, body: JSON.stringify({ image: photo }) })).code, 502);
});
