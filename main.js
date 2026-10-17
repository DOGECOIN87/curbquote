import { DEFAULT_INPUT, estimateExterior } from './estimate.js';
import { isAddressMatch, validateAddress } from './address.js';
import { buildEstimateSummary } from './summary.js';

const form = document.querySelector('#estimate-form');
const errorEl = document.querySelector('#form-error');
const addressEl = document.querySelector('#property-address');
const addressStatus = document.querySelector('#address-status');
const lookupButton = document.querySelector('#verify-address');
const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const byId = id => document.getElementById(id);
const dollars = n => formatter.format(n);
const range = pair => `${dollars(pair[0])} – ${dollars(pair[1])}`;
let lastResult = null;
let hasCalculated = false;
let generatedAt = '';
let matched = null;
let lookupSerial = 0;
let lookupController = null;
let invalidField = null;

function readInputs() {
  return Object.fromEntries(Object.keys(DEFAULT_INPUT).map(key => [key, form.elements.namedItem(key).value]));
}
function refreshReport() {
  byId('print-report-content').textContent = lastResult ? buildEstimateSummary(lastResult, {
    address: addressEl.value.trim(), matchedAddress: matched?.matchedAddress, generatedAt
  }) : 'CURBQUOTE / No valid estimate\nReturn to the estimator and correct the home details before calculating or printing.';
  byId('save-summary').disabled = !lastResult;
  byId('print-summary').disabled = !lastResult;
  byId('result-address').textContent = addressEl.value.trim() || 'No address provided — manual estimate';
}
function paintResult(result) {
  byId('empty-state').hidden = true;
  byId('results').hidden = false;
  byId('total-range').textContent = range(result.total);
  byId('siding-range').textContent = range(result.items.siding);
  byId('window-range').textContent = range(result.items.windows);
  byId('door-range').textContent = range(result.items.doors);
  byId('siding-qty').textContent = `${number.format(result.geometry.squares)} whole 100-sq-ft squares (reference)`;
  byId('window-qty').textContent = `${result.inputs.replaceWindows} window${result.inputs.replaceWindows === 1 ? '' : 's'} to replace`;
  byId('door-qty').textContent = `${result.inputs.replaceDoors} door${result.inputs.replaceDoors === 1 ? '' : 's'} to replace`;
  byId('perimeter').textContent = `${number.format(result.geometry.perimeterFt)} ft`;
  byId('gross-area').textContent = `${number.format(result.geometry.grossSqFt)} sq ft`;
  byId('net-area').textContent = `${number.format(result.geometry.sidingNetSqFt)} sq ft`;
  byId('order-area').textContent = `${number.format(result.geometry.sidingOrderSqFt)} sq ft`;
  byId('lead-notice').hidden = !result.leadPaintReview;
  byId('pricing-source').textContent = `${result.pricing.version}${result.pricing.customized ? ' · edited example rates' : ' · example rates'} · ${result.modelVersion}`;
  refreshReport();
}
function calculate({ scroll = false, focus = false } = {}) {
  if (invalidField) {
    invalidField.removeAttribute('aria-invalid');
    invalidField.removeAttribute('aria-errormessage');
    invalidField = null;
  }
  try {
    lastResult = estimateExterior(readInputs());
    generatedAt = new Date().toISOString();
    errorEl.hidden = true;
    errorEl.textContent = '';
    paintResult(lastResult);
    byId('result-status').textContent = `Preliminary estimate updated: ${range(lastResult.total)}. Illustrative pricing.`;
    if (scroll && matchMedia('(max-width: 920px)').matches) {
      byId('results').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    }
    return true;
  } catch (error) {
    lastResult = null;
    errorEl.textContent = error.message;
    errorEl.hidden = false;
    byId('results').hidden = true;
    byId('empty-state').hidden = false;
    byId('result-status').textContent = 'Estimate unavailable. Correct the indicated home detail.';
    invalidField = error.field ? form.elements.namedItem(error.field) : null;
    if (invalidField) {
      invalidField.setAttribute('aria-invalid', 'true');
      invalidField.setAttribute('aria-errormessage', 'form-error');
      if (focus) {
        const details = invalidField.closest('details');
        if (details) details.open = true;
        invalidField.focus();
      }
    }
    refreshReport();
    return false;
  }
}
form.addEventListener('submit', event => {
  event.preventDefault();
  hasCalculated = true;
  calculate({ scroll: true, focus: true });
});
form.addEventListener('input', event => {
  if (event.target === addressEl) {
    lookupSerial++;
    lookupController?.abort();
    matched = null;
    lookupButton.disabled = false;
    lookupButton.removeAttribute('aria-busy');
    addressEl.removeAttribute('aria-invalid');
    addressStatus.textContent = 'Address not matched. You can still estimate manually.';
    addressStatus.className = 'field-help';
    refreshReport();
    return;
  }
  // Keep recalculating after invalid edits so correcting a field restores the results.
  if (hasCalculated) calculate();
});
lookupButton.addEventListener('click', async () => {
  let address;
  try { address = validateAddress(addressEl.value); }
  catch (error) {
    addressStatus.textContent = error.message;
    addressStatus.className = 'field-help error';
    addressEl.setAttribute('aria-invalid', 'true');
    addressEl.focus();
    return;
  }
  const serial = ++lookupSerial;
  lookupController?.abort();
  const controller = new AbortController();
  lookupController = controller;
  const timeout = setTimeout(() => controller.abort(), 9000);
  matched = null;
  refreshReport();
  lookupButton.disabled = true;
  lookupButton.setAttribute('aria-busy', 'true');
  addressEl.removeAttribute('aria-invalid');
  addressStatus.className = 'field-help';
  addressStatus.textContent = 'Checking the Census address range…';
  try {
    const response = await fetch(`/api/geocode?${new URLSearchParams({ address })}`, {
      headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal
    });
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error('Address lookup returned an unreadable response. Try again or estimate manually.'); }
    if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Address lookup is unavailable. Try again or estimate manually.');
    if (!isAddressMatch(payload)) throw new Error('Address lookup returned incomplete location data. Try again or estimate manually.');
    if (serial !== lookupSerial) return;
    matched = payload;
    addressStatus.textContent = `Approximate location matched: ${payload.matchedAddress}. This is not a building measurement or ownership check.`;
    addressStatus.className = 'field-help success';
    refreshReport();
  } catch (error) {
    if (serial !== lookupSerial) return;
    matched = null;
    addressStatus.textContent = controller.signal.aborted
      ? 'Address lookup timed out. You can still estimate manually.'
      : error instanceof TypeError ? 'Address lookup could not connect. You can still estimate manually.' : error.message;
    addressStatus.className = 'field-help error';
    refreshReport();
  } finally {
    clearTimeout(timeout);
    if (serial === lookupSerial) {
      lookupButton.disabled = false;
      lookupButton.removeAttribute('aria-busy');
      lookupController = null;
    }
  }
});

byId('save-summary').addEventListener('click', () => {
  if (!calculate({ focus: true })) return;
  const blob = new Blob([byId('print-report-content').textContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'curbquote-preliminary-estimate.txt';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
byId('print-summary').addEventListener('click', () => {
  if (calculate({ focus: true })) window.print();
});
// Browser-menu printing must also validate the current fields and never expose stale costs.
window.addEventListener('beforeprint', () => { if (hasCalculated) calculate(); else refreshReport(); });
refreshReport();
