/** Transparent, deterministic arithmetic, not a calibrated property estimator. */
export const DEFAULT_INPUT = Object.freeze({
  lengthFt: 48, widthFt: 34, stories: 2, storyHeightFt: 9,
  gables: 2, gableRiseFt: 6, masonryPercent: 20,
  existingWindows: 12, existingDoors: 2,
  replaceWindows: 6, replaceDoors: 1,
  yearBuilt: 1998,
  sidingLowPerSqFt: 7, sidingHighPerSqFt: 14,
  windowLowEach: 500, windowHighEach: 1300,
  doorLowEach: 1200, doorHighEach: 3000
});

export const GEOMETRY_VARIATION = 0.18; // Illustrative scenario, not a confidence interval.
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
  const result = {};
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (candidate[key] === '' || candidate[key] === null || candidate[key] === undefined) {
      throw new Error(`Enter ${key.replace(/([A-Z])/g, ' $1').toLowerCase()}.`);
    }
    const n = Number(candidate[key]);
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new Error(`${key.replace(/([A-Z])/g, ' $1')} must be between ${min} and ${max}.`);
    }
    result[key] = n;
  }
  for (const name of ['stories','gables','existingWindows','existingDoors','replaceWindows','replaceDoors','yearBuilt']) {
    if (!Number.isInteger(result[name])) throw new Error(`${name} must be a whole number.`);
  }
  if (result.replaceWindows > result.existingWindows) throw new Error('Windows to replace cannot exceed existing windows.');
  if (result.replaceDoors > result.existingDoors) throw new Error('Doors to replace cannot exceed existing doors.');
  for (const kind of ['siding','window','door']) {
    const low = result[`${kind}Low${kind === 'siding' ? 'PerSqFt' : 'Each'}`];
    const high = result[`${kind}High${kind === 'siding' ? 'PerSqFt' : 'Each'}`];
    if (low > high) throw new Error(`${kind} minimum price cannot exceed maximum price.`);
  }
  return result;
}

function roundMoney(n) { return Math.round(n); }
export function estimateExterior(input) {
  const p = validateInput(input);
  const perimeterFt = 2 * (p.lengthFt + p.widthFt);
  const grossWallsSqFt = perimeterFt * p.stories * p.storyHeightFt;
  const gableSqFt = p.gables * (Math.min(p.lengthFt, p.widthFt) * p.gableRiseFt / 2);
  const grossSqFt = grossWallsSqFt + gableSqFt;
  const masonrySqFt = grossSqFt * p.masonryPercent / 100;
  // Coarse editable assumptions; actual openings vary significantly by home.
  const openingsSqFt = p.existingWindows * 15 + p.existingDoors * 21;
  const sidingNetSqFt = Math.max(0, grossSqFt - masonrySqFt - openingsSqFt);
  const sidingOrderSqFt = sidingNetSqFt * 1.1; // 10% illustrative installation waste
  const sidingLowSqFt = sidingOrderSqFt * (1 - GEOMETRY_VARIATION);
  const sidingHighSqFt = sidingOrderSqFt * (1 + GEOMETRY_VARIATION);
  const sidingLow = roundMoney(sidingLowSqFt * p.sidingLowPerSqFt);
  const sidingHigh = roundMoney(sidingHighSqFt * p.sidingHighPerSqFt);
  const windowsLow = roundMoney(p.replaceWindows * p.windowLowEach);
  const windowsHigh = roundMoney(p.replaceWindows * p.windowHighEach);
  const doorsLow = roundMoney(p.replaceDoors * p.doorLowEach);
  const doorsHigh = roundMoney(p.replaceDoors * p.doorHighEach);
  return {
    inputs: p,
    geometry: { perimeterFt, grossSqFt, masonrySqFt, openingsSqFt, sidingNetSqFt,
      sidingOrderSqFt, sidingLowSqFt, sidingHighSqFt, squares: Math.ceil(sidingOrderSqFt / 100) },
    items: { siding: [sidingLow, sidingHigh], windows: [windowsLow, windowsHigh], doors: [doorsLow, doorsHigh] },
    total: [sidingLow + windowsLow + doorsLow, sidingHigh + windowsHigh + doorsHigh],
    leadPaintReview: p.yearBuilt < 1978
  };
}
