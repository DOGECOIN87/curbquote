import { DEFAULT_INPUT, estimateExterior, InputError } from './estimate.js';

// Demonstration price book. These are authored examples, never sourced contractor bids.
export const CATALOG_VERSION = 'demo-products-2026-10-v1';
export const PRODUCTS = Object.freeze({
  siding: Object.freeze({ vinyl: { name: 'Vinyl lap siding', rates: [7, 14] }, fiber: { name: 'Fiber cement', rates: [10, 20] }, engineered: { name: 'Engineered wood', rates: [9, 18] } }),
  windows: Object.freeze({ vinyl: { name: 'Vinyl double-hung', rates: [500, 1300] }, fiberglass: { name: 'Fiberglass casement', rates: [900, 1800] }, wood: { name: 'Wood-clad windows', rates: [1000, 2200] } }),
  doors: Object.freeze({ steel: { name: 'Steel entry door', rates: [1200, 3000] }, fiberglass: { name: 'Fiberglass entry door', rates: [1800, 4200] }, wood: { name: 'Wood entry door', rates: [2500, 6000] } })
});
export const TIERS = Object.freeze({ standard: { name: 'Standard', multiplier: 1 }, enhanced: { name: 'Enhanced', multiplier: 1.25 }, premium: { name: 'Premium', multiplier: 1.6 } });
export const COLORS = Object.freeze({
  sage: { name: 'Sage', hex: '#829581' }, cream: { name: 'Warm ivory', hex: '#e9dfc8' }, slate: { name: 'Coastal slate', hex: '#637c8a' },
  charcoal: { name: 'Charcoal', hex: '#42494d' }, terracotta: { name: 'Terracotta', hex: '#b4765c' }, white: { name: 'Soft white', hex: '#e7e8e2' },
  navy: { name: 'Deep navy', hex: '#3e4f63' }, forest: { name: 'Forest', hex: '#5a6a52' }, greige: { name: 'Warm greige', hex: '#a69d8a' },
  barn: { name: 'Barn red', hex: '#8b3d35' }, butter: { name: 'Butter yellow', hex: '#e3cd92' }, iron: { name: 'Iron black', hex: '#2e3133' }
});
export const PROJECT_HOME_STYLES = Object.freeze(['colonial-2story', 'ranch-1story', 'craftsman-bungalow', 'cape-cod', 'tudor-gable', 'farmhouse-porch', 'split-level', 'midcentury-flat', 'victorian-gingerbread', 'foursquare', 'creole-cottage', 'contemporary-gable', 'dutch-colonial', 'saltbox', 'modern-farmhouse', 'prairie']);
export const DEFAULT_PROJECT = Object.freeze({ siding: true, windows: true, doors: true, sidingProduct: 'vinyl', windowProduct: 'vinyl', doorProduct: 'steel', tier: 'standard', coveragePercent: 100, color: 'sage', homeStyle: 'colonial-2story' });

export function validateProject(candidate = {}) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new InputError('Choose your project options.', 'scope-siding');
  const p = { ...DEFAULT_PROJECT, ...candidate };
  for (const key of ['siding', 'windows', 'doors']) if (typeof p[key] !== 'boolean') throw new InputError('Choose a valid project scope.', `scope-${key}`);
  if (!p.siding && !p.windows && !p.doors) throw new InputError('Choose at least one project: siding, windows or doors.', 'scope-siding');
  for (const [key, kind] of [['sidingProduct', 'siding'], ['windowProduct', 'windows'], ['doorProduct', 'doors']]) {
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
  for (const [kind, product, prefix, suffix] of [['siding', p.sidingProduct, 'siding', 'PerSqFt'], ['windows', p.windowProduct, 'window', 'Each'], ['doors', p.doorProduct, 'door', 'Each']]) {
    PRODUCTS[kind][product].rates.forEach((rate, index) => { rates[`${prefix}${index ? 'High' : 'Low'}${suffix}`] = Math.round(rate * multiplier * 100) / 100; });
  }
  return rates;
}

export function estimateProject(input, options = DEFAULT_PROJECT) {
  const project = validateProject(options);
  const expectedRates = catalogRates(project);
  const calculationInput = { ...input };
  // Unselected work must not require dimensions or replacement counts for its price.
  if (!project.siding) for (const key of ['lengthFt', 'widthFt', 'stories', 'storyHeightFt', 'gables', 'gableRiseFt', 'masonryPercent']) calculationInput[key] = DEFAULT_INPUT[key];
  for (const [kind, prefix, suffix] of [['windows', 'window', 'Each'], ['doors', 'door', 'Each'], ['siding', 'siding', 'PerSqFt']]) {
    if (!project[kind]) {
      calculationInput[`${prefix}Low${suffix}`] = 0;
      calculationInput[`${prefix}High${suffix}`] = 0;
      if (kind !== 'siding') calculationInput[kind === 'windows' ? 'replaceWindows' : 'replaceDoors'] = 0;
    }
  }
  const result = estimateExterior(calculationInput, { siding: project.siding, coveragePercent: project.coveragePercent });
  result.project = project;
  result.pricing.version = CATALOG_VERSION;
  result.pricing.customized = Object.entries(expectedRates).some(([key, value]) => {
    const kind = key.startsWith('siding') ? 'siding' : key.startsWith('window') ? 'windows' : 'doors';
    return project[kind] && result.inputs[key] !== value;
  });
  result.productNames = { siding: PRODUCTS.siding[project.sidingProduct].name, windows: PRODUCTS.windows[project.windowProduct].name, doors: PRODUCTS.doors[project.doorProduct].name, tier: TIERS[project.tier].name, color: COLORS[project.color].name };
  return result;
}
