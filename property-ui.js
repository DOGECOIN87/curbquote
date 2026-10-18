import { STATIC_SITE } from './config.js';
import { DEFAULT_INPUT } from './estimate.js';
import { validateAddress } from './address.js';
import { PROPERTY_FIELDS, canImportProperty, propertySuggestions, validatePropertyRecord, validatePropertyContext } from './property-data.js';

const byId = id => document.getElementById(id);
const node = (tag, text, className) => { const element = document.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element; };
const sameAddress = (a, b) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

export function setupPropertyLookup({ getAddress, getInputs, applyInputs, onChange }) {
  let serial = 0, controller = null, pending = null, context, expiryTimer;
  const status = text => { byId('property-status').textContent = text; };
  function sourceNote() {
    byId('property-applied').hidden = !context;
    const original = context ? propertySuggestions(context) : {};
    byId('property-applied-note').textContent = context ? [`${context.source.provider} · Retrieved ${new Date(context.source.retrievedAt).toLocaleDateString()}`, ...context.appliedFields.map(field => `${field === 'stories' ? 'Stories' : 'Year built'}: source reported ${original[field]}${context.corrections[field] ? `; homeowner correction ${context.corrections[field].value}` : '; please verify'}`)].join('\n') : '';
    for (const field of ['stories', 'yearBuilt']) {
      document.getElementById(`source-${field}`)?.remove();
      if (!context?.appliedFields.includes(field)) continue;
      const note = node('span', `${context.corrections[field] ? 'Homeowner correction; original source retained' : `From ${context.source.provider}; please verify`}`, 'input-source');
      note.id = `source-${field}`; byId(field).after(note);
    }
  }
  function cancel() { serial++; controller?.abort(); controller = null; clearTimeout(expiryTimer); }
  function clear({ restoreInputs = false } = {}) {
    cancel(); pending = null; byId('property-record').hidden = true;
    byId('property-facts').replaceChildren(); byId('property-source').textContent = ''; byId('property-permissions').textContent = ''; byId('property-warnings').replaceChildren();
    byId('property-fields').querySelectorAll('label').forEach(element => element.remove()); byId('property-identity').checked = false; syncApply();
    const previous = context;
    context = undefined; sourceNote();
    if (restoreInputs && previous) applyInputs(Object.fromEntries(previous.appliedFields.map(field => [field, previous.previousInputs?.[field] ?? DEFAULT_INPUT[field]])));
    status('No property record attached. Find the address to request authorized facts.');
    if (previous) onChange();
  }
  function expire() {
    if (!pending?.record.source.expiresAt) return;
    const remaining = Date.parse(pending.record.source.expiresAt) - Date.now();
    if (remaining <= 0) { clear(); status('This property record expired and was cleared. Request a fresh lookup.'); }
    else expiryTimer = setTimeout(expire, Math.min(remaining + 1, 2147483647));
  }
  function syncApply() {
    byId('apply-property').disabled = !pending || !canImportProperty(pending.record.source) || !pending.record.facts.address || !byId('property-identity').checked || !byId('property-fields').querySelector('input:checked');
  }
  function show(value, address = getAddress()) {
    const record = validatePropertyRecord(value);
    if (!sameAddress(address, getAddress())) return;
    cancel(); pending = { record, address };
    byId('property-record').hidden = false; byId('property-identity').checked = false;
    const source = record.source;
    byId('property-source').textContent = `${source.provider} · Retrieved ${new Date(source.retrievedAt).toLocaleString()} · Source updated ${source.sourceUpdatedAt ? new Date(source.sourceUpdatedAt).toLocaleDateString() : 'not reported'}`;
    const facts = byId('property-facts'); facts.replaceChildren();
    for (const [field, value] of Object.entries(record.facts)) {
      const row = node('div'); const suffix = ['living_area_sqft', 'lot_area_sqft'].includes(field) ? ' sq ft' : '';
      row.append(node('dt', PROPERTY_FIELDS[field][0]), node('dd', `${typeof value === 'number' ? value.toLocaleString('en-US') : value}${suffix}`)); facts.append(row);
    }
    const compatible = canImportProperty(source), suggestions = propertySuggestions(record);
    byId('property-permissions').textContent = compatible ? 'These details can be saved with your estimate. Please verify any imported values.' : 'Display only: this source restricts saving, export, AI use or retention. Its facts cannot be copied into this estimate.';
    byId('property-import-controls').hidden = !compatible || !record.facts.address || !Object.keys(suggestions).length;
    const picker = byId('property-fields'); picker.querySelectorAll('label').forEach(element => element.remove());
    for (const [field, value] of Object.entries(suggestions)) {
      const label = node('label'), input = document.createElement('input'); input.type = 'checkbox'; input.value = field; input.checked = true;
      label.append(input, node('span', `${field === 'stories' ? 'Stories' : 'Year built'}: ${value} (currently ${getInputs()[field]})`)); picker.append(label);
    }
    const warnings = byId('property-warnings'); warnings.replaceChildren(...record.warnings.map(text => node('li', text)));
    if (!Object.keys(suggestions).length) warnings.append(node('li', 'No compatible story count or year was returned. Other facts are reference information only.'));
    syncApply(); expire(); status('Property record returned. Check the address and source details before using it.');
  }
  async function lookup({ automatic = false } = {}) {
    let address; try { address = validateAddress(getAddress()); } catch { return; }
    if (automatic) {
      const before = serial;
      await availability;
      if (!configured || before !== serial || !sameAddress(address, getAddress())) return;
    }
    if (STATIC_SITE) { if (!automatic) status('Licensed property data needs the hosted version. Enter home details manually.'); return; }
    cancel(); pending = null; byId('property-record').hidden = true;
    const requestSerial = serial, abort = new AbortController(); controller = abort;
    const deadline = setTimeout(() => abort.abort(), 8500);
    status('Checking the authorized property source…');
    try {
      const response = await fetch('api/property', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ address, purpose: 'estimate' }), signal: abort.signal, cache: 'no-store' });
      const payload = await response.json();
      if (requestSerial !== serial || !sameAddress(address, getAddress())) return;
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Property data is unavailable. Enter home details manually.');
      show(payload, address);
    } catch (error) {
      if (requestSerial !== serial) return;
      status(abort.signal.aborted ? 'Property lookup timed out. You can still enter details manually.' : error instanceof TypeError || error instanceof SyntaxError ? 'Property data could not be read. You can still estimate manually.' : error.message);
    } finally { clearTimeout(deadline); if (controller === abort) controller = null; }
  }
  byId('property-identity').addEventListener('change', syncApply);
  byId('property-fields').addEventListener('change', syncApply);
  byId('apply-property').addEventListener('click', () => {
    try {
      if (!pending || !sameAddress(pending.address, getAddress()) || !byId('property-identity').checked) throw new Error('Check that the returned record is your property.');
      const record = validatePropertyRecord(pending.record);
      if (!canImportProperty(record.source) || !record.facts.address) throw new Error('This source is limited to display.');
      const inputs = propertySuggestions(record), fields = [...byId('property-fields').querySelectorAll('input:checked')].map(input => input.value).filter(field => Object.hasOwn(inputs, field));
      if (!fields.length) throw new Error('Select at least one supported detail.');
      const previous = getInputs();
      const candidate = validatePropertyContext({ ...record, lookupAddress: pending.address, appliedFields: fields, corrections: {}, previousInputs: Object.fromEntries(fields.map(field => [field, Number(context?.previousInputs?.[field] ?? previous[field])])) });
      applyInputs(Object.fromEntries(fields.map(field => [field, inputs[field]])));
      context = candidate; sourceNote(); onChange(); status('Selected source details applied and labeled. Review the remaining homeowner measurements; exterior dimensions were not inferred.');
    } catch (error) { status(error.message); }
  });
  byId('undo-property').addEventListener('click', () => { clear({ restoreInputs: true }); status('Imported details undone. Previous inputs restored.'); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) expire(); });
  const initialSerial = serial;
  let configured = false;
  const availability = (STATIC_SITE ? Promise.resolve({ configured: false, reason: 'This demo has no licensed property source. Census location matching and manual inputs are available.' }) : fetch('api/property', { cache: 'no-store', signal: AbortSignal.timeout(5000) }).then(response => response.json())).then(value => { configured = value.configured === true; if (initialSerial === serial && !pending && !context && typeof value.reason === 'string') status(value.reason); }).catch(() => {});
  return {
    lookup, show, clear,
    context: () => context ? validatePropertyContext(context) : undefined,
    edited: field => {
      if (!context?.appliedFields.includes(field)) return;
      const value = Number(getInputs()[field]), original = propertySuggestions(context)[field];
      if (value === original) delete context.corrections[field];
      else if (Number.isInteger(value) && context.corrections[field]?.value !== value && (field === 'stories' ? value >= 1 && value <= 4 : value >= 1700 && value <= 2100)) context.corrections[field] = { value, updatedAt: new Date().toISOString(), actor: 'homeowner' };
      sourceNote();
    },
    restore: value => { clear(); if (!value) return; const valid = validatePropertyContext(value); if (!sameAddress(valid.lookupAddress, getAddress())) return; context = valid; sourceNote(); status('Saved source attribution restored. Use Find property for fresh property facts.'); }
  };
}
