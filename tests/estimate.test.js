import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateExterior, validateInput, DEFAULT_INPUT } from '../estimate.js';

const base = () => ({ ...DEFAULT_INPUT });
test('geometry and line item arithmetic reconcile exactly', () => {
  const result = estimateExterior(base());
  assert.equal(result.geometry.perimeterFt, 164);
  assert.equal(result.geometry.grossSqFt, 3156); // 164 * 18 + 2 * (34*6/2)
  assert.equal(result.geometry.masonrySqFt, 631.2);
  assert.equal(result.geometry.openingsSqFt, 222);
  assert.ok(Math.abs(result.geometry.sidingNetSqFt - 2302.8) < 1e-8);
  assert.ok(Math.abs(result.geometry.sidingOrderSqFt - 2533.08) < 1e-8);
  assert.equal(result.geometry.squares, 26);
  assert.deepEqual(result.items.windows, [3000, 7800]);
  assert.deepEqual(result.items.doors, [1200, 3000]);
  assert.equal(result.total[0], result.items.siding[0] + result.items.windows[0] + result.items.doors[0]);
  assert.equal(result.total[1], result.items.siding[1] + result.items.windows[1] + result.items.doors[1]);
});
test('all-masonry building does not produce negative siding', () => {
  const result = estimateExterior({ ...base(), masonryPercent: 100, replaceWindows: 0, replaceDoors: 0 });
  assert.equal(result.geometry.sidingOrderSqFt, 0);
  assert.deepEqual(result.total, [0, 0]);
});
test('missing values, negative counts, nonnumeric, inverted prices, nonintegers rejected', () => {
  assert.throws(() => validateInput({ ...base(), stories: '' }), /enter stories/i);
  assert.throws(() => validateInput({ ...base(), replaceWindows: -2 }), /replace Windows/i);
  assert.throws(() => validateInput({ ...base(), lengthFt: 'not a number' }), /length Ft/i);
  assert.throws(() => validateInput({ ...base(), replaceDoors: 1.5 }), /whole number/);
  assert.throws(() => validateInput({ ...base(), sidingLowPerSqFt: 20 }), /minimum price/);
  assert.throws(() => validateInput({ ...base(), replaceWindows: 25 }), /cannot exceed/);
  assert.throws(() => validateInput({ ...base(), replaceDoors: 5 }), /cannot exceed/);
});
test('original price inputs are immutable and all low values <= high values', () => {
  const input = base();
  const result = estimateExterior(input);
  assert.deepEqual(input, DEFAULT_INPUT);
  assert.ok(result.total[0] <= result.total[1]);
  for (const pair of Object.values(result.items)) assert.ok(pair[0] <= pair[1]);
});
test('pre-1978 home gets compliance advisory only', () => {
  assert.equal(estimateExterior({ ...base(), yearBuilt: 1977 }).leadPaintReview, true);
  assert.equal(estimateExterior({ ...base(), yearBuilt: 1978 }).leadPaintReview, false);
});
