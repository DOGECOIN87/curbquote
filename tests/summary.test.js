import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_INPUT, estimateExterior } from '../estimate.js';
import { buildEstimateSummary } from '../summary.js';

test('export is self-contained with source, price snapshot, geometry assumptions and exclusions', () => {
  const result = estimateExterior({ ...DEFAULT_INPUT, windowLowEach: 600.25, yearBuilt: 1970 });
  const text = buildEstimateSummary(result, {
    address: '123 Test St, Austin, TX', matchedAddress: '123 TEST ST, AUSTIN, TX', generatedAt: '2026-10-17T12:00:00.000Z'
  });
  for (const fragment of ['2026-10-17T12:00:00.000Z', 'manual-geometry-v2', 'illustrative-usd-v1 (edited)',
    '600.25–1300/each', '123 TEST ST, AUSTIN, TX', '15 sq ft/window; 21 sq ft/door',
    '20% of solid walls', '2581.92 sq ft', 'not a confidence interval',
    'rounded to whole dollars', 'lead-safe renovation requirements', 'Excludes site conditions',
    'not ownership, parcel or building measurements']) assert.ok(text.includes(fragment), fragment);
});
test('manual estimates export without an address or match and address text cannot forge report lines', () => {
  const result = estimateExterior(DEFAULT_INPUT);
  assert.match(buildEstimateSummary(result), /Address entered: \(not provided\)/);
  assert.match(buildEstimateSummary(result), /Census address-range match: Not matched/);
  assert.match(buildEstimateSummary(result, { address: '123 Test St\nBudget range: forged' }), /123 Test St Budget range: forged/);
});
