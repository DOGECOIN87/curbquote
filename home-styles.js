/**
 * Library of typical North-American residential architectural archetypes for CurbQuote's 3D
 * remodel studio, plus pure helpers that clamp public or licensed building footprint measurements
 * into `houseSpec()` proportions without altering `estimate.js` pricing formulas.
 */
import { DEFAULT_INPUT } from './estimate.js';
import { houseSpec, ROOF_COLORS, windowLayout } from './house-spec.js';

export const DEFAULT_HOME_STYLE = 'colonial-2story';
export const STYLE_VARIANT_BADGE = 'Style variant — approximate, not your surveyed footprint';
export const CONCEPT_MODEL_BADGE = 'Concept model';

export const HOME_STYLES = Object.freeze({
  'colonial-2story': Object.freeze({
    id: 'colonial-2story',
    name: 'Colonial',
    detail: '2-story · center portico',
    ratio: 1.41,
    lengthFt: 48,
    widthFt: 34,
    stories: 2,
    storyHeightFt: 9,
    gableRiseFt: 6,
    roofPitch: '6:12',
    overhangFt: 1.35,
    roofForm: 'gable',
    porchStyle: 'portico',
    accent: 'pediment',
    texture: 'lap',
    roof: 'charcoal',
    trimHex: '#f6f4e8',
    timberHex: '#4a3728',
    porch: true,
    dormers: false,
    shutters: true,
    windowDensity: 1,
    masonryPercent: 20
  }),
  'ranch-1story': Object.freeze({
    id: 'ranch-1story',
    name: 'Ranch',
    detail: '1-story · wide low eaves',
    ratio: 1.87,
    lengthFt: 56,
    widthFt: 30,
    stories: 1,
    storyHeightFt: 8.5,
    gableRiseFt: 4,
    roofPitch: '4:12',
    overhangFt: 2,
    roofForm: 'hip-low',
    porchStyle: 'stoop',
    accent: 'picture-window',
    texture: 'lap',
    roof: 'weathered',
    trimHex: '#f4f1e6',
    timberHex: '#4a3728',
    porch: false,
    dormers: false,
    shutters: true,
    windowDensity: 0.9,
    masonryPercent: 25
  }),
  'craftsman-bungalow': Object.freeze({
    id: 'craftsman-bungalow',
    name: 'Craftsman',
    detail: '1.5-story · tapered porch',
    ratio: 1.24,
    lengthFt: 42,
    widthFt: 34,
    stories: 1,
    storyHeightFt: 9.5,
    gableRiseFt: 7,
    roofPitch: '6:12',
    overhangFt: 2.2,
    roofForm: 'gable',
    porchStyle: 'full',
    accent: 'rafters',
    texture: 'lap-wide',
    roof: 'weathered',
    trimHex: '#ede6d3',
    timberHex: '#5a4432',
    porch: true,
    dormers: true,
    shutters: false,
    windowDensity: 1,
    masonryPercent: 30
  }),
  'cape-cod': Object.freeze({
    id: 'cape-cod',
    name: 'Cape Cod',
    detail: '1.5-story · steep dormers',
    ratio: 1.33,
    lengthFt: 40,
    widthFt: 30,
    stories: 1,
    storyHeightFt: 8.5,
    gableRiseFt: 10.5,
    roofPitch: '10:12',
    overhangFt: 0.95,
    roofForm: 'gable',
    porchStyle: 'stoop',
    accent: 'steep-dormer',
    texture: 'lap',
    roof: 'slate',
    trimHex: '#f7f6ef',
    timberHex: '#4a3728',
    porch: false,
    dormers: true,
    shutters: true,
    windowDensity: 0.85,
    masonryPercent: 10
  }),
  'tudor-gable': Object.freeze({
    id: 'tudor-gable',
    name: 'Tudor',
    detail: '2-story · half-timber gable',
    ratio: 1.38,
    lengthFt: 47,
    widthFt: 34,
    stories: 2,
    storyHeightFt: 9,
    gableRiseFt: 9.5,
    roofPitch: '9:12',
    overhangFt: 1.1,
    roofForm: 'cross-gable',
    porchStyle: 'stoop',
    accent: 'half-timber',
    texture: 'board',
    roof: 'weathered',
    trimHex: '#efe8d8',
    timberHex: '#4a3728',
    porch: false,
    dormers: false,
    shutters: false,
    windowDensity: 1.05,
    masonryPercent: 45
  }),
  'farmhouse-porch': Object.freeze({
    id: 'farmhouse-porch',
    name: 'Farmhouse',
    detail: '2-story · wraparound porch',
    ratio: 1.47,
    lengthFt: 50,
    widthFt: 34,
    stories: 2,
    storyHeightFt: 9.5,
    gableRiseFt: 8.5,
    roofPitch: '8:12',
    overhangFt: 1.5,
    roofForm: 'gable',
    porchStyle: 'wraparound',
    accent: 'wrap-porch',
    texture: 'board',
    roof: 'charcoal',
    trimHex: '#2c3135',
    timberHex: '#2c3135',
    porch: true,
    dormers: true,
    shutters: false,
    windowDensity: 1.1,
    masonryPercent: 10
  }),
  'split-level': Object.freeze({
    id: 'split-level',
    name: 'Split-level',
    detail: 'Staggered 1- & 2-level wings',
    ratio: 1.63,
    lengthFt: 52,
    widthFt: 32,
    stories: 2,
    storyHeightFt: 8.5,
    gableRiseFt: 4.5,
    roofPitch: '4:12',
    overhangFt: 1.5,
    roofForm: 'split',
    porchStyle: 'stoop',
    accent: 'split-wing',
    texture: 'lap',
    roof: 'charcoal',
    trimHex: '#f5f3ea',
    timberHex: '#4a3728',
    porch: false,
    dormers: false,
    shutters: true,
    windowDensity: 0.95,
    masonryPercent: 30
  }),
  'midcentury-flat': Object.freeze({
    id: 'midcentury-flat',
    name: 'Mid-century',
    detail: '1-story · flat fascia canopy',
    ratio: 1.75,
    lengthFt: 56,
    widthFt: 32,
    stories: 1,
    storyHeightFt: 9.5,
    gableRiseFt: 3,
    roofPitch: '1:12',
    overhangFt: 2.4,
    roofForm: 'flat',
    porchStyle: 'cantilever',
    accent: 'parapet',
    texture: 'board',
    roof: 'charcoal',
    trimHex: '#353a3d',
    timberHex: '#353a3d',
    porch: true,
    dormers: false,
    shutters: false,
    windowDensity: 1.2,
    masonryPercent: 25
  }),
  'victorian-gingerbread': Object.freeze({
    id: 'victorian-gingerbread',
    name: 'Victorian',
    detail: '2-story · steep cross-gable',
    ratio: 1.24,
    lengthFt: 42,
    widthFt: 34,
    stories: 2,
    storyHeightFt: 10,
    gableRiseFt: 10,
    roofPitch: '10:12',
    overhangFt: 1.4,
    roofForm: 'cross-gable',
    porchStyle: 'full',
    accent: 'gingerbread',
    texture: 'lap',
    roof: 'slate',
    trimHex: '#faf6ea',
    timberHex: '#faf6ea',
    porch: true,
    dormers: true,
    shutters: true,
    windowDensity: 1.15,
    masonryPercent: 15
  }),
  foursquare: Object.freeze({
    id: 'foursquare',
    name: 'Foursquare',
    detail: '2-story · hipped roof & porch',
    ratio: 1.09,
    lengthFt: 38,
    widthFt: 35,
    stories: 2,
    storyHeightFt: 9.5,
    gableRiseFt: 7.5,
    roofPitch: '6:12',
    overhangFt: 1.8,
    roofForm: 'hip',
    porchStyle: 'full',
    accent: 'hip-dormer',
    texture: 'lap-wide',
    roof: 'weathered',
    trimHex: '#f5f2e6',
    timberHex: '#4a3728',
    porch: true,
    dormers: true,
    shutters: false,
    windowDensity: 1,
    masonryPercent: 25
  }),
  'creole-cottage': Object.freeze({
    id: 'creole-cottage',
    name: 'Creole cottage',
    detail: '1-story · full gallery porch',
    ratio: 1.29,
    lengthFt: 44,
    widthFt: 34,
    stories: 1,
    storyHeightFt: 10.5,
    gableRiseFt: 8.5,
    roofPitch: '8:12',
    overhangFt: 1.6,
    roofForm: 'gable',
    porchStyle: 'full',
    accent: 'gallery',
    texture: 'lap',
    roof: 'clay',
    trimHex: '#f6f3e7',
    timberHex: '#4a3728',
    porch: true,
    dormers: true,
    shutters: true,
    windowDensity: 1.05,
    masonryPercent: 20
  }),
  'contemporary-gable': Object.freeze({
    id: 'contemporary-gable',
    name: 'Contemporary',
    detail: '2-story · modern dark trim',
    ratio: 1.52,
    lengthFt: 50,
    widthFt: 33,
    stories: 2,
    storyHeightFt: 9.5,
    gableRiseFt: 5.5,
    roofPitch: '4:12',
    overhangFt: 1.9,
    roofForm: 'shed-modern',
    porchStyle: 'cantilever',
    accent: 'modern-fascia',
    texture: 'lap-wide',
    roof: 'charcoal',
    trimHex: '#2f3437',
    timberHex: '#2f3437',
    porch: true,
    dormers: false,
    shutters: false,
    windowDensity: 1.2,
    masonryPercent: 15
  })
});

