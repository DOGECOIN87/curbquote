import { DEFAULT_INPUT, estimateExterior, InputError } from './estimate.js';
import { BRAND } from './brand.js';

// The product lines and example rates come from the skin in use (skins/<name>/skin.js), default first.
// The rates stay labelled illustrative until the company's price book replaces them.
export const CATALOG_VERSION = BRAND.catalog.version;
export const PRODUCTS = Object.freeze(Object.fromEntries(Object.entries(BRAND.catalog.products).map(([trade, lines]) => [trade, Object.freeze(lines)])));
// The project's priced trades, in display order: the option that switches each on, its product
// choice, and its rate-input prefix and unit.
export const TRADES = Object.freeze([
  ['siding', 'sidingProduct', 'siding', 'PerSqFt'], ['windows', 'windowProduct', 'window', 'Each'], ['doors', 'doorProduct', 'door', 'Each'],
  ['roofing', 'roofProduct', 'roof', 'PerSquare'], ['gutters', 'gutterProduct', 'gutter', 'PerFt']
]);
// Engineered wood left the studio's choices; projects saved with it reopen as fiber cement.
const RETIRED_PRODUCTS = Object.freeze({ sidingProduct: { engineered: 'fiber' } });
export const TIERS = Object.freeze({ standard: { name: 'Standard', multiplier: 1 }, enhanced: { name: 'Enhanced', multiplier: 1.25 }, premium: { name: 'Premium', multiplier: 1.6 } });
export const COLORS = Object.freeze({
  sage: { name: 'Sage', hex: '#829581' }, cream: { name: 'Warm ivory', hex: '#e9dfc8' }, slate: { name: 'Coastal slate', hex: '#637c8a' },
  charcoal: { name: 'Charcoal', hex: '#42494d' }, terracotta: { name: 'Terracotta', hex: '#b4765c' }, white: { name: 'Soft white', hex: '#e7e8e2' },
  navy: { name: 'Deep navy', hex: '#3e4f63' }, forest: { name: 'Forest', hex: '#5a6a52' }, greige: { name: 'Warm greige', hex: '#a69d8a' },
  barn: { name: 'Barn red', hex: '#8b3d35' }, butter: { name: 'Butter yellow', hex: '#e3cd92' }, iron: { name: 'Iron black', hex: '#2e3133' }
});
export const PROJECT_HOME_STYLES = Object.freeze(['colonial-2story', 'ranch-1story', 'craftsman-bungalow', 'cape-cod', 'tudor-gable', 'farmhouse-porch', 'split-level', 'midcentury-flat', 'victorian-gingerbread', 'foursquare', 'creole-cottage', 'contemporary-gable', 'dutch-colonial', 'saltbox', 'modern-farmhouse', 'prairie']);
export const DEFAULT_PROJECT = Object.freeze({ siding: true, windows: true, doors: true, roofing: false, gutters: false, sidingProduct: 'fiber', windowProduct: 'fiberglass', doorProduct: 'fiberglass', roofProduct: 'architectural', gutterProduct: 'seamless', tier: 'standard', coveragePercent: 100, color: 'sage', homeStyle: 'colonial-2story' });

export function validateProject(candidate = {}) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new InputError('Choose your project options.', 'scope-siding');
  const p = { ...DEFAULT_PROJECT, ...candidate };
  for (const [key, retired] of Object.entries(RETIRED_PRODUCTS)) if (Object.hasOwn(retired, p[key])) p[key] = retired[p[key]];
  for (const [key] of TRADES) if (typeof p[key] !== 'boolean') throw new InputError('Choose a valid project scope.', `scope-${key}`);
  if (!TRADES.some(([key]) => p[key])) throw new InputError('Choose at least one project: siding, windows, doors, roofing or gutters.', 'scope-siding');
  for (const [kind, key] of TRADES) {
    if (!Object.hasOwn(PRODUCTS[kind], p[key])) throw new InputError('Choose a product from the available options.', key);
  }
  if (!Object.hasOwn(TIERS, p.tier)) throw new InputError('Choose an available quality tier.', 'tier');
  if (!Object.hasOwn(COLORS, p.color)) throw new InputError('Choose an available siding color.', 'color');
  if (!PROJECT_HOME_STYLES.includes(p.homeStyle)) throw new InputError('Choose an available home style.', 'homeStyle');
  if ((typeof p.coveragePercent !== 'number' && typeof p.coveragePercent !== 'string') || String(p.coveragePercent).trim() === '') throw new InputError('Enter a siding coverage percentage.', 'coveragePercent');
  p.coveragePercent = Number(p.coveragePercent);
  if (!Number.isFinite(p.coveragePercent) || p.coveragePercent < 1 || p.coveragePercent > 100) throw new InputError('Siding coverage must be between 1 and 100%.', 'coveragePercent');
  return Object.fromEntries(Object.keys(DEFAULT_PROJECT).map(key => [key, p[key]]));
}

export function catalogRates(project = DEFAULT_PROJECT) {
  const p = validateProject(project), multiplier = TIERS[p.tier].multiplier;
  const rates = {};
  for (const [kind, key, prefix, suffix] of TRADES) {
    PRODUCTS[kind][p[key]].rates.forEach((rate, index) => { rates[`${prefix}${index ? 'High' : 'Low'}${suffix}`] = Math.round(rate * multiplier * 100) / 100; });
  }
  return rates;
}

export function estimateProject(input, options = DEFAULT_PROJECT) {
  const project = validateProject(options);
  const expectedRates = catalogRates(project);
  const calculationInput = { ...input };
  // Unselected work must not require dimensions or replacement counts for its price.
  // Roofing and gutters are measured from the same footprint, so they keep the dimensions too.
  if (!project.siding && !project.roofing && !project.gutters) for (const key of ['lengthFt', 'widthFt', 'stories', 'storyHeightFt', 'gables', 'gableRiseFt', 'masonryPercent']) calculationInput[key] = DEFAULT_INPUT[key];
  for (const [kind, , prefix, suffix] of TRADES) {
    if (!project[kind]) {
      calculationInput[`${prefix}Low${suffix}`] = 0;
      calculationInput[`${prefix}High${suffix}`] = 0;
      if (kind === 'windows' || kind === 'doors') calculationInput[kind === 'windows' ? 'replaceWindows' : 'replaceDoors'] = 0;
    }
  }
  const result = estimateExterior(calculationInput, { siding: project.siding, coveragePercent: project.coveragePercent, roofing: project.roofing, gutters: project.gutters });
  result.project = project;
  result.pricing.version = CATALOG_VERSION;
  result.pricing.customized = Object.entries(expectedRates).some(([key, value]) => {
    const [kind] = TRADES.find(([, , prefix]) => key.startsWith(prefix));
    return project[kind] && result.inputs[key] !== value;
  });
  result.productNames = { ...Object.fromEntries(TRADES.map(([kind, key]) => [kind, PRODUCTS[kind][project[key]].name])), tier: TIERS[project.tier].name, color: COLORS[project.color].name };
  return result;
}
