/** Transparent, deterministic arithmetic, not a calibrated property estimator. */
export const MODEL_VERSION = 'manual-geometry-v2';
export const PRICE_VERSION = 'illustrative-usd-v1';
export const ASSUMPTIONS = Object.freeze({
  windowOpeningSqFt: 15, doorOpeningSqFt: 21,
  wasteFraction: 0.10, geometryVariation: 0.18,
  masonryBasis: 'Share of solid wall area after deducting openings'
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
  doorLowEach: 1800, doorHighEach: 4200
});

export const GEOMETRY_VARIATION = ASSUMPTIONS.geometryVariation; // Not a confidence interval.
const labels = {
  lengthFt: 'Length', widthFt: 'Width', stories: 'Stories', storyHeightFt: 'Height per story',
  gables: 'Gable ends', gableRiseFt: 'Gable rise', masonryPercent: 'Brick / stone percentage',
  existingWindows: 'Total exterior windows', existingDoors: 'Total exterior doors',
  replaceWindows: 'Windows to replace', replaceDoors: 'Doors to replace', yearBuilt: 'Year built',
  sidingLowPerSqFt: 'Siding low price', sidingHighPerSqFt: 'Siding high price',
  windowLowEach: 'Window low price', windowHighEach: 'Window high price',
  doorLowEach: 'Door low price', doorHighEach: 'Door high price'
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
  doorLowEach: [0, 30000], doorHighEach: [0, 30000]
};

/** @returns {Record<keyof typeof DEFAULT_INPUT, number>} */
export function validateInput(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new InputError('Enter the home details to calculate an estimate.');
  }
  const result = {};
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
  for (const kind of ['siding','window','door']) {
    const low = result[`${kind}Low${kind === 'siding' ? 'PerSqFt' : 'Each'}`];
    const high = result[`${kind}High${kind === 'siding' ? 'PerSqFt' : 'Each'}`];
    if (low > high) throw new InputError(`${kind} minimum price cannot exceed maximum price.`, `${kind}Low${kind === 'siding' ? 'PerSqFt' : 'Each'}`);
  }
  return result;
}

function roundMoney(n) { return Math.round(n); }
export function estimateExterior(input, { siding = true, coveragePercent = 100 } = {}) {
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
  const rates = Object.fromEntries(Object.keys(p).filter(key => /Low|High/.test(key)).map(key => [key, p[key]]));
  return {
    modelVersion: MODEL_VERSION,
    assumptions: { ...ASSUMPTIONS },
    pricing: { version: PRICE_VERSION, kind: 'illustrative', currency: 'USD',
      customized: Object.entries(rates).some(([key, value]) => value !== DEFAULT_INPUT[key]), rates },
    inputs: p,
    geometry: { perimeterFt, grossSqFt, solidWallsSqFt, masonrySqFt, openingsSqFt, sidingNetSqFt,
      sidingOrderSqFt, sidingLowSqFt, sidingHighSqFt, squares: Math.ceil(sidingOrderSqFt / 100) },
    items: { siding: [sidingLow, sidingHigh], windows: [windowsLow, windowsHigh], doors: [doorsLow, doorsHigh] },
    total: [sidingLow + windowsLow + doorsLow, sidingHigh + windowsHigh + doorsHigh],
    leadPaintReview: p.yearBuilt < 1978
  };
}