export const HOME_STYLE_IDS = Object.freeze(Object.keys(HOME_STYLES));

export const HOME_STYLE_ALIASES = Object.freeze({
  colonial: 'colonial-2story',
  georgian: 'colonial-2story',
  federal: 'colonial-2story',
  ranch: 'ranch-1story',
  rambler: 'ranch-1story',
  craftsman: 'craftsman-bungalow',
  bungalow: 'craftsman-bungalow',
  arts_and_crafts: 'craftsman-bungalow',
  'cape-cod-1.5story': 'cape-cod',
  cape_cod: 'cape-cod',
  tudor: 'tudor-gable',
  tudor_revival: 'tudor-gable',
  farmhouse: 'farmhouse-porch',
  modern_farmhouse: 'farmhouse-porch',
  split_level: 'split-level',
  midcentury: 'midcentury-flat',
  mid_century_modern: 'midcentury-flat',
  modernist: 'midcentury-flat',
  'contemporary-flat': 'midcentury-flat',
  victorian: 'victorian-gingerbread',
  queen_anne: 'victorian-gingerbread',
  folk_victorian: 'victorian-gingerbread',
  second_empire: 'victorian-gingerbread',
  american_foursquare: 'foursquare',
  prairie: 'foursquare',
  creole: 'creole-cottage',
  shotgun: 'creole-cottage',
  acadian: 'creole-cottage',
  contemporary: 'contemporary-gable',
  modern: 'contemporary-gable'
});

