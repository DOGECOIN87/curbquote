import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateExterior, validateInput, DEFAULT_INPUT, InputError } from '../estimate.js';

const base = () => ({ ...DEFAULT_INPUT });
test('geometry and line item arithmetic reconcile exactly', () => {
  const result = estimateExterior(base());
  assert.equal(result.geometry.perimeterFt, 164);
  assert.equal(result.geometry.grossSqFt, 3156); // 164 * 18 + 2 * (34*6/2)
  assert.equal(result.geometry.solidWallsSqFt, 2934);
  assert.equal(result.geometry.masonrySqFt, 586.8);
  assert.equal(result.geometry.openingsSqFt, 222);
  assert.ok(Math.abs(result.geometry.sidingNetSqFt - 2347.2) < 1e-8);
  assert.ok(Math.abs(result.geometry.sidingOrderSqFt - 2581.92) < 1e-8);
  assert.equal(result.geometry.squares, 26);
  assert.deepEqual(result.items.windows, [3000, 7800]);
  assert.deepEqual(result.items.doors, [1200, 3000]);
  assert.deepEqual(result.items.siding, [14820, 42653]);
  assert.deepEqual(result.total, [19020, 53453]);
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
  assert.throws(() => validateInput({ ...base(), replaceWindows: -2 }), /windows to replace/i);
  assert.throws(() => validateInput({ ...base(), lengthFt: 'not a number' }), /length/i);
  assert.throws(() => validateInput({ ...base(), replaceDoors: 1.5 }), /whole number/);
  assert.throws(() => validateInput({ ...base(), sidingLowPerSqFt: 20 }), /minimum price/);
  assert.throws(() => validateInput({ ...base(), replaceWindows: 25 }), /cannot exceed/);
  assert.throws(() => validateInput({ ...base(), replaceDoors: 5 }), /cannot exceed/);
});
test('mixed masonry is a share of solid walls, without deducting openings twice', () => {
  const result = estimateExterior({ ...base(), lengthFt: 10, widthFt: 10, stories: 1,
    storyHeightFt: 7, gables: 0, existingWindows: 4, existingDoors: 0,
    replaceWindows: 0, replaceDoors: 0, masonryPercent: 50 });
  assert.equal(result.geometry.grossSqFt, 280);
  assert.equal(result.geometry.openingsSqFt, 60);
  assert.equal(result.geometry.masonrySqFt, 110);
  assert.equal(result.geometry.sidingNetSqFt, 110);
});
test('impossible openings cannot silently produce a zero-dollar siding estimate', () => {
  assert.throws(() => estimateExterior({ ...base(), lengthFt: 10, widthFt: 10,
    stories: 1, storyHeightFt: 7, gables: 0, existingWindows: 30,
    existingDoors: 0, replaceWindows: 0, replaceDoors: 0 }),
    error => error instanceof InputError && /exceed the wall area/.test(error.message));
});
test('whitespace, coercible objects, booleans and nonfinite inputs are rejected with a field', () => {
  for (const value of [' ', '\t', true, false, [], [0], {}, NaN, Infinity]) {
    assert.throws(() => validateInput({ ...base(), existingWindows: value }),
      error => error instanceof InputError && error.field === 'existingWindows');
  }
  for (const value of [null, undefined, [], 1]) assert.throws(() => validateInput(value), InputError);
  assert.equal(validateInput({ ...base(), existingWindows: '0', replaceWindows: '0' }).existingWindows, 0);
});
test('fractional unit prices round each line before summing and keep an exact pricing snapshot', () => {
  const input = { ...base(), masonryPercent: 100, replaceWindows: 1, replaceDoors: 1,
    windowLowEach: 500.5, doorLowEach: 1200.5 };
  const result = estimateExterior(input);
  assert.deepEqual(result.items.windows, [501, 1300]);
  assert.deepEqual(result.items.doors, [1201, 3000]);
  assert.deepEqual(result.total, [1702, 4300]);
  assert.equal(result.pricing.kind, 'illustrative');
  assert.equal(result.pricing.customized, true);
  assert.equal(result.pricing.rates.windowLowEach, 500.5);
  input.windowLowEach = 999;
  assert.equal(result.inputs.windowLowEach, 500.5);
  assert.equal(result.pricing.rates.windowLowEach, 500.5);
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
