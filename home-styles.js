/**
 * Library of typical North-American residential architectural archetypes for CurbQuote's 3D
 * remodel studio, plus pure helpers that clamp public or licensed building footprint measurements
 * into `houseSpec()` proportions without altering `estimate.js` pricing formulas.
 */
import { DEFAULT_INPUT } from './estimate.js';
import { houseSpec, ROOF_COLORS, ROOF_MATERIALS, MASONRY_FINISHES, TRIM_COLORS, windowLayout } from './house-spec.js';

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
    roofMaterial: 'shingle',
    masonry: 'brick',
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
    roofMaterial: 'shingle',
    masonry: 'brick',
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
    roofMaterial: 'shingle',
    masonry: 'stone',
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
    roofMaterial: 'shingle',
    masonry: 'brick',
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
    roofMaterial: 'shingle',
    masonry: 'brick',
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
    roofMaterial: 'metal',
    masonry: 'stone',
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
    roofMaterial: 'shingle',
    masonry: 'brick',
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
    roofMaterial: 'shingle',
    masonry: 'stone',
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
    roofMaterial: 'shingle',
    masonry: 'brick',
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
    roofMaterial: 'shingle',
    masonry: 'brick',
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
    roofMaterial: 'metal',
    masonry: 'brick',
    roof: 'forest',
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
    roofMaterial: 'metal',
    masonry: 'stone',
    roof: 'charcoal',
    trimHex: '#2f3437',
    timberHex: '#2f3437',
    porch: true,
    dormers: false,
    shutters: false,
    windowDensity: 1.2,
    masonryPercent: 15
  }),
  'dutch-colonial': Object.freeze({
    id: 'dutch-colonial',
    name: 'Dutch Colonial',
    detail: '1.5-story · gambrel roof',
    ratio: 1.44,
    lengthFt: 46,
    widthFt: 32,
    stories: 1,
    storyHeightFt: 9,
    gableRiseFt: 12,
    roofPitch: '18:12',
    overhangFt: 1.1,
    roofForm: 'gambrel',
    porchStyle: 'portico',
    accent: 'shed-dormer',
    texture: 'lap',
    roofMaterial: 'shingle',
    masonry: 'brick',
    roof: 'charcoal',
    trimHex: '#f6f4e8',
    timberHex: '#4a3728',
    porch: true,
    dormers: true,
    shutters: true,
    windowDensity: 1,
    masonryPercent: 10
  }),
  saltbox: Object.freeze({
    id: 'saltbox',
    name: 'Saltbox',
    detail: '2-story front · long rear slope',
    ratio: 1.38,
    lengthFt: 44,
    widthFt: 32,
    stories: 2,
    storyHeightFt: 8.5,
    gableRiseFt: 9,
    roofPitch: '9:12',
    overhangFt: 0.9,
    roofForm: 'saltbox',
    porchStyle: 'portico',
    accent: 'center-chimney',
    texture: 'lap',
    roofMaterial: 'shake',
    masonry: 'stone',
    roof: 'weathered',
    trimHex: '#efe9da',
    timberHex: '#4a3728',
    porch: false,
    dormers: false,
    shutters: true,
    windowDensity: 0.95,
    masonryPercent: 10
  }),
  'modern-farmhouse': Object.freeze({
    id: 'modern-farmhouse',
    name: 'Modern farmhouse',
    detail: '2-story · board & batten · metal',
    ratio: 1.5,
    lengthFt: 50,
    widthFt: 32,
    stories: 2,
    storyHeightFt: 9.5,
    gableRiseFt: 12,
    roofPitch: '10:12',
    overhangFt: 1.2,
    roofForm: 'gable',
    porchStyle: 'full',
    accent: 'black-frames',
    texture: 'board',
    roofMaterial: 'metal',
    masonry: 'stone',
    roof: 'onyx',
    trimHex: '#26282a',
    timberHex: '#26282a',
    porch: true,
    dormers: false,
    shutters: false,
    windowDensity: 1.1,
    masonryPercent: 10
  }),
  prairie: Object.freeze({
    id: 'prairie',
    name: 'Prairie',
    detail: '2-story · low hip · wide eaves',
    ratio: 1.6,
    lengthFt: 52,
    widthFt: 32,
    stories: 2,
    storyHeightFt: 9,
    gableRiseFt: 4.5,
    roofPitch: '4:12',
    overhangFt: 3.2,
    roofForm: 'hip-low',
    porchStyle: 'cantilever',
    accent: 'banded',
    texture: 'lap-wide',
    roofMaterial: 'tile',
    masonry: 'stone',
    roof: 'sand',
    trimHex: '#4a3b2e',
    timberHex: '#4a3b2e',
    porch: true,
    dormers: false,
    shutters: false,
    windowDensity: 1.1,
    masonryPercent: 35
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
  dutch_colonial: 'dutch-colonial',
  gambrel: 'dutch-colonial',
  salt_box: 'saltbox',
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
  prairie_school: 'prairie',
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

const METRES_TO_FEET = 3.28084;
/**
 * The measured footprint as a flat plan for the remodel model: [x, z] points in feet, centred,
 * turned so the long side of the smallest containing rectangle runs along x (the model's front
 * faces +z). Returns null without a usable polygon. `coverage` is the plan's area against its
 * containing rectangle — 1 for a rectangle, less for L- and T-shaped homes.
 */
export function outlineFromFootprint(footprintData) {
  const ring = footprintData?.polygon?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) return null;
  const raw = ring.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (raw.length < 4) return null;
  const open = raw[0][0] === raw.at(-1)[0] && raw[0][1] === raw.at(-1)[1] ? raw.slice(0, -1) : raw;
  if (open.length < 3) return null;
  const lon0 = open.reduce((s, p) => s + p[0], 0) / open.length, lat0 = open.reduce((s, p) => s + p[1], 0) / open.length;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const local = open.map(([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky]);
  let best = null;
  for (let i = 0; i < local.length; i++) {
    const [x1, y1] = local[i], [x2, y2] = local[(i + 1) % local.length];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1e-4) continue;
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [px, py] of local) {
      const u = px * ux + py * uy, v = -px * uy + py * ux;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { area, ux, uy, minU, maxU, minV, maxV };
  }
  if (!best) return null;
  const lengthFt = (best.maxU - best.minU) * METRES_TO_FEET, widthFt = (best.maxV - best.minV) * METRES_TO_FEET;
  if (!(lengthFt >= 10 && widthFt >= 8)) return null;
  const cu = (best.minU + best.maxU) / 2, cv = (best.minV + best.maxV) / 2;
  let points = local.map(([px, py]) => {
    const u = px * best.ux + py * best.uy - cu, v = -px * best.uy + py * best.ux - cv;
    return [Math.round(u * METRES_TO_FEET * 100) / 100, Math.round(-v * METRES_TO_FEET * 100) / 100];
  });
  // Simplify: drop points closer than ~9 inches to their neighbour, then near-collinear ones.
  const simplify = (pts, minDist, collinear) => {
    const kept = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) >= minDist);
    if (kept.length < 3) return kept;
    return kept.filter((p, i) => {
      const a = kept[(i - 1 + kept.length) % kept.length], b = kept[(i + 1) % kept.length];
      return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1])) >= collinear;
    });
  };
  points = simplify(points, .75, .35);
  if (points.length > 20) points = simplify(points, 1.5, .75);
  if (points.length < 3 || points.length > 24) return null;
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i], [x2, z2] = points[(i + 1) % points.length];
    twiceArea += x1 * z2 - x2 * z1;
  }
  const areaSqFt = Math.abs(twiceArea) / 2;
  return {
    points,
    lengthFt: Math.round(lengthFt * 10) / 10,
    widthFt: Math.round(widthFt * 10) / 10,
    coverage: Math.round(areaSqFt / (lengthFt * widthFt) * 100) / 100
  };
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
  if (roofShape === 'gambrel') return 'dutch-colonial';
  if (roofShape === 'saltbox') return 'saltbox';
  if (roofShape === 'mansard') return 'victorian-gingerbread';
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
    roofMaterial: ROOF_MATERIALS[style.roofMaterial] ? style.roofMaterial : 'shingle',
    masonry: MASONRY_FINISHES[style.masonry] ? style.masonry : 'brick',
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
  const trimOverride = TRIM_COLORS[spec.trim]?.hex;
  spec.trimHex = spec.before ? '#d8d2c4' : trimOverride || style.trimHex;
  spec.timberHex = spec.before ? '#6c6256' : trimOverride && style.timberHex === style.trimHex ? trimOverride : style.timberHex;
  spec.accent = style.accent;
  spec.modelBadge = modelGuardrailLabel(footprintData);
  spec.footprintSource = footprintData?.source?.provider || footprintData?.provider || null;
  // The measured plan rides along when the homeowner has not overridden the size by hand, so
  // the remodel can build its shell on the real outline instead of the plain rectangle.
  if (footprintData && !hasExplicit(inputs, 'lengthFt') && !hasExplicit(inputs, 'widthFt')) {
    const outline = outlineFromFootprint(footprintData);
    if (outline) spec.outline = outline;
  }
  spec.label = `${style.name} · ${Math.round(spec.lengthFt)} × ${Math.round(spec.widthFt)} ft · ${spec.stories} ${spec.stories === 1 ? 'story' : 'stories'} · ${spec.windows.length} windows shown`;
  return spec;
}

