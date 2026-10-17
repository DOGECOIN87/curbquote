import { DEFAULT_INPUT, estimateExterior } from './estimate.js';

const form = document.querySelector('#estimate-form');
const errorEl = document.querySelector('#form-error');
const addressEl = document.querySelector('#property-address');
const addressStatus = document.querySelector('#address-status');
const lookupButton = document.querySelector('#verify-address');
const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
let lastResult = null;
let verified = null;
let lookupSerial = 0;
const byId = id => document.getElementById(id);
const dollars = n => formatter.format(n);
const range = pair => `${dollars(pair[0])} – ${dollars(pair[1])}`;
function readInputs() {
  return Object.fromEntries(Object.keys(DEFAULT_INPUT).map(key => [key, form.elements.namedItem(key).value]));
}
function paintResult(result) {
  byId('empty-state').hidden = true;
  byId('results').hidden = false;
  byId('total-range').textContent = range(result.total);
  byId('siding-range').textContent = range(result.items.siding);
  byId('window-range').textContent = range(result.items.windows);
  byId('door-range').textContent = range(result.items.doors);
  byId('siding-qty').textContent = `${number.format(Math.ceil(result.geometry.sidingOrderSqFt / 100))} squares of siding (incl. waste)`;
  byId('window-qty').textContent = `${result.inputs.replaceWindows} window${result.inputs.replaceWindows === 1 ? '' : 's'} to replace`;
  byId('door-qty').textContent = `${result.inputs.replaceDoors} door${result.inputs.replaceDoors === 1 ? '' : 's'} to replace`;
  byId('perimeter').textContent = `${number.format(result.geometry.perimeterFt)} ft`;
  byId('gross-area').textContent = `${number.format(result.geometry.grossSqFt)} sq ft`;
  byId('net-area').textContent = `${number.format(result.geometry.sidingNetSqFt)} sq ft`;
  byId('order-area').textContent = `${number.format(result.geometry.sidingOrderSqFt)} sq ft`;
  byId('lead-notice').hidden = !result.leadPaintReview;
}
function calculate(scroll = false) {
  try {
    lastResult = estimateExterior(readInputs());
    errorEl.hidden = true;
    errorEl.textContent = '';
    paintResult(lastResult);
    if (scroll && matchMedia('(max-width: 920px)').matches) byId('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    lastResult = null;
    errorEl.textContent = error.message;
    errorEl.hidden = false;
    byId('results').hidden = true;
    byId('empty-state').hidden = false;
  }
}
form.addEventListener('submit', event => { event.preventDefault(); calculate(true); });
form.addEventListener('input', event => {
  if (event.target === addressEl) {
    lookupSerial++;
    verified = null;
    addressStatus.textContent = 'Address not verified. You can still estimate manually.';
    addressStatus.className = 'field-help';
    return;
  }
  if (lastResult) calculate();
});
lookupButton.addEventListener('click', async () => {
  const address = addressEl.value.trim();
  const serial = ++lookupSerial;
  lookupButton.disabled = true;
  addressStatus.className = 'field-help';
  addressStatus.textContent = 'Checking the Census address range…';
  try {
    const response = await fetch(`/api/geocode?${new URLSearchParams({ address })}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Address not found.');
    if (serial !== lookupSerial) return;
    verified = payload;
    addressStatus.textContent = `Approximate location matched: ${payload.matchedAddress}. This is not a building measurement or ownership check.`;
    addressStatus.className = 'field-help success';
  } catch (error) {
    if (serial !== lookupSerial) return;
    verified = null;
    addressStatus.textContent = `${error.message} You can estimate manually.`;
    addressStatus.className = 'field-help error';
  } finally { lookupButton.disabled = false; }
});

byId('save-summary').addEventListener('click', () => {
  if (!lastResult) return;
  const i = lastResult.inputs, g = lastResult.geometry;
  const lines = [
    'CURBQUOTE / PRELIMINARY ESTIMATE',
    'Generated: ' + new Date().toISOString(),
    'Address entered: ' + (addressEl.value.trim() || '(not provided)'),
    'Address match: ' + (verified?.matchedAddress || 'Not confirmed'),
    '',
    `Budget range: ${range(lastResult.total)}`,
    `Siding: ${range(lastResult.items.siding)}`,
    `Windows (${i.replaceWindows}): ${range(lastResult.items.windows)}`,
    `Doors (${i.replaceDoors}): ${range(lastResult.items.doors)}`,
    '',
    `Footprint: ${i.lengthFt} ft by ${i.widthFt} ft; ${i.stories} stories; ${i.storyHeightFt} ft/story`,
    `Gables: ${i.gables}; gable rise ${i.gableRiseFt} ft; masonry ${i.masonryPercent}%`,
    `Existing openings: ${i.existingWindows} windows, ${i.existingDoors} doors`,
    `Gross wall area: ${g.grossSqFt.toFixed(1)} sq ft; net siding: ${g.sidingNetSqFt.toFixed(1)} sq ft`,
    `Siding with 10% waste: ${g.sidingOrderSqFt.toFixed(1)} sq ft; illustrative variation ±18%`,
    `Pricing assumptions: siding $${i.sidingLowPerSqFt}–$${i.sidingHighPerSqFt}/sq ft; windows $${i.windowLowEach}–$${i.windowHighEach}/each; doors $${i.doorLowEach}–$${i.doorHighEach}/each`,
    `Year built: ${i.yearBuilt}${lastResult.leadPaintReview ? ' (review lead-safe renovation requirements)' : ''}`,
    '',
    'Illustrative estimate only. Not a professional quote. Excludes site conditions, permits, taxes, disposal, specialty trim, rot, lead-safe work and regional factors.',
    'Homeowner inputs not independently verified. Census address match is an approximate address-range location, not parcel/building data.'
  ];
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'curbquote-preliminary-estimate.txt';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
byId('print-summary').addEventListener('click', () => window.print());
