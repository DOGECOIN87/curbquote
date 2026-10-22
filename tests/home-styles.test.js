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
  houseSpecFromStyle
} from '../home-styles.js';
import { DEFAULT_INPUT } from '../estimate.js';
import { DEFAULT_PROJECT, estimateProject } from '../project.js';

test('defines all 12 North-American residential archetypes with valid massing and visual defaults', () => {
  assert.equal(HOME_STYLE_IDS.length, 12);
  for (const id of [
    'colonial-2story', 'ranch-1story', 'craftsman-bungalow', 'cape-cod',
    'tudor-gable', 'farmhouse-porch', 'split-level', 'midcentury-flat',
    'victorian-gingerbread', 'foursquare', 'creole-cottage', 'contemporary-gable'
  ]) {
    const s = HOME_STYLES[id];
    assert.ok(s, `missing ${id}`);
    assert.ok(s.lengthFt >= 18 && s.lengthFt <= 90);
    assert.ok(s.widthFt >= 16 && s.widthFt <= 64);
    assert.ok(s.stories >= 1 && s.stories <= 4);
    assert.ok(s.storyHeightFt >= 7.5 && s.storyHeightFt <= 12);
    assert.ok(s.gableRiseFt >= 0.8 && s.gableRiseFt <= 12);
    assert.match(s.trimHex, /^#[0-9a-f]{6}$/i);
  }
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
});

test('homeStyle option never alters estimateProject dollar math when measurements and materials match', () => {
  const baseline = estimateProject(DEFAULT_INPUT, { ...DEFAULT_PROJECT, homeStyle: 'colonial-2story' });
  for (const styleId of HOME_STYLE_IDS) {
    const candidate = estimateProject(DEFAULT_INPUT, { ...DEFAULT_PROJECT, homeStyle: styleId });
    assert.deepEqual(candidate.total, baseline.total, `${styleId} must not silently alter pricing`);
  }
});
