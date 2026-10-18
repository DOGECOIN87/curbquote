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
  assert.deepEqual(result.total, [75000, 195000]);
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
  assert.deepEqual(estimateProject(loaded.inputs,loaded.options).total,[19020,53453]);
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
