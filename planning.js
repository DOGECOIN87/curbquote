import { DEFAULT_INPUT, InputError } from './estimate.js';
import { PRODUCTS, TIERS, catalogRates, estimateProject, validateProject } from './project.js';
import { buildEstimateSummary } from './summary.js';
import { validatePropertyContext, propertySourceLines } from './property-data.js';

export const DETAIL_FIELDS = Object.freeze(['lengthFt', 'widthFt', 'stories', 'storyHeightFt', 'gables', 'gableRiseFt', 'masonryPercent', 'existingWindows', 'existingDoors', 'replaceWindows', 'replaceDoors', 'yearBuilt']);
export const FIELD_NAMES = Object.freeze({ lengthFt: 'Footprint length', widthFt: 'Footprint width', stories: 'Stories', storyHeightFt: 'Height per story', gables: 'Gable ends', gableRiseFt: 'Gable rise', masonryPercent: 'Masonry share', existingWindows: 'Total exterior windows', existingDoors: 'Total exterior doors', replaceWindows: 'Windows to replace', replaceDoors: 'Doors to replace', yearBuilt: 'Year built' });

export function parseGoalBudget(text) {
  const match = String(text).toLowerCase().match(/(?:\bbudget\s*(?:(?:of|is)\s*|:\s*)?|\bunder\s+|\bup to\s+|\baround\s+)\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k\b|thousand\b)?/);
  if (!match) return null;
  const budget = Number(match[1].replaceAll(',', '')) * (match[2] ? 1000 : 1);
  if (!Number.isFinite(budget) || budget < 100 || budget > 10000000) throw new InputError('The budget in your goal must be between $100 and $10,000,000.');
  return budget;
}

export function validateSnapshot(value) {
  if (!value || typeof value !== 'object' || !value.inputs || !value.options) throw new InputError('Enter your project details first.');
  const options = validateProject(value.options);
  estimateProject(value.inputs, options);
  const inputs = Object.fromEntries(Object.keys(DEFAULT_INPUT).map(key => [key, value.inputs[key]]));
  const confirmed = Array.isArray(value.confirmed) ? [...new Set(value.confirmed.filter(key => DETAIL_FIELDS.includes(key)))] : [];
  const propertyData = validatePropertyContext(value.propertyData);
  return { inputs, options, confirmed, ...(propertyData ? { propertyData } : {}) };
}

export function reviewProject(value) {
  const state = validateSnapshot(value), result = estimateProject(state.inputs, state.options);
  const needed = state.options.siding ? DETAIL_FIELDS.filter(key => !['replaceWindows', 'replaceDoors'].includes(key)) : [];
  if (state.options.windows) needed.push('existingWindows', 'replaceWindows');
  if (state.options.doors) needed.push('existingDoors', 'replaceDoors');
  const missing = [...new Set(needed)].filter(key => !state.confirmed.includes(key));
  const questions = missing.map(field => ({ field, label: FIELD_NAMES[field], message: `Confirm ${FIELD_NAMES[field].toLowerCase()} — currently ${state.inputs[field]}.` }));
  const warnings = ['Prices are illustrative examples; permits, taxes, disposal, damage and site-specific work are excluded.'];
  if (missing.length) warnings.unshift(`${missing.length} relevant home details still use unconfirmed values. This is a scenario, not a measured property estimate.`);
  if (result.leadPaintReview) warnings.push('The entered year is before 1978. Arrange a professional lead-safe review before work. Remediation is not priced.');
  if (result.pricing.customized) warnings.push('Your current estimate uses edited example prices. Comparison plans use the versioned demonstration catalog.');
  return { total: result.total, modelVersion: result.modelVersion, priceVersion: result.pricing.version, confirmedCount: [...new Set(needed)].length - missing.length, requiredCount: [...new Set(needed)].length, questions, warnings, sourceNotes: propertySourceLines(state.propertyData) };
}

export function proposalSnapshot(value, details = {}, optionChanges = {}) {
  const state = validateSnapshot(value), options = validateProject({ ...state.options, ...optionChanges });
  const inputs = { ...state.inputs, ...details }, rates = catalogRates(options);
  if (['sidingProduct', 'windowProduct', 'doorProduct', 'tier'].some(key => options[key] !== state.options[key])) Object.assign(inputs, rates);
  else for (const [kind, prefix] of [['siding', 'siding'], ['windows', 'window'], ['doors', 'door']]) {
    // Saved excluded trades have zeroed calculation rates. Re-enabling them must not price new work at zero.
    if (options[kind] && !state.options[kind]) for (const [key, rate] of Object.entries(rates)) if (key.startsWith(prefix)) inputs[key] = rate;
  }
  return validateSnapshot({ inputs, options, confirmed: state.confirmed.filter(key => !Object.hasOwn(details, key)), propertyData: state.propertyData });
}