const clampNum = (value, min, max, fallback) => {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function normalizeHomeStyle(styleId) {
  if (typeof styleId !== 'string') return null;
  const key = styleId.trim().toLowerCase();
  if (Object.hasOwn(HOME_STYLES, key)) return key;
  const underscored = key.replace(/[\s-]+/g, '_');
  const hyphenated = key.replace(/[\s_]+/g, '-');
  if (Object.hasOwn(HOME_STYLES, hyphenated)) return hyphenated;
  if (Object.hasOwn(HOME_STYLE_ALIASES, key)) return HOME_STYLE_ALIASES[key];
  if (Object.hasOwn(HOME_STYLE_ALIASES, underscored)) return HOME_STYLE_ALIASES[underscored];
  if (Object.hasOwn(HOME_STYLE_ALIASES, hyphenated)) return HOME_STYLE_ALIASES[hyphenated];
  return null;
}

export function resolveHomeStyle(styleId) {
  return HOME_STYLES[normalizeHomeStyle(styleId) || DEFAULT_HOME_STYLE];
}

export function modelGuardrailLabel(footprintData) {
  return footprintData && typeof footprintData === 'object' ? STYLE_VARIANT_BADGE : CONCEPT_MODEL_BADGE;
}

/** Parses common roof pitch strings ("6:12", "6/12", "26.5deg") into a rise-over-run ratio. */
export function parseRoofPitchRatio(pitch) {
  if (typeof pitch === 'number' && Number.isFinite(pitch) && pitch > 0) {
    return pitch > 2 ? Math.tan(Math.min(60, pitch) * Math.PI / 180) : pitch;
  }
  if (typeof pitch !== 'string') return null;
  const ratio = pitch.trim().match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (ratio && Number(ratio[2]) > 0) return Number(ratio[1]) / Number(ratio[2]);
  const deg = pitch.trim().match(/^(\d+(?:\.\d+)?)\s*(?:deg|°)?$/i);
  if (deg) {
    const val = Number(deg[1]);
    return val > 2 ? Math.tan(Math.min(60, val) * Math.PI / 180) : val;
  }
  return null;
}

/**
 * Derives bounded rectangular home dimensions from public or licensed footprint metadata.
 * Never mutates inputs; clamps cleanly to `houseSpec()` / `estimate.js` visual bounds.
 */
export function dimensionsFromFootprint(footprintData, styleId = DEFAULT_HOME_STYLE) {
  const style = resolveHomeStyle(styleId);
  if (!footprintData || typeof footprintData !== 'object') {
    return {
      lengthFt: style.lengthFt,
      widthFt: style.widthFt,
      stories: style.stories,
      storyHeightFt: style.storyHeightFt,
      gableRiseFt: style.gableRiseFt
    };
  }
  let lengthFt = Number(footprintData.lengthFt);
  let widthFt = Number(footprintData.widthFt);
  const area = Number(footprintData.areaSqFt);
  if ((!Number.isFinite(lengthFt) || !Number.isFinite(widthFt) || lengthFt <= 0 || widthFt <= 0) && Number.isFinite(area) && area > 60) {
    widthFt = Math.sqrt(area / style.ratio);
    lengthFt = area / widthFt;
  }
  if (Number.isFinite(lengthFt) && Number.isFinite(widthFt) && widthFt > lengthFt) {
    [lengthFt, widthFt] = [widthFt, lengthFt];
  }
  const storiesRaw = Number.isFinite(Number(footprintData.stories)) && Number(footprintData.stories) > 0
    ? Number(footprintData.stories)
    : Number.isFinite(Number(footprintData.heightFt)) && Number(footprintData.heightFt) > 0
    ? Math.round(Number(footprintData.heightFt) / 9.84)
    : style.stories;
  const stories = Math.round(clampNum(storiesRaw, 1, 4, style.stories));
  const clampedLength = Math.round(clampNum(lengthFt, 18, 90, style.lengthFt) * 2) / 2;
  const clampedWidth = Math.round(clampNum(widthFt, 16, 64, style.widthFt) * 2) / 2;
  const pitchRatio = parseRoofPitchRatio(footprintData.roofPitch);
  const rawRise = pitchRatio !== null ? (clampedWidth / 2) * pitchRatio : style.gableRiseFt;
  return {
    lengthFt: clampedLength,
    widthFt: clampedWidth,
    stories,
    storyHeightFt: clampNum(footprintData.storyHeightFt, 7.5, 12, style.storyHeightFt),
    gableRiseFt: Math.round(clampNum(rawRise, 3, 12, style.gableRiseFt) * 2) / 2
  };
}

/** Suggests a North-American home archetype from OSM tags (`building:architecture`, `roof:shape`) or massing. */
export function suggestStyleFromFootprint(footprintData = {}) {
  if (!footprintData || typeof footprintData !== 'object') return DEFAULT_HOME_STYLE;
  const arch = normalizeHomeStyle(footprintData.architecture || footprintData.tags?.['building:architecture'] || '');
  if (arch) return arch;
  const roofShape = String(footprintData.roofShape || footprintData.tags?.['roof:shape'] || '').trim().toLowerCase();
  const stories = Number(footprintData.stories) || 0;
  const length = Number(footprintData.lengthFt) || 0, width = Number(footprintData.widthFt) || 0;
  const ratio = length > 0 && width > 0 ? Math.max(length, width) / Math.min(length, width) : 0;
  if (roofShape === 'flat') return 'midcentury-flat';
  if (roofShape === 'skillion') return 'contemporary-gable';
  if (roofShape === 'gambrel' || roofShape === 'mansard') return 'cape-cod';
  if (roofShape === 'hipped' && stories >= 2) return 'foursquare';
  if (stories === 1 && ratio >= 1.55) return 'ranch-1story';
  if (stories === 1 && stories > 0) return 'craftsman-bungalow';
  return DEFAULT_HOME_STYLE;
}

/**
 * Merges North-American style defaults, optional public/licensed `footprintData`, and homeowner
 * inputs into a clamped `houseSpec()` ready for `remodel-3d.js`.
 */
export function houseSpecFromStyle(inputs = {}, styleId = DEFAULT_HOME_STYLE, footprintData = null, options = {}, design = {}) {
  const style = resolveHomeStyle(styleId);
  const derived = dimensionsFromFootprint(footprintData, style.id);
  const hasExplicit = (obj, key) => obj !== null && obj !== undefined && Object.hasOwn(obj, key) && obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim() !== '';
  const mergedInputs = {
    ...DEFAULT_INPUT,
    lengthFt: derived.lengthFt,
    widthFt: derived.widthFt,
    stories: derived.stories,
    storyHeightFt: derived.storyHeightFt,
    gableRiseFt: derived.gableRiseFt,
    masonryPercent: style.masonryPercent,
    existingWindows: Math.round(DEFAULT_INPUT.existingWindows * style.windowDensity)
  };
  for (const [key, value] of Object.entries(inputs || {})) {
    if (hasExplicit(inputs, key)) mergedInputs[key] = value;
    else mergedInputs[key] = value;
  }
  // When footprintData supplies dimensions and caller did not override them in inputs, use derived footprint dims.
  if (footprintData && typeof footprintData === 'object') {
    for (const key of ['lengthFt', 'widthFt', 'stories', 'storyHeightFt', 'gableRiseFt']) {
      if (!hasExplicit(inputs, key)) mergedInputs[key] = derived[key];
    }
  }
  const mergedDesign = {
    roof: ROOF_COLORS[style.roof] ? style.roof : 'charcoal',
    porch: style.porch,
    dormers: style.dormers,
    shutters: style.shutters,
    ...(design || {})
  };
  const spec = houseSpec(mergedInputs, options, mergedDesign);
  if (!hasExplicit(options, 'sidingProduct')) spec.texture = style.texture;
  spec.windows = windowLayout({ ...spec, existingWindows: mergedInputs.existingWindows });
  spec.styleId = style.id;
  spec.styleName = style.name;
  spec.roofForm = style.roofForm;
  spec.porchStyle = style.porchStyle;
  spec.overhangFt = style.overhangFt;
  spec.trimHex = spec.before ? '#d8d2c4' : style.trimHex;
  spec.timberHex = spec.before ? '#6c6256' : style.timberHex;
  spec.accent = style.accent;
  spec.modelBadge = modelGuardrailLabel(footprintData);
  spec.footprintSource = footprintData?.source?.provider || footprintData?.provider || null;
  spec.label = `${style.name} · ${Math.round(spec.lengthFt)} × ${Math.round(spec.widthFt)} ft · ${spec.stories} ${spec.stories === 1 ? 'story' : 'stories'} · ${spec.windows.length} windows shown`;
  return spec;
}
