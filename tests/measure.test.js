import test from 'node:test';
import assert from 'node:assert/strict';
import { findRoof, measureOutline, FEET_PER_METER } from '../measure-overlay.js';

const N = 41, STEP = 1.25, MIDDLE = (N - 1) / 2;
// A repeatable pseudo-random sequence, so the "rough" canopy is the same on every run.
const noise = (() => { let seed = 7; return () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - .5; })();
/** Heights on the test grid from a function of metres east and north of the middle. */
const grid = surface => Array.from({ length: N * N }, (_, k) => surface((k % N - MIDDLE) * STEP, (Math.floor(k / N) - MIDDLE) * STEP));
const span = (corners, axis) => Math.max(...corners.map(p => p[axis])) - Math.min(...corners.map(p => p[axis]));
// Ground at 30 m with gentle noise; a 15 × 9 m gabled house north of the point (ridge east–west, 8.5 m
// at the top); a rough tree canopy south-west; a smaller flat-roofed garage south-east.
const lot = (x, y) => {
  const ground = 30 + noise() * .08;
  if (x > -7.5 && x < 7.5 && y > 6.5 && y < 15.5) return 30 + 8.5 - .6 * Math.abs(y - 11);
  // Canopies in photogrammetry are lumpy at about a metre: smooth bumps plus noise.
  if (Math.hypot(x + 14, y + 12) < 6) return 30 + 7 + 1.2 * Math.sin(x * 1.7) * Math.cos(y * 1.9) + noise() * .6;
  if (x > 12 && x < 19 && y > -15 && y < -8) return 30 + 3.2;
  return ground;
};

test('the roof nearest the address point is found, its gable kept whole and the tree skipped', () => {
  const roof = findRoof(grid(lot), N, STEP);
  assert.ok(roof, 'a roof is found');
  assert.ok(Math.abs(span(roof.corners, 0) - 15) <= 2.5, `width ${span(roof.corners, 0)}`);
  assert.ok(Math.abs(span(roof.corners, 1) - 9) <= 2.5, `depth ${span(roof.corners, 1)}`);
  assert.ok(Math.min(...roof.corners.map(p => p[1])) > 3, 'the outline stays on the house, north of the street');
  assert.ok(Math.abs(roof.ground - 30) < .2);
  assert.ok(Math.abs(roof.peak - 38.5) < .6, `peak ${roof.peak}`);
});

test('a tapped point picks that building instead; open ground and canopy alone find nothing', () => {
  const garage = findRoof(grid(lot), N, STEP, { pick: [MIDDLE + 15 / STEP, MIDDLE - 11 / STEP] });
  assert.ok(garage);
  assert.ok(Math.min(...garage.corners.map(p => p[0])) > 9, 'the garage, not the house');
  assert.ok(Math.abs(garage.peak - 33.2) < .2);
  assert.equal(findRoof(grid(() => 30 + noise() * .08), N, STEP), null);
  assert.equal(findRoof(grid((x, y) => Math.hypot(x + 14, y + 12) < 6 ? 37 + 1.2 * Math.sin(x * 1.7) * Math.cos(y * 1.9) + noise() * .6 : 30), N, STEP), null);
  assert.equal(findRoof(new Array(N * N).fill(NaN), N, STEP), null);
});

test('measureOutline reports the sides of a turned rectangle in feet', () => {
  const [lon0, lat0] = [-98.4957, 29.4567], kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540, turn = 30 * Math.PI / 180;
  const corner = (x, y) => [lon0 + (x * Math.cos(turn) - y * Math.sin(turn)) / kx, lat0 + (x * Math.sin(turn) + y * Math.cos(turn)) / ky];
  const shape = measureOutline([corner(-8, -5), corner(8, -5), corner(8, 5), corner(-8, 5), corner(-8, -5)]);
  assert.deepEqual(shape.sides.map(side => Math.round(side.feet)).sort((a, b) => a - b), [Math.round(10 * FEET_PER_METER), Math.round(16 * FEET_PER_METER)]);
  assert.equal(measureOutline([[0, 0], [0, 0], [0, 0]]), null);
});