function makePlan(inputs, options, label, budget, current) {
  const result = estimateProject(inputs, options);
  const scope = ['siding', 'windows', 'doors'].filter(key => options[key]);
  return { label, inputs: { ...inputs }, options: { ...options }, total: result.total,
    fit: budget ? result.total[1] <= budget ? 'within' : result.total[0] <= budget ? 'overlap' : 'over' : 'unbudgeted',
    savings: current[1] - result.total[1], priceVersion: result.pricing.version,
    description: `${scope.map(key => result.productNames[key]).join(' · ')} · ${result.productNames.tier}${options.siding ? ` · ${options.coveragePercent}% siding` : ''}`,
    scope: scope.join(', '), usesCatalog: !result.pricing.customized };
}

/** Exhaustive finite search; a fit always means the upper estimate is within budget. */
export function comparePlans(value, { budget = null, allowPhasing = false } = {}) {
  const state = validateSnapshot(value), current = estimateProject(state.inputs, state.options);
  if (budget !== null && (typeof budget !== 'number' || !Number.isFinite(budget) || budget < 100 || budget > 10000000)) throw new InputError('Enter a budget between $100 and $10,000,000.');
  if (typeof allowPhasing !== 'boolean') throw new InputError('Choose whether phased work is allowed.');
  const active = ['siding', 'windows', 'doors'].filter(key => state.options[key]);
  const candidates = [], seen = new Set();
  const add = (inputs, options, label) => {
    const key = JSON.stringify([options, estimateProject(inputs, options).inputs]); if (seen.has(key)) return; seen.add(key);
    const plan = makePlan(inputs, options, label, budget, current.total);
    const retained = active.reduce((sum, kind) => sum + (options[kind] ? kind === 'siding' ? options.coveragePercent / state.options.coveragePercent : 1 : 0), 0) / active.length;
    plan.retainedScope = retained;
    candidates.push(plan);
  };
  add(state.inputs, state.options, 'Your current plan');
  const scopes = allowPhasing ? Array.from({ length: (1 << active.length) - 1 }, (_, mask) => Object.fromEntries(['siding', 'windows', 'doors'].map(kind => [kind, active.includes(kind) && Boolean((mask + 1) & (1 << active.indexOf(kind)))]))) : [Object.fromEntries(['siding', 'windows', 'doors'].map(kind => [kind, state.options[kind]]))];
  for (const scope of scopes) {
    if (!scope.siding && !(scope.windows && +state.inputs.replaceWindows > 0) && !(scope.doors && +state.inputs.replaceDoors > 0)) continue;
    for (const sidingProduct of scope.siding ? Object.keys(PRODUCTS.siding) : [state.options.sidingProduct])
      for (const windowProduct of scope.windows ? Object.keys(PRODUCTS.windows) : [state.options.windowProduct])
        for (const doorProduct of scope.doors ? Object.keys(PRODUCTS.doors) : [state.options.doorProduct])
          for (const tier of Object.keys(TIERS))
            for (const coveragePercent of scope.siding && allowPhasing ? [...new Set([state.options.coveragePercent, Math.min(50, state.options.coveragePercent), Math.min(25, state.options.coveragePercent)])] : [state.options.coveragePercent]) {
              const options = { ...state.options, ...scope, sidingProduct, windowProduct, doorProduct, tier, coveragePercent };
              add({ ...state.inputs, ...catalogRates(options) }, options, 'Alternative plan');
            }
  }
  let plans;
  if (budget) {
    // Retain scope first; quality tiers are catalog price multipliers, not a product-quality rating.
    const within = candidates.filter(plan => plan.fit === 'within').sort((a, b) => b.retainedScope - a.retainedScope || b.total[1] - a.total[1]);
    const others = candidates.filter(plan => plan.fit !== 'within').sort((a, b) => a.total[1] - b.total[1]);
    plans = [...within, ...others].slice(0, 3);
  } else {
    const sorted = [...candidates].sort((a, b) => a.total[1] - b.total[1]);
    plans = [sorted[0], candidates[0], sorted.at(-1)].filter((plan, i, all) => all.indexOf(plan) === i);
  }
  plans = plans.map((plan, index) => ({ ...plan, label: plan.label === 'Your current plan' ? plan.label : budget ? index === 0 && plan.fit === 'within' ? 'Best scope within budget' : `Alternative ${index + 1}` : index === 0 ? 'Lowest catalog cost' : 'Higher catalog tier' }));
  const fittingCount = candidates.filter(plan => plan.fit === 'within').length;
  return { plans, evaluated: candidates.length, fittingCount, budget, allowPhasing,
    message: budget ? fittingCount ? `${fittingCount} of ${candidates.length} plans have an upper estimate within your budget.` : `No tested plan has an upper estimate within your budget. The lowest upper estimate is $${Math.min(...candidates.map(plan => plan.total[1])).toLocaleString('en-US')}.` : `Compared ${candidates.length} plans using the same home details.`,
    note: 'Comparisons use illustrative catalog prices. Phased plans change the work included; review the scope before applying. No missing measurements are invented.' };
}

