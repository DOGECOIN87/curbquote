/** Transparent, deterministic arithmetic, not a calibrated property estimator. */
export const MODEL_VERSION = 'manual-geometry-v2';
export const PRICE_VERSION = 'illustrative-usd-v1';
export const ASSUMPTIONS = Object.freeze({
  windowOpeningSqFt: 15, doorOpeningSqFt: 21,
  wasteFraction: 0.10, geometryVariation: 0.18,
  masonryBasis: 'Share of solid wall area after deducting openings',
  // Roof area: the footprint plus eaves on every side, tilted by the pitch the gable rise implies,
  // plus waste for hips, valleys, ridge caps and starter rows. Gutters run along the eaves: the two
  // long sides of a gabled roof, every side of a hipped one (no gable ends); downspouts are in the rate.
  eaveOverhangFt: 1, roofWasteFraction: 0.12, roofVariation: 0.12
});
export const DEFAULT_INPUT = Object.freeze({
  lengthFt: 48, widthFt: 34, stories: 2, storyHeightFt: 9,
  gables: 2, gableRiseFt: 6, masonryPercent: 20,
  existingWindows: 12, existingDoors: 2,
  replaceWindows: 6, replaceDoors: 1,
  yearBuilt: 1998,
  // The default products' standard-tier rates: James Hardie siding, Marvin fiberglass windows, ProVia fiberglass door.
  sidingLowPerSqFt: 10, sidingHighPerSqFt: 20,
  windowLowEach: 900, windowHighEach: 1800,
  doorLowEach: 1800, doorHighEach: 4200,
  // CertainTeed architectural shingles with one layer torn off, per roofing square (100 sq ft of roof),
  // and seamless gutters with downspouts, per foot of gutter. DC-metro example rates, October 2026.
  roofLowPerSquare: 550, roofHighPerSquare: 900,
  gutterLowPerFt: 14, gutterHighPerFt: 26,
  // The mapped outline's own area when one sized the home (0: length x width). An L-shaped home's
  // bounding rectangle can hold half again its real roof; the walls still follow length and width.
  footprintSqFt: 0
});

export const GEOMETRY_VARIATION = ASSUMPTIONS.geometryVariation; // Not a confidence interval.
const labels = {
  lengthFt: 'Length', widthFt: 'Width', stories: 'Stories', storyHeightFt: 'Height per story',
  gables: 'Gable ends', gableRiseFt: 'Gable rise', masonryPercent: 'Brick / stone percentage',
  existingWindows: 'Total exterior windows', existingDoors: 'Total exterior doors',
  replaceWindows: 'Windows to replace', replaceDoors: 'Doors to replace', yearBuilt: 'Year built',
  sidingLowPerSqFt: 'Siding low price', sidingHighPerSqFt: 'Siding high price',
  windowLowEach: 'Window low price', windowHighEach: 'Window high price',
  doorLowEach: 'Door low price', doorHighEach: 'Door high price',
  roofLowPerSquare: 'Roofing low price', roofHighPerSquare: 'Roofing high price',
  gutterLowPerFt: 'Gutter low price', gutterHighPerFt: 'Gutter high price',
  footprintSqFt: 'Footprint area'
};
export class InputError extends Error {
  constructor(message, field) { super(message); this.name = 'InputError'; this.field = field; }
}
const limits = {
  lengthFt: [10, 350], widthFt: [10, 350], stories: [1, 4], storyHeightFt: [7, 16],
  gables: [0, 12], gableRiseFt: [0, 20], masonryPercent: [0, 100],
  existingWindows: [0, 150], existingDoors: [0, 50],
  replaceWindows: [0, 150], replaceDoors: [0, 50], yearBuilt: [1700, 2100],
  sidingLowPerSqFt: [0, 100], sidingHighPerSqFt: [0, 100],
  windowLowEach: [0, 20000], windowHighEach: [0, 20000],
  doorLowEach: [0, 30000], doorHighEach: [0, 30000],
  roofLowPerSquare: [0, 5000], roofHighPerSquare: [0, 5000],
  gutterLowPerFt: [0, 200], gutterHighPerFt: [0, 200],
  footprintSqFt: [0, 122500]
};

/** @returns {Record<keyof typeof DEFAULT_INPUT, number>} */
export function validateInput(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new InputError('Enter the home details to calculate an estimate.');
  }
  const result = {};
  // Saved projects from before the footprint area existed open as length x width.
  candidate = { footprintSqFt: 0, ...candidate };
  for (const [key, [min, max]] of Object.entries(limits)) {
    const value = candidate[key];
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
      throw new InputError(`Enter ${labels[key].toLowerCase()}.`, key);
    }
    if (typeof value !== 'number' && typeof value !== 'string') {
      throw new InputError(`${labels[key]} must be a number.`, key);
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new InputError(`${labels[key]} must be between ${min} and ${max}.`, key);
    }
    result[key] = n;
  }
  for (const name of ['stories','gables','existingWindows','existingDoors','replaceWindows','replaceDoors','yearBuilt']) {
    if (!Number.isInteger(result[name])) throw new InputError(`${labels[name]} must be a whole number.`, name);
  }
  if (result.replaceWindows > result.existingWindows) throw new InputError('Windows to replace cannot exceed existing windows.', 'replaceWindows');
  if (result.replaceDoors > result.existingDoors) throw new InputError('Doors to replace cannot exceed existing doors.', 'replaceDoors');
  for (const [kind, suffix] of [['siding', 'PerSqFt'], ['window', 'Each'], ['door', 'Each'], ['roof', 'PerSquare'], ['gutter', 'PerFt']]) {
    if (result[`${kind}Low${suffix}`] > result[`${kind}High${suffix}`]) throw new InputError(`${labels[`${kind}Low${suffix}`].replace(' low price', '')} minimum price cannot exceed maximum price.`, `${kind}Low${suffix}`);
  }
  return result;
}

