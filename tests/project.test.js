import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_INPUT } from '../estimate.js';
import { DEFAULT_PROJECT, PRODUCTS, TIERS, catalogRates, estimateProject, validateProject } from '../project.js';
import { buildEstimateSummary } from '../summary.js';
import { readProjects, saveProject, deleteProject } from '../storage.js';

test('every material and quality tier produces finite, ordered illustrative ranges', () => {
  for (const tier of Object.keys(TIERS)) for (const sidingProduct of Object.keys(PRODUCTS.siding)) for (const windowProduct of Object.keys(PRODUCTS.windows)) for (const doorProduct of Object.keys(PRODUCTS.doors)) {
    const options = { ...DEFAULT_PROJECT, tier, sidingProduct, windowProduct, doorProduct };
    const result = estimateProject({ ...DEFAULT_INPUT, ...catalogRates(options) }, options);
    assert.equal(result.pricing.customized, false);
    assert.ok(Number.isFinite(result.total[0]) && result.total[0] <= result.total[1]);
  }
});
test('window-only scopes do not use missing dimensions or excluded replacement work', () => {
  const options = { ...DEFAULT_PROJECT, siding: false, doors: false };
  const result = estimateProject({ ...DEFAULT_INPUT, lengthFt: '', widthFt: '', existingWindows: 150, replaceWindows: 150, replaceDoors: 99 }, options);
  assert.deepEqual(result.items.siding, [0, 0]);
  assert.deepEqual(result.items.doors, [0, 0]);
  assert.deepEqual(result.total, [135000, 270000]);
  const summary = buildEstimateSummary(result);
  assert.match(summary, /Building geometry is not used/);
  assert.doesNotMatch(summary, /Footprint:/);
  assert.match(summary, /Selected projects: windows/);
});
test('partial siding scope changes only siding quantities and costs', () => {
  const full = estimateProject(DEFAULT_INPUT);
  const half = estimateProject(DEFAULT_INPUT, { ...DEFAULT_PROJECT, coveragePercent: 50 });
  assert.equal(half.geometry.sidingOrderSqFt, full.geometry.sidingOrderSqFt / 2);
  assert.deepEqual(half.items.windows, full.items.windows);
  assert.deepEqual(half.items.doors, full.items.doors);
  assert.equal(half.geometry.sidingNetSqFt, full.geometry.sidingNetSqFt / 2);
});
test('scope and product errors are rejected, while custom prices are labeled against the selected product', () => {
  for (const options of [{ siding:false,windows:false,doors:false },{ tier:'unknown' },{ sidingProduct:'__proto__' },{ coveragePercent:'' },{ coveragePercent:0 },{ coveragePercent:101 },{ coveragePercent:NaN },{ color:'red' }]) assert.throws(() => validateProject(options));
  const options = { ...DEFAULT_PROJECT, tier:'premium', windowProduct:'wood' };
  const result = estimateProject({ ...DEFAULT_INPUT, ...catalogRates(options), windowLowEach: 99 }, options);
  assert.equal(result.pricing.customized, true);
  assert.equal(result.inputs.windowLowEach, 99);
});
const memory = () => {
  const values = new Map();
  return { getItem:key => values.get(key) || null, setItem:(key,value) => values.set(key,value) };
};
const record = () => ({ id:'test-project-123', name:'My house', address:'123 Example St, Austin, TX', updatedAt:'2026-10-17T12:00:00Z', inputs:{...DEFAULT_INPUT},options:{...DEFAULT_PROJECT} });
test('saved projects survive a storage round trip and an edit replaces the existing record', () => {
  const storage = memory();
  saveProject(storage, record());
  const loaded = readProjects(storage)[0];
  assert.deepEqual(estimateProject(loaded.inputs,loaded.options).total,[28372,75933]);
  saveProject(storage,{...loaded,name:'Updated house'});
  assert.equal(readProjects(storage).length,1);
  assert.equal(readProjects(storage)[0].name,'Updated house');
  deleteProject(storage,loaded.id);
  assert.deepEqual(readProjects(storage),[]);
});
test('corrupt records and failed storage writes are reported, never silently saved', () => {
  const storage = memory();
  storage.setItem('curbquote.projects.v1','{broken');
  assert.throws(() => readProjects(storage),/could not be read/);
  assert.throws(() => saveProject(memory(),{...record(),options:{tier:'invalid'}}));
  assert.throws(() => saveProject({getItem:() => null,setItem:() => {throw new Error('Quota exceeded');}},record()),/Quota/);
});

test('roofing and gutters are optional, measured from the footprint and priced per square and per foot', () => {
  const base = { ...DEFAULT_INPUT, ...catalogRates({ ...DEFAULT_PROJECT, roofing: true, gutters: true }) };
  const without = estimateProject(base, DEFAULT_PROJECT);
  assert.equal('roofing' in without.items, false, 'off by default, so existing estimates do not change');
  const withBoth = estimateProject(base, { ...DEFAULT_PROJECT, roofing: true, gutters: true });
  // 48 x 34 ft with 1 ft eaves is 50 x 36 ft of plan; a 6 ft rise over a 17 ft run tilts it by about 6%.
  const plan = 50 * 36, slope = Math.sqrt(1 + (6 / 17) ** 2), squares = plan * slope * 1.12 / 100;
  assert.deepEqual(withBoth.items.roofing, [Math.round(squares * 0.88 * 550), Math.round(squares * 1.12 * 900)]);
  // A gabled roof drains along its two long sides, with an eave overhang at each end.
  assert.equal(withBoth.geometry.gutterFt, 2 * (48 + 2));
  assert.deepEqual(withBoth.items.gutters, [100 * 14, 100 * 26]);
  assert.equal(withBoth.total[0], without.total[0] + withBoth.items.roofing[0] + withBoth.items.gutters[0]);
  // A hipped roof (no gable ends) has gutters on every side.
  assert.equal(estimateProject({ ...base, gables: 0 }, { ...DEFAULT_PROJECT, gutters: true }).geometry.gutterFt, 2 * (48 + 34) + 8);
  // Roofing alone still uses the footprint, and old saved projects without roofing rates still open.
  const roofOnly = estimateProject(base, { ...DEFAULT_PROJECT, siding: false, windows: false, doors: false, roofing: true });
  assert.ok(roofOnly.total[0] > 0 && roofOnly.inputs.lengthFt === 48);
  const legacy = { ...DEFAULT_INPUT }; for (const key of ['roofLowPerSquare', 'roofHighPerSquare', 'gutterLowPerFt', 'gutterHighPerFt']) delete legacy[key];
  assert.deepEqual(estimateProject(legacy, DEFAULT_PROJECT).total, without.total);
  assert.equal(estimateProject(base, { ...DEFAULT_PROJECT, roofing: true, tier: 'premium' }).inputs.roofLowPerSquare, 550, 'rates come from the inputs; the tier sets them through catalogRates');
  assert.equal(catalogRates({ ...DEFAULT_PROJECT, tier: 'premium' }).roofLowPerSquare, 880);
});
