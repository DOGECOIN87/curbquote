import test from 'node:test';
import assert from 'node:assert/strict';
import { findMarker, paintSiding } from '../concept-recolour.js';

// One row of pixels: sunlit marker, shaded marker, a pink fringe, white trim, red brick, a pink flower, sky.
const pixels = [[255, 0, 255], [128, 10, 120], [250, 205, 250], [245, 245, 240], [160, 70, 60], [255, 105, 180], [110, 160, 230]];
const data = new Uint8ClampedArray(pixels.flatMap(p => [...p, 255]));

test('the magenta siding marker is found in sun and shade, and nothing else in the scene is', () => {
  const marker = findMarker(data, pixels.length);
  assert.deepEqual([...marker.alpha].map(a => a > 200), [true, true, false, false, false, false, false]);
  assert.equal(marker.reference, 255); assert.ok(Math.abs(marker.coverage - 2 / 7) < 1e-9);
});

test('siding repaints in any colour with its light kept; trim, brick, flowers and sky stay; the fringe loses its pink', () => {
  const marker = findMarker(data, pixels.length), sage = paintSiding(data, marker, '#829581'), px = (d, i) => [...d.slice(i * 4, i * 4 + 3)];
  assert.deepEqual(px(sage, 0), [0x82, 0x95, 0x81], 'sunlit siding is the chosen colour');
  assert.deepEqual(px(sage, 1), [65, 75, 65], 'shaded siding is the same colour at half the light');
  assert.deepEqual(px(sage, 2), [205, 205, 205], 'the fringe beside the siding is neutral');
  for (const i of [3, 4, 5, 6]) assert.deepEqual(px(sage, i), pixels[i]);
  const navy = paintSiding(data, marker, '#3e4f63');
  assert.deepEqual(px(navy, 0), [0x3e, 0x4f, 0x63], 'a second colour comes from the same marker, with no new image');
});