function roundMoney(n) { return Math.round(n); }
export function estimateExterior(input, { siding = true, coveragePercent = 100, roofing = false, gutters = false } = {}) {
  const p = validateInput(input);
  const perimeterFt = 2 * (p.lengthFt + p.widthFt);
  const grossWallsSqFt = perimeterFt * p.stories * p.storyHeightFt;
  const gableSqFt = p.gables * (Math.min(p.lengthFt, p.widthFt) * p.gableRiseFt / 2);
  const grossSqFt = grossWallsSqFt + gableSqFt;
  const openingsSqFt = p.existingWindows * ASSUMPTIONS.windowOpeningSqFt + p.existingDoors * ASSUMPTIONS.doorOpeningSqFt;
  if (siding && openingsSqFt > grossSqFt) {
    throw new InputError('Assumed window and door openings exceed the wall area. Check the dimensions and opening counts.', 'existingWindows');
  }
  // Apply masonry to solid walls so openings in masonry are not also deducted from siding.
  const solidWallsSqFt = Math.max(0, grossSqFt - openingsSqFt);
  const masonrySqFt = solidWallsSqFt * p.masonryPercent / 100;
  const sidingNetSqFt = siding ? (solidWallsSqFt - masonrySqFt) * coveragePercent / 100 : 0;
  const sidingOrderSqFt = sidingNetSqFt * (1 + ASSUMPTIONS.wasteFraction);
  const sidingLowSqFt = sidingOrderSqFt * (1 - GEOMETRY_VARIATION);
  const sidingHighSqFt = sidingOrderSqFt * (1 + GEOMETRY_VARIATION);
  const sidingLow = roundMoney(sidingLowSqFt * p.sidingLowPerSqFt);
  const sidingHigh = roundMoney(sidingHighSqFt * p.sidingHighPerSqFt);
  const windowsLow = roundMoney(p.replaceWindows * p.windowLowEach);
  const windowsHigh = roundMoney(p.replaceWindows * p.windowHighEach);
  const doorsLow = roundMoney(p.replaceDoors * p.doorLowEach);
  const doorsHigh = roundMoney(p.replaceDoors * p.doorHighEach);
  // Roofing and gutters, only when chosen: the footprint carries no roof plan, so both stay ranges.
  const eave = ASSUMPTIONS.eaveOverhangFt, shortSide = Math.min(p.lengthFt, p.widthFt), longSide = Math.max(p.lengthFt, p.widthFt);
  const roofSlope = Math.sqrt(1 + (p.gableRiseFt / (shortSide / 2)) ** 2);
  // A mapped outline's area, plus the eaves around it, when it is smaller than the rectangle.
  const outlineSqFt = p.footprintSqFt > 0 ? Math.min(p.footprintSqFt, p.lengthFt * p.widthFt) : p.lengthFt * p.widthFt;
  const roofPlanSqFt = outlineSqFt + 2 * (p.lengthFt + p.widthFt) * eave + 4 * eave * eave;
  const roofSqFt = roofing ? roofPlanSqFt * roofSlope : 0;
  const roofSquares = roofSqFt * (1 + ASSUMPTIONS.roofWasteFraction) / 100;
  const roofingLow = roundMoney(roofSquares * (1 - ASSUMPTIONS.roofVariation) * p.roofLowPerSquare);
  const roofingHigh = roundMoney(roofSquares * (1 + ASSUMPTIONS.roofVariation) * p.roofHighPerSquare);
  const gutterFt = gutters ? (p.gables > 0 ? 2 * (longSide + 2 * eave) : 2 * (p.lengthFt + p.widthFt) + 8 * eave) : 0;
  const guttersLow = roundMoney(gutterFt * p.gutterLowPerFt);
  const guttersHigh = roundMoney(gutterFt * p.gutterHighPerFt);
  const rates = Object.fromEntries(Object.keys(p).filter(key => /Low|High/.test(key)).map(key => [key, p[key]]));
  return {
    modelVersion: MODEL_VERSION,
    assumptions: { ...ASSUMPTIONS },
    pricing: { version: PRICE_VERSION, kind: 'illustrative', currency: 'USD',
      customized: Object.entries(rates).some(([key, value]) => value !== DEFAULT_INPUT[key]), rates },
    inputs: p,
    geometry: { perimeterFt, grossSqFt, solidWallsSqFt, masonrySqFt, openingsSqFt, sidingNetSqFt,
      sidingOrderSqFt, sidingLowSqFt, sidingHighSqFt, squares: Math.ceil(sidingOrderSqFt / 100),
      roofPitch: Math.round(12 * p.gableRiseFt / (shortSide / 2) * 10) / 10, roofSqFt, roofSquares, gutterFt },
    items: { siding: [sidingLow, sidingHigh], windows: [windowsLow, windowsHigh], doors: [doorsLow, doorsHigh],
      ...(roofing ? { roofing: [roofingLow, roofingHigh] } : {}), ...(gutters ? { gutters: [guttersLow, guttersHigh] } : {}) },
    total: [sidingLow + windowsLow + doorsLow + (roofing ? roofingLow : 0) + (gutters ? guttersLow : 0),
      sidingHigh + windowsHigh + doorsHigh + (roofing ? roofingHigh : 0) + (gutters ? guttersHigh : 0)],
    leadPaintReview: p.yearBuilt < 1978
  };
}