/**
 * A small front-elevation drawing of each style for the picker cards, in a 96 × 56 box with the
 * ground at y = 52. Returns SVG path data only, so callers build the element without inline styles.
 */
export function styleSilhouette(styleId) {
  const s = resolveHomeStyle(styleId), r = n => Math.round(n * 10) / 10;
  const w = Math.max(44, Math.min(70, 30 + s.ratio * 22)), x0 = (96 - w) / 2, x1 = x0 + w, cx = 48;
  const storyPx = 11.5, bodyH = s.roofForm === 'gambrel' ? 12 : Math.max(1, s.stories) * storyPx, top = 52 - bodyH;
  const rise = Math.max(4, Math.min(16, s.gableRiseFt * 1.25)), o = Math.min(5, 1 + s.overhangFt * 1.2);
  let body = `M${r(x0)} 52V${r(top)}H${r(x1)}V52Z`, roof;
  switch (s.roofForm) {
    case 'hip': case 'hip-low':
      roof = `M${r(x0 - o)} ${r(top)}L${r(x0 + w * .3)} ${r(top - rise)}H${r(x1 - w * .3)}L${r(x1 + o)} ${r(top)}Z`; break;
    case 'flat':
      roof = `M${r(x0 - o)} ${r(top - 3.5)}H${r(x1 + o)}V${r(top)}H${r(x0 - o)}Z`; break;
    case 'gambrel': {
      const knee = top - rise * .62, kx = w * .12;
      roof = `M${r(x0 - o)} ${r(top)}L${r(x0 + kx)} ${r(knee)}L${cx} ${r(top - rise - 2)}L${r(x1 - kx)} ${r(knee)}L${r(x1 + o)} ${r(top)}Z`; break;
    }
    case 'saltbox':
      roof = `M${r(x0 - o)} ${r(top)}L${r(cx - w * .14)} ${r(top - rise)}L${r(x1 + o)} ${r(top + storyPx * .9)}V${r(top)}Z`; break;
    case 'split': {
      const mid = x0 + w * .48, low = 52 - storyPx;
      body = `M${r(x0)} 52V${r(low)}H${r(mid)}V${r(top)}H${r(x1)}V52Z`;
      roof = `M${r(x0 - o)} ${r(low)}L${r((x0 + mid) / 2)} ${r(low - rise * .7)}L${r(mid + 1)} ${r(low)}ZM${r(mid - o)} ${r(top)}L${r((mid + x1) / 2)} ${r(top - rise)}L${r(x1 + o)} ${r(top)}Z`; break;
    }
    case 'shed-modern':
      roof = `M${r(x0 - o)} ${r(top)}L${r(cx + 4)} ${r(top - rise * .55)}V${r(top - rise)}L${r(x1 + o)} ${r(top - rise * .45)}V${r(top)}Z`; break;
    case 'cross-gable': {
      const gx0 = x0 + w * .08, gx1 = x0 + w * .46, gcx = (gx0 + gx1) / 2;
      roof = `M${r(x0 - o)} ${r(top)}L${cx} ${r(top - rise * .8)}L${r(x1 + o)} ${r(top)}ZM${r(gx0 - 2)} ${r(top + 1)}L${r(gcx)} ${r(top - rise - 2)}L${r(gx1 + 2)} ${r(top + 1)}Z`; break;
    }
    default:
      roof = `M${r(x0 - o)} ${r(top)}L${cx} ${r(top - rise)}L${r(x1 + o)} ${r(top)}Z`;
  }
  const door = `M${r(cx - 3)} 52V44H${r(cx + 3)}V52Z`, eave = 52 - storyPx + 2;
  // Two windows a floor, kept clear of the door; split-levels skip the low wing's upper floor.
  let windows = '';
  const floors = s.roofForm === 'gambrel' ? 1 : Math.max(1, s.stories);
  for (let f = 0; f < floors; f++) for (const wx of [x0 + w * .16, x1 - w * .16 - 6]) {
    if (s.roofForm === 'split' && f > 0 && wx < cx) continue;
    const wy = 52 - f * storyPx - 9.5;
    windows += `M${r(wx)} ${r(wy)}h6v5h-6Z`;
  }
  const porch = !s.porch ? '' : s.porchStyle === 'full' || s.porchStyle === 'wraparound'
    ? `M${r(x0 - 1)} ${r(eave)}H${r(x1 + 1)}M${r(x0 + 1)} 52V${r(eave)}M${r(x1 - 1)} 52V${r(eave)}M${r(cx - 9)} 52V${r(eave)}M${r(cx + 9)} 52V${r(eave)}`
    : `M${r(cx - 7)} ${r(eave)}H${r(cx + 7)}M${r(cx - 6)} 52V${r(eave)}M${r(cx + 6)} 52V${r(eave)}`;
  return { body, roof, door, porch, windows };
}
