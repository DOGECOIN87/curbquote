import test from 'node:test';
import assert from 'node:assert/strict';
import { bearing, distanceMetres, outlineFromInsights } from '../google-maps.js';

const lat0 = 29.4565, lon0 = -98.4972, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
const toLocal = ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky];
/** Solar-style insights for an L × B m house turned `deg` clockwise, with a gable along its length. */
function insights(L, B, deg, { pitch = 30 } = {}) {
  const t = deg * Math.PI / 180, c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t)), W = L * c + B * s, H = L * s + B * c;
  return {
    center: { latitude: lat0, longitude: lon0 },
    boundingBox: { sw: { latitude: lat0 - H / 2 / ky, longitude: lon0 - W / 2 / kx }, ne: { latitude: lat0 + H / 2 / ky, longitude: lon0 + W / 2 / kx } },
    solarPotential: {
      wholeRoofStats: { groundAreaMeters2: L * B },
      roofSegmentStats: [deg, deg + 180].map(azimuth => ({ pitchDegrees: pitch, azimuthDegrees: (azimuth + 360) % 360, stats: { areaMeters2: L * B / 2 } }))
    }
  };
}
const sides = ring => { const p = ring.slice(0, 4).map(toLocal); return [Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1])].sort((a, b) => b - a); };

test('a Solar building becomes a rectangle turned to its roof, with the house’s own sides', () => {
  for (const deg of [0, 12, -20, 30]) {
    const [long, short] = sides(outlineFromInsights(insights(16, 10, deg)));
    assert.ok(Math.abs(long - 16) < .05 && Math.abs(short - 10) < .05, `${deg}°: ${long.toFixed(2)} × ${short.toFixed(2)}`);
  }
  // Roof segments facing south and east describe the same square-on house.
  const [long, short] = sides(outlineFromInsights({ ...insights(16, 10, 0), solarPotential: { roofSegmentStats: [{ pitchDegrees: 25, azimuthDegrees: 180, stats: { areaMeters2: 60 } }, { pitchDegrees: 25, azimuthDegrees: 90, stats: { areaMeters2: 40 } }] } }));
  assert.ok(Math.abs(long - 16) < .05 && Math.abs(short - 10) < .05);
});

test('near 45° the fit is unstable, so the roof’s ground area sizes a square; bad boxes give nothing', () => {
  const [long, short] = sides(outlineFromInsights(insights(14, 11, 44)));
  assert.ok(Math.abs(long - short) < .05 && Math.abs(long * short - 154) < 1);
  assert.equal(outlineFromInsights({}), null);
  assert.equal(outlineFromInsights({ boundingBox: { sw: { latitude: 1, longitude: 1 }, ne: { latitude: 1, longitude: 1 } } }), null);
});

test('Street View bearings point from the panorama to the house', () => {
  assert.equal(Math.round(bearing([lat0, lon0], [lat0 + .001, lon0])), 0);
  assert.equal(Math.round(bearing([lat0, lon0], [lat0, lon0 + .001])), 90);
  assert.equal(Math.round(bearing([lat0, lon0], [lat0 - .001, lon0 - .001 * ky / kx])), 225);
  assert.ok(Math.abs(distanceMetres([lat0, lon0], [lat0 + .001, lon0]) - 110.54) < .01);
});
