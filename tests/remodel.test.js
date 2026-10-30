import test from 'node:test';
import assert from 'node:assert/strict';
import { houseSpec, windowLayout, BEFORE_LOOK, ROOF_COLORS, ROOF_MATERIALS, TRIM_COLORS, MASONRY_FINISHES, SCENES } from '../house-spec.js';
import { COLORS } from '../project.js';
import { isThreeFile, PUBLIC_ASSETS, THREE_FILES } from '../lib/web.mjs';

test('house spec mirrors the homeowner measurements and choices', () => {
  const spec = houseSpec(
    { lengthFt: 40, widthFt: 28, stories: 1, existingWindows: 8 },
    { sidingProduct: 'vinyl', windowProduct: 'wood', doorProduct: 'wood', color: 'slate' },
    { roof: 'clay', porch: true, dormers: true, shutters: false }
  );
  assert.equal(spec.lengthFt, 40);
  assert.equal(spec.widthFt, 28);
  assert.equal(spec.stories, 1);
  assert.equal(spec.texture, 'lap');
  assert.equal(spec.sidingHex, COLORS.slate.hex);
  assert.equal(spec.windows.length, 8);
  assert.equal(spec.porch, true);
  assert.equal(spec.dormers, true);
  assert.match(spec.label, /40 × 28 ft · 1 story · 8 windows shown/);
});

test('before shows the dated palette and never the additions', () => {
  const spec = houseSpec({}, { color: 'charcoal' }, { before: true, porch: true, dormers: true, shutters: true, garage: true, fence: true, roofMaterial: 'metal' });
  assert.equal(spec.sidingHex, BEFORE_LOOK.sidingHex);
  assert.equal(spec.roofHex, BEFORE_LOOK.roofHex);
  assert.deepEqual([spec.porch, spec.dormers, spec.shutters, spec.garage, spec.fence], [false, false, false, false, false]);
  assert.equal(spec.roofMaterial, 'shingle');
});

test('studio finishes, lighting and additions are validated and fall back safely', () => {
  const spec = houseSpec({}, { color: 'navy' }, { roof: 'onyx', roofMaterial: 'tile', trim: 'bronze', masonry: 'stone', scene: 'dusk', garage: true, fence: true });
  assert.equal(spec.sidingHex, COLORS.navy.hex);
  assert.deepEqual([spec.roofHex, spec.roofMaterial, spec.trimHex, spec.masonry, spec.scene], [ROOF_COLORS.onyx.hex, 'tile', TRIM_COLORS.bronze.hex, 'stone', 'dusk']);
  assert.deepEqual([spec.garage, spec.fence], [true, true]);
  const junk = houseSpec({}, {}, { roofMaterial: 'gold', trim: 'plaid', masonry: 'marble', scene: 'noon' });
  assert.deepEqual([junk.roofMaterial, junk.trim, junk.masonry, junk.scene], ['shingle', 'style', 'brick', 'day']);
  for (const catalog of [ROOF_MATERIALS, MASONRY_FINISHES, SCENES]) assert.ok(Object.keys(catalog).length >= 3);
  assert.equal(Object.keys(COLORS).length, 12);
});

test('invalid or extreme typing falls back instead of breaking the preview', () => {
  const spec = houseSpec({ lengthFt: '', widthFt: 'abc', stories: 99, existingWindows: -4 }, { color: 'plaid', sidingProduct: 'plaid' }, { roof: 'plaid' });
  assert.equal(spec.lengthFt, 48);
  assert.equal(spec.widthFt, 34);
  assert.equal(spec.stories, 4);
  assert.equal(spec.color, 'sage');
  assert.equal(spec.roof, 'charcoal');
  assert.equal(spec.windows.length, 0);
});

test('windows spread across faces and floors and keep clear of the front door', () => {
  const layout = windowLayout({ lengthFt: 48, widthFt: 34, stories: 2, existingWindows: 12 });
  assert.equal(layout.length, 12);
  assert.ok(layout.some(w => w.face === 'front' && w.floor === 1));
  assert.ok(layout.some(w => w.face === 'back'));
  for (const w of layout.filter(w => w.face === 'front' && w.floor === 0)) assert.ok(Math.abs(w.along - .5) >= .13, `front ground window at ${w.along} would hit the door`);
  // A long ranch cannot show more front windows than its wall fits.
  const ranch = windowLayout({ lengthFt: 24, widthFt: 20, stories: 1, existingWindows: 40 });
  assert.ok(ranch.filter(w => w.face === 'front').length <= 2);
});

test('the 3D remodel modules and Three.js runtime are packaged, nothing else from three is', () => {
  for (const file of ['house-spec.js', 'remodel-3d.js']) assert.ok(PUBLIC_ASSETS.includes(file), file);
  assert.deepEqual([...THREE_FILES], ['three.module.js', 'three.core.js', 'LICENSE.txt']);
  assert.equal(isThreeFile('three.module.js'), true);
  assert.equal(isThreeFile('../package.json'), false);
  assert.equal(isThreeFile('three.webgpu.js'), false);
});
