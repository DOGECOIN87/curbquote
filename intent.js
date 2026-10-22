import { COLORS } from './project.js';
import { HOME_STYLES } from './home-styles.js';

/**
 * Reads a plain request such as "navy siding and new windows, under $30k" into estimate choices.
 * Deterministic and local, so it works without an AI connection and on the static site. Prices are
 * never taken from the text; the estimate is always recalculated from the chosen options.
 */
const TRADE_ALTERNATIVES = Object.freeze({ siding: 'siding|cladding|board and batten|exterior walls?', windows: 'windows?', doors: 'doors?|entry|entryway' });
const TRADE_WORDS = Object.freeze(Object.fromEntries(Object.entries(TRADE_ALTERNATIVES).map(([key, words]) => [key, new RegExp(`\\b(${words})\\b`)])));
// Longer phrases first, so "dark gray" wins over "gray" and "deep navy" over "navy".
const COLOR_WORDS = Object.freeze([
  ['charcoal', ['dark gray', 'dark grey', 'charcoal']], ['navy', ['deep navy', 'navy', 'blue']], ['iron', ['iron black', 'black']],
  ['barn', ['barn red', 'red']], ['butter', ['butter yellow', 'yellow']], ['greige', ['warm greige', 'greige', 'beige', 'taupe', 'tan']],
  ['cream', ['warm ivory', 'ivory', 'cream']], ['white', ['soft white', 'white']], ['slate', ['coastal slate', 'slate', 'gray', 'grey']],
  ['sage', ['sage']], ['forest', ['forest', 'green']], ['terracotta', ['terracotta', 'rust', 'orange']]
]);
const STYLE_WORDS = Object.freeze(Object.values(HOME_STYLES)
  .flatMap(style => [style.name.toLowerCase(), style.id.replace(/-\d?story$|-/g, ' ').trim()].map(word => [word, style.id]))
  .concat([['mid century', 'midcentury-flat'], ['split level', 'split-level'], ['bungalow', 'craftsman-bungalow'], ['modern', 'contemporary-gable']])
  .sort((a, b) => b[0].length - a[0].length));
const TIER_WORDS = Object.freeze([
  ['premium', /\b(premium|high[- ]end|luxury|top of the line|best)\b/],
  ['enhanced', /\b(enhanced|mid[- ]range|better|upgraded?)\b/],
  ['standard', /\b(standard|basic|cheapest|affordable|economy)\b/]
]);
// Studio finishes: the 3D concept only, never the price (except the siding material, which is priced).
const ROOF_MATERIAL_WORDS = Object.freeze([['metal', ['standing seam', 'metal roof', 'metal']], ['shake', ['cedar shake', 'shake']], ['tile', ['barrel tile', 'clay tile', 'tile roof']], ['shingle', ['asphalt shingle', 'shingles?', 'asphalt']]]);
const ROOF_COLOR_WORDS = Object.freeze({ black: 'onyx', dark: 'charcoal', charcoal: 'charcoal', gray: 'slate', grey: 'slate', slate: 'slate', brown: 'weathered', red: 'clay', clay: 'clay', green: 'forest', tan: 'sand', sand: 'sand' });
const TRIM_WORDS = Object.freeze({ black: 'black', white: 'white', cream: 'cream', ivory: 'cream', bronze: 'bronze', brown: 'bronze' });
const MASONRY_WORDS = Object.freeze([['whitewash', ['painted brick', 'whitewash(ed)?', 'white brick']], ['stone', ['stone', 'fieldstone']], ['brick', ['red brick', 'brick']]]);
const SIDING_PRODUCT_WORDS = Object.freeze([['fiber', ['fiber cement', 'fibre cement', 'hardie(plank)?', 'cement board']], ['engineered', ['engineered wood', 'wood siding', 'smartside']], ['vinyl', ['vinyl siding', 'vinyl lap']]]);
const FEATURE_WORDS = Object.freeze({ porch: 'porch', garage: 'garage', fence: '(picket )?fence', shutters: 'shutters?', dormers: 'dormers?' });
const SCENE_WORDS = Object.freeze([['golden', 'golden hour|sunset|sunrise'], ['dusk', 'dusk|night|evening'], ['overcast', 'overcast|cloudy'], ['day', 'midday|daytime']]);
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (text, word) => new RegExp(`\\b${escape(word)}\\b`).test(text);

