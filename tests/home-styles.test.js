import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOME_STYLES,
  HOME_STYLE_IDS,
  DEFAULT_HOME_STYLE,
  CONCEPT_MODEL_BADGE,
  STYLE_VARIANT_BADGE,
  normalizeHomeStyle,
  resolveHomeStyle,
  dimensionsFromFootprint,
  suggestStyleFromFootprint,
  modelGuardrailLabel,
  houseSpecFromStyle,
  styleSilhouette
} from '../home-styles.js';
import { DEFAULT_INPUT } from '../estimate.js';
import { DEFAULT_PROJECT, PROJECT_HOME_STYLES, estimateProject } from '../project.js';
import { ROOF_COLORS, ROOF_MATERIALS, MASONRY_FINISHES } from '../house-spec.js';

test('defines all 16 North-American residential archetypes with valid massing and visual defaults', () => {
  assert.equal(HOME_STYLE_IDS.length, 16);
  assert.deepEqual([...PROJECT_HOME_STYLES], [...HOME_STYLE_IDS], 'the project validator accepts exactly the styles the studio can draw');
  for (const id of [
    'colonial-2story', 'ranch-1story', 'craftsman-bungalow', 'cape-cod',
    'tudor-gable', 'farmhouse-porch', 'split-level', 'midcentury-flat',
    'victorian-gingerbread', 'foursquare', 'creole-cottage', 'contemporary-gable',
    'dutch-colonial', 'saltbox', 'modern-farmhouse', 'prairie'
  ]) {
    const s = HOME_STYLES[id];
    assert.ok(s, `missing ${id}`);
    assert.ok(s.lengthFt >= 18 && s.lengthFt <= 90);
    assert.ok(s.widthFt >= 16 && s.widthFt <= 64);
    assert.ok(s.stories >= 1 && s.stories <= 4);
    assert.ok(s.storyHeightFt >= 7.5 && s.storyHeightFt <= 12);
    assert.ok(s.gableRiseFt >= 0.8 && s.gableRiseFt <= 12);
    assert.match(s.trimHex, /^#[0-9a-f]{6}$/i);
    assert.ok(ROOF_COLORS[s.roof], `${id} roof color`);
    assert.ok(ROOF_MATERIALS[s.roofMaterial], `${id} roof material`);
    assert.ok(MASONRY_FINISHES[s.masonry], `${id} masonry finish`);
  }
  assert.equal(normalizeHomeStyle('Dutch Colonial'), 'dutch-colonial');
  assert.equal(normalizeHomeStyle('gambrel'), 'dutch-colonial');
  assert.equal(normalizeHomeStyle('prairie_school'), 'prairie');
  assert.equal(normalizeHomeStyle('cape-cod-1.5story'), 'cape-cod');
  assert.equal(normalizeHomeStyle('Queen Anne'), 'victorian-gingerbread');
  assert.equal(normalizeHomeStyle('american-foursquare'), 'foursquare');
  assert.equal(resolveHomeStyle('unknown-archetype').id, DEFAULT_HOME_STYLE);
});

test('houseSpecFromStyle clamps out-of-range inputs and preserves door clearance in windowLayout', () => {
  const huge = houseSpecFromStyle(
    { lengthFt: 250, widthFt: 210, stories: 9, storyHeightFt: 19, gableRiseFt: 30, existingWindows: 40 },
    'tudor-gable',
    { areaSqFt: 9900, roofPitch: '14:12', source: { provider: 'OpenStreetMap' } }
  );
  assert.equal(huge.lengthFt, 90);
  assert.equal(huge.widthFt, 64);
  assert.equal(huge.stories, 4);
  assert.equal(huge.storyHeightFt, 12);
  assert.equal(huge.gableRiseFt, 12);
  assert.equal(huge.modelBadge, STYLE_VARIANT_BADGE);
  assert.ok(!huge.windows.some(w => w.face === 'front' && w.floor === 0 && Math.abs(w.along - 0.5) < 0.08));

  const tiny = houseSpecFromStyle({ lengthFt: 9, widthFt: 8, stories: 0 }, 'ranch-1story');
  assert.equal(tiny.lengthFt, 18);
  assert.equal(tiny.widthFt, 16);
  assert.equal(tiny.stories, 1);
  assert.equal(tiny.modelBadge, CONCEPT_MODEL_BADGE);
  assert.equal(modelGuardrailLabel(null), CONCEPT_MODEL_BADGE);
  assert.equal(modelGuardrailLabel({ areaSqFt: 1650 }), STYLE_VARIANT_BADGE);
});

test('dimensionsFromFootprint derives rectangle from areaSqFt + style ratio and parses roofPitch', () => {
  const ranch = dimensionsFromFootprint({ areaSqFt: 1800, roofPitch: '4:12' }, 'ranch-1story');
  assert.ok(ranch.lengthFt > ranch.widthFt);
  assert.ok(Math.abs(ranch.lengthFt * ranch.widthFt - 1800) < 35);
  assert.ok(ranch.gableRiseFt >= 3 && ranch.gableRiseFt <= 12);

  const foursquare = dimensionsFromFootprint({ areaSqFt: 1400, stories: 2, roofPitch: '26deg' }, 'foursquare');
  assert.ok(foursquare.lengthFt / foursquare.widthFt < 1.2);
  assert.equal(foursquare.stories, 2);
});

test('suggestStyleFromFootprint maps OSM architecture and roof shape tags accurately', () => {
  assert.equal(suggestStyleFromFootprint({ architecture: 'victorian' }), 'victorian-gingerbread');
  assert.equal(suggestStyleFromFootprint({ tags: { 'building:architecture': 'tudor' } }), 'tudor-gable');
  assert.equal(suggestStyleFromFootprint({ roofShape: 'flat', stories: 1 }), 'midcentury-flat');
  assert.equal(suggestStyleFromFootprint({ roofShape: 'hipped', stories: 2 }), 'foursquare');
  assert.equal(suggestStyleFromFootprint({ lengthFt: 62, widthFt: 32, stories: 1 }), 'ranch-1story');
  assert.equal(suggestStyleFromFootprint({ roofShape: 'gambrel' }), 'dutch-colonial');
  assert.equal(suggestStyleFromFootprint({ roofShape: 'saltbox' }), 'saltbox');
});

test('styles carry their own roof covering, masonry and trim into the 3D spec unless the homeowner overrides them', () => {
  const farmhouse = houseSpecFromStyle({}, 'modern-farmhouse');
  assert.equal(farmhouse.roofForm, 'gable');
  assert.equal(farmhouse.roofMaterial, 'metal');
  assert.equal(farmhouse.trimHex, '#26282a');
  const overridden = houseSpecFromStyle({}, 'modern-farmhouse', null, {}, { roofMaterial: 'shake', trim: 'white', masonry: 'whitewash' });
  assert.equal(overridden.roofMaterial, 'shake');
  assert.equal(overridden.trimHex, '#f4f2ea');
  assert.equal(overridden.timberHex, '#f4f2ea', 'dark-trim styles recolor their timber with the trim');
  assert.equal(overridden.masonry, 'whitewash');
  const before = houseSpecFromStyle({}, 'prairie', null, {}, { before: true, garage: true, fence: true, roofMaterial: 'tile' });
  assert.deepEqual([before.garage, before.fence, before.roofMaterial], [false, false, 'shingle']);
});

test('every style has a front-elevation drawing with a body, roof, door and windows', () => {
  for (const id of HOME_STYLE_IDS) {
    const art = styleSilhouette(id);
    for (const key of ['body', 'roof', 'door', 'windows']) assert.match(art[key], /^M[\d.\s\-MLHVZhvz]+$/, `${id} ${key}`);
    assert.ok(!/NaN|undefined/.test(Object.values(art).join(' ')), id);
  }
  assert.notEqual(styleSilhouette('dutch-colonial').roof, styleSilhouette('colonial-2story').roof);
});

test('homeStyle option never alters estimateProject dollar math when measurements and materials match', () => {
  const baseline = estimateProject(DEFAULT_INPUT, { ...DEFAULT_PROJECT, homeStyle: 'colonial-2story' });
  for (const styleId of HOME_STYLE_IDS) {
    const candidate = estimateProject(DEFAULT_INPUT, { ...DEFAULT_PROJECT, homeStyle: styleId });
    assert.deepEqual(candidate.total, baseline.total, `${styleId} must not silently alter pricing`);
  }
});
