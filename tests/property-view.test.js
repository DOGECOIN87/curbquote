import test from 'node:test';
import assert from 'node:assert/strict';
import { isAutomaticAddressReady } from '../address.js';
import { AERIAL_ENDPOINT, aerialView, hasAerialCoverage, moveView, pointInView, projectPoint, unprojectPoint } from '../property-view.js';

test('automatic lookup waits for a complete-looking address while manual lookup remains available', () => {
  for (const value of ['', '123', '123 Main Street', '123 Main Street, Austin', '<script>123 Test TX</script>', '123 Main\nAustin TX']) assert.equal(isAutomaticAddressReady(value), false, value);
  for (const value of ['123 Main St, Austin TX', '123 Main St, Austin, Texas', '123 Main St 78701', '12-34 Main St, Queens, NY 11354-1234', '4600 Silver Hill Rd, Washington, DC 20233']) assert.equal(isAutomaticAddressReady(value), true, value);
});
test('aerial export uses the fixed government source, bounded size, and only coordinates', () => {
  const coordinates = { lat: 38.84505589808, lon: -76.92836638093 };
  const view = aerialView(coordinates), url = new URL(view.url);
  assert.equal(url.origin + url.pathname, AERIAL_ENDPOINT);
  assert.equal(url.searchParams.get('f'), 'image');
  assert.equal(url.searchParams.get('size'), '960,600');
  assert.equal(url.searchParams.get('imageSR'), '3857');
  assert.equal(url.searchParams.get('bboxSR'), '3857');
  assert.equal(url.searchParams.has('address'), false);
  assert.equal(url.searchParams.has('token'), false);
  assert.equal(view.widthMeters, 90);
  const p = pointInView(view, coordinates);
  assert.ok(Math.abs(p.x - 480) < 1e-6); assert.ok(Math.abs(p.y - 300) < 1e-6);
  const groundWidth = (view.bbox[2] - view.bbox[0]) * Math.cos(coordinates.lat * Math.PI / 180);
  assert.ok(Math.abs(groundWidth - 90) < 1e-6);
});
test('pan directions and marker positions remain consistent with the displayed aerial image', () => {
  const center = { lat: 30.2, lon: -97.7 }, view = aerialView(center);
  const east = moveView(view, .3, 0), north = moveView(view, 0, -.3);
  assert.ok(east.lon > center.lon); assert.ok(north.lat > center.lat);
  const moved = aerialView(east), marker = pointInView(moved, center);
  assert.ok(marker.x < 480); assert.ok(Math.abs(marker.y - 300) < .001);
  const roundTrip = unprojectPoint(projectPoint(center));
  assert.ok(Math.abs(roundTrip.lat - center.lat) < 1e-9); assert.ok(Math.abs(roundTrip.lon - center.lon) < 1e-9);
});
test('unsupported coordinates and extreme zooms never create imagery requests', () => {
  for (const point of [{ lat: 61.2, lon: -149.9 }, { lat: 21.3, lon: -157.8 }, { lat: 51.5, lon: -.1 }, { lat: NaN, lon: -90 }, { lat: 35, lon: '90' }, null]) assert.equal(hasAerialCoverage(point), false);
  for (const meters of [0, 59, 1201, NaN, Infinity, '180']) assert.throws(() => aerialView({ lat: 30, lon: -97 }, meters), RangeError);
  assert.throws(() => aerialView({ lat: 61, lon: -150 }), RangeError);
});