export function parseChangeRequest(input) {
  const text = String(input ?? '').toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const result = { trades: null, color: null, homeStyle: null, tier: null, budget: null, sidingProduct: null, design: {}, wantsEstimate: false, recognized: false };
  if (!text) return result;
  // A colour right before "roof" or "trim" belongs to that part, not the siding.
  let rest = text;
  const roofColor = text.match(/\b(\w+)\s+(metal\s+|shingle\s+|tile\s+)?roof/), trimColor = text.match(/\b(\w+)\s+(trim|window frames|frames)\b/);
  if (roofColor && ROOF_COLOR_WORDS[roofColor[1]]) { result.design.roof = ROOF_COLOR_WORDS[roofColor[1]]; rest = rest.replace(roofColor[0], ' roof'); }
  if (trimColor && TRIM_WORDS[trimColor[1]]) { result.design.trim = TRIM_WORDS[trimColor[1]]; rest = rest.replace(trimColor[0], ' trim'); }
  const firstMatch = list => list.find(([, words]) => [].concat(words).some(word => new RegExp(`\\b(${word})\\b`).test(text)))?.[0] ?? null;
  const roofMaterial = firstMatch(ROOF_MATERIAL_WORDS);
  if (roofMaterial) result.design.roofMaterial = roofMaterial;
  const masonry = firstMatch(MASONRY_WORDS);
  if (masonry) result.design.masonry = masonry;
  result.sidingProduct = firstMatch(SIDING_PRODUCT_WORDS);
  const scene = firstMatch(SCENE_WORDS.map(([key, words]) => [key, [words]]));
  if (scene) result.design.scene = scene;
  for (const [key, words] of Object.entries(FEATURE_WORDS)) {
    if (!new RegExp(`\\b(${words})\\b`).test(text)) continue;
    result.design[key] = !new RegExp(`\\b(no|without|remove|drop|lose|skip)\\s+(the\\s+|a\\s+|any\\s+)?(${words})\\b`).test(text);
  }
  const named = Object.keys(TRADE_WORDS).filter(key => TRADE_WORDS[key].test(text));
  // "no windows", "without the doors", "skip siding", "except doors" leave a trade out.
  const excluded = Object.keys(TRADE_WORDS).filter(key => new RegExp(`\\b(no|without|skip|except|not|minus)\\s+(the\\s+|any\\s+|my\\s+|new\\s+)?(${TRADE_ALTERNATIVES[key]})\\b`).test(text));
  const everything = /\b(everything|all three|whole (house|exterior)|full (project|exterior))\b/.test(text);
  // Naming a trade changes the project only when the request says so ("replace", "new", "only"...);
  // "fiber cement siding in sage" describes the siding without dropping the windows and doors.
  const scoped = /\b(replace|replacing|replacement|new|install|upgrade|redo|swap|only|just|add|adding)\b/.test(text);
  if (everything || excluded.length || (named.length && scoped)) {
    const chosen = everything || !named.filter(key => !excluded.includes(key)).length ? Object.keys(TRADE_WORDS) : named;
    const trades = Object.fromEntries(Object.keys(TRADE_WORDS).map(key => [key, chosen.includes(key) && !excluded.includes(key)]));
    if (Object.values(trades).some(Boolean)) result.trades = trades;
  }
  for (const [key, words] of COLOR_WORDS) if (words.some(word => has(rest, word))) { result.color = key; break; }
  for (const [word, id] of STYLE_WORDS) if (has(text, word)) { result.homeStyle = id; break; }
  for (const [tier, pattern] of TIER_WORDS) if (pattern.test(text)) { result.tier = tier; break; }
  const money = text.match(/(?:under|below|less than|up to|max(?:imum)?|budget(?: of| is)?|around|about)\s*\$?\s*(?<value>\d+(?:[.,]\d+)?)\s*(?<unit>k|thousand|million|billion)?\b/);
  if (money) {
    const value = Number(money.groups.value.replace(',', '')), unit = money.groups.unit;
    // "under 30" means thousands; a larger bare number is already in dollars.
    const amount = value * ({ k: 1e3, thousand: 1e3, million: 1e6, billion: 1e9 }[unit] ?? (value < 1000 ? 1000 : 1));
    if (Number.isFinite(amount) && amount >= 1000 && amount <= 2_000_000) result.budget = Math.round(amount);
  }
  result.wantsEstimate = /\b(estimate|price|cost|quote|how much)\b/.test(text);
  result.recognized = Boolean(result.trades || result.color || result.homeStyle || result.tier || result.budget || result.sidingProduct || Object.keys(result.design).length || result.wantsEstimate);
  return result;
}

/** One short line describing what was understood, in the order a homeowner would say it. */
export function describeChange(change, { colorName = key => COLORS[key]?.name, styleName = id => HOME_STYLES[id]?.name } = {}) {
  const parts = [];
  if (change.trades) {
    const list = ['siding', 'windows', 'doors'].filter(key => change.trades[key]);
    parts.push(list.length === 3 ? 'Siding, windows and doors' : list.map((key, i) => i ? key : key[0].toUpperCase() + key.slice(1)).join(' and '));
  }
  if (change.color) parts.push(`${colorName(change.color)} siding`);
  if (change.homeStyle) parts.push(`${styleName(change.homeStyle)} style`);
  if (change.sidingProduct) parts.push({ fiber: 'fiber cement siding', engineered: 'engineered wood siding', vinyl: 'vinyl siding' }[change.sidingProduct]);
  const design = change.design || {};
  if (design.roofMaterial || design.roof) parts.push(`${design.roof ? `${{ onyx: 'black', charcoal: 'charcoal', slate: 'slate', weathered: 'brown', clay: 'clay', forest: 'green', sand: 'sand' }[design.roof]} ` : ''}${{ metal: 'metal', shake: 'cedar shake', tile: 'tile', shingle: 'shingle' }[design.roofMaterial] || ''} roof`.replace(/\s+/g, ' ').trim());
  if (design.trim) parts.push(`${design.trim} trim`);
  if (design.masonry) parts.push({ stone: 'stone accents', brick: 'brick accents', whitewash: 'painted brick' }[design.masonry]);
  for (const key of ['porch', 'garage', 'fence', 'shutters', 'dormers']) if (key in design) parts.push(`${design[key] ? 'add' : 'no'} ${key === 'fence' ? 'picket fence' : key}`);
  if (design.scene) parts.push({ golden: 'golden hour light', dusk: 'dusk light', overcast: 'overcast light', day: 'midday light' }[design.scene]);
  if (change.tier) parts.push(`${change.tier[0].toUpperCase()}${change.tier.slice(1)} finishes`);
  if (change.budget) parts.push(`budget about $${change.budget.toLocaleString('en-US')}`);
  return parts.join(' · ');
}