/** Only explicit homeowner text becomes a proposed input. Unsupported language remains unanswered. */
export function parseProjectGoal(text, value) {
  const state = validateSnapshot(value), inputs = { ...state.inputs }, options = { ...state.options }, changed = [];
  const source = String(text).toLowerCase();
  const count = source.match(/(?:replace|replacing|need|want|install)\s+(\d+)\s+(?:new\s+)?windows?\b/);
  const door = source.match(/(?:replace|replacing|need|want|install|and)\s+(\d+)\s+(?:new\s+|entry\s+)?doors?\b/);
  if (count) { inputs.replaceWindows = Number(count[1]); options.windows = inputs.replaceWindows > 0; changed.push('replaceWindows'); }
  if (door) { inputs.replaceDoors = Number(door[1]); options.doors = inputs.replaceDoors > 0; changed.push('replaceDoors'); }
  if (/\bwindows? only\b/.test(source)) Object.assign(options, { siding: false, windows: true, doors: false });
  if (/\bdoors? only\b/.test(source)) Object.assign(options, { siding: false, windows: false, doors: true });
  if (/\bsiding only\b/.test(source)) Object.assign(options, { siding: true, windows: false, doors: false });
  if (/\bfiber[ -]?cement\b/.test(source)) options.sidingProduct = 'fiber';
  if (/\bengineered wood\b/.test(source)) options.sidingProduct = 'engineered';
  if (/\bvinyl siding\b/.test(source)) options.sidingProduct = 'vinyl';
  for (const tier of Object.keys(TIERS)) if (new RegExp(`\\b${tier}\\b`).test(source)) options.tier = tier;
  const dimensions = source.match(/\b(\d+(?:\.\d+)?)\s*(?:ft\s*)?[x×]\s*(\d+(?:\.\d+)?)\s*(?:ft|feet)\b/);
  if (dimensions) { inputs.lengthFt = Number(dimensions[1]); inputs.widthFt = Number(dimensions[2]); changed.push('lengthFt', 'widthFt'); }
  const stories = source.match(/\b([1-4])[ -](?:story|storey|stories)\b/);
  if (stories) { inputs.stories = Number(stories[1]); changed.push('stories'); }
  const proposal = proposalSnapshot(state, Object.fromEntries(changed.map(key => [key, inputs[key]])), options);
  return { ...proposal, suppliedFields: changed, changed: JSON.stringify([inputs, options]) !== JSON.stringify([state.inputs, state.options]) };
}

export function buildContractorBrief(value, { address = '', goal = '', budget = null } = {}) {
  const state = validateSnapshot(value), review = reviewProject(state);
  return `CURBQUOTE / CONTRACTOR DISCUSSION BRIEF\nPrepared ${new Date().toISOString().slice(0, 10)}\n\nGoal: ${String(goal).slice(0, 1800) || 'Exterior renovation'}\nTarget budget: ${budget ? `$${budget.toLocaleString('en-US')}` : 'Not specified'}\n\n${buildEstimateSummary(estimateProject(state.inputs, state.options), { address, propertyData: state.propertyData })}\n\nDETAILS TO VERIFY\n${review.questions.length ? review.questions.map(question => `- ${question.message}`).join('\n') : '- Home details marked homeowner-confirmed; professional field verification is still required.'}\n\nQUESTIONS FOR THE CONTRACTOR\n- Verify dimensions, openings, substrate condition and access on site.\n- Itemize removal, disposal, trim, flashing, permits and taxes.\n- Provide product specifications, labor scope, warranty and written exclusions.\n- Confirm any lead-safe requirements and remediation allowances.\n\nNo appointment has been requested. No homeowner information has been sent to a contractor.`;
}
