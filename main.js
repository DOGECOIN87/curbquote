import { DEFAULT_INPUT } from './estimate.js';
import { DEFAULT_PROJECT, COLORS, catalogRates, estimateProject } from './project.js';
import { readProjects, saveProject, deleteProject, savePhoto, loadPhoto, deletePhoto } from './storage.js';
import { PhotoEditor } from './photo-editor.js';
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
let selectedColor = DEFAULT_PROJECT.color;
let activeProjectId = null;
let projectLoadSerial = 0;
const editor = new PhotoEditor({ canvas: byId('photo-canvas'), input: byId('photo-upload'), status: byId('photo-status'), finish: byId('finish-area'), undo: byId('undo-area'), clear: byId('clear-areas'), download: byId('download-preview'), remove: byId('remove-photo') });
const projectDialog = byId('projects-dialog');
byId('photo-upload').addEventListener('change', () => { projectLoadSerial++; });
function projectOptions() {
  return {
    siding: byId('scope-siding').checked, windows: byId('scope-windows').checked, doors: byId('scope-doors').checked,
    sidingProduct: byId('sidingProduct').value, windowProduct: byId('windowProduct').value, doorProduct: byId('doorProduct').value,
    tier: form.querySelector('[name="tier"]:checked').value, coveragePercent: byId('coveragePercent').value, color: selectedColor
  };
}
function setCatalogRates() {
  // The options validator also checks scope; rates can still reset while scope is temporarily empty.
  const options = { ...projectOptions(), siding: true, coveragePercent: 100 };
  for (const [key, value] of Object.entries(catalogRates(options))) byId(key).value = value;
}
function syncProjectControls() {
  const p = projectOptions();
  for (const id of ['lengthFt','widthFt','stories','storyHeightFt','gables','gableRiseFt','masonryPercent','coveragePercent','sidingProduct']) byId(id).disabled = !p.siding;
  byId('replaceWindows').disabled = byId('windowProduct').disabled = !p.windows;
  byId('replaceDoors').disabled = byId('doorProduct').disabled = !p.doors;
  byId('house-wall-color').setAttribute('fill', COLORS[selectedColor].hex);
  byId('house-texture').setAttribute('fill', p.sidingProduct === 'engineered' ? 'url(#board-pattern)' : 'url(#lap-pattern)');
  byId('house-door-color').setAttribute('fill', { steel: '#294e51', fiberglass: '#8a6844', wood: '#603c2d' }[p.doorProduct]);
  byId('house-windows').setAttribute('stroke', p.windowProduct === 'wood' ? '#d3bc93' : '#f6f4e8');
  byId('color-name').textContent = COLORS[selectedColor].name;
  for (const button of document.querySelectorAll('[data-color]')) button.setAttribute('aria-pressed', String(button.dataset.color === selectedColor));
  editor.setColor(COLORS[selectedColor].hex);
}
function notify(message) { byId('project-toast').textContent = message; byId('project-toast').hidden = false; }


function readInputs() {
  return Object.fromEntries(Object.keys(DEFAULT_INPUT).map(key => [key, form.elements.namedItem(key).value]));
}
function refreshReport() {
  byId('print-report-content').textContent = lastResult ? buildEstimateSummary(lastResult, {
    address: addressEl.value.trim(), matchedAddress: matched?.matchedAddress, generatedAt
  }) : 'CURBQUOTE / No valid estimate\nReturn to the estimator and correct the home details before calculating or printing.';
  byId('save-summary').disabled = !lastResult;
  byId('print-summary').disabled = !lastResult;
  byId('save-project').disabled = !lastResult;
  byId('result-address').textContent = addressEl.value.trim() || 'No address provided — manual estimate';
}
function paintResult(result) {
  byId('empty-state').hidden = true;
  byId('results').hidden = false;
  byId('total-range').textContent = range(result.total);
  byId('siding-range').textContent = result.project.siding ? range(result.items.siding) : 'Not selected';
  byId('window-range').textContent = result.project.windows ? range(result.items.windows) : 'Not selected';
  byId('door-range').textContent = result.project.doors ? range(result.items.doors) : 'Not selected';
  byId('siding-qty').textContent = result.project.siding ? `${number.format(result.geometry.squares)} whole 100-sq-ft squares (reference)` : 'Excluded from this budget';
  byId('window-qty').textContent = result.project.windows ? `${result.inputs.replaceWindows} window${result.inputs.replaceWindows === 1 ? '' : 's'} to replace` : 'Excluded from this budget';
  byId('door-qty').textContent = result.project.doors ? `${result.inputs.replaceDoors} door${result.inputs.replaceDoors === 1 ? '' : 's'} to replace` : 'Excluded from this budget';
  byId('perimeter').textContent = `${number.format(result.geometry.perimeterFt)} ft`;
  byId('gross-area').textContent = `${number.format(result.geometry.grossSqFt)} sq ft`;
  byId('net-area').textContent = `${number.format(result.geometry.sidingNetSqFt)} sq ft`;
  byId('order-area').textContent = `${number.format(result.geometry.sidingOrderSqFt)} sq ft`;
  byId('lead-notice').hidden = !result.leadPaintReview;
  byId('geometry-details').hidden = byId('geometry-note').hidden = !result.project.siding;
  byId('selection-summary').textContent = `${result.productNames.tier} tier · ${['siding','windows','doors'].filter(key => result.project[key]).map(key => result.productNames[key]).join(' · ')}${result.project.siding ? ` · ${result.project.coveragePercent}% siding coverage` : ''}`;
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
    lastResult = estimateProject(readInputs(), projectOptions());
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
    invalidField = error.field ? form.elements.namedItem(error.field) || byId(error.field) : null;
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
  if (event.target.matches('#sidingProduct,#windowProduct,#doorProduct,[name="tier"]')) setCatalogRates();
  if (event.target.matches('[id^="scope-"]')) {
    const rates = catalogRates({ ...projectOptions(), siding: true, coveragePercent: 100 });
    if (event.target.checked) {
      const kind = event.target.id.slice(6), prefix = kind === 'windows' ? 'window' : kind === 'doors' ? 'door' : 'siding';
      for (const [key,value] of Object.entries(rates)) if (key.startsWith(prefix) && Number(byId(key).value) === 0) byId(key).value = value;
    }
  }
  syncProjectControls();
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
// Color changes update the illustration, marked photo areas and saved estimate context.
byId('color-picker').addEventListener('click', event => {
  const button = event.target.closest('[data-color]');
  if (!button) return;
  selectedColor = button.dataset.color;
  syncProjectControls();
  if (hasCalculated) calculate();
});
function showStudioTab(photo) {
  byId('illustration-panel').hidden = photo; byId('photo-panel').hidden = !photo;
  for (const [id, selected] of [['illustration-tab', !photo], ['photo-tab', photo]]) {
    byId(id).setAttribute('aria-selected', String(selected)); byId(id).tabIndex = selected ? 0 : -1;
  }
}
for (const id of ['illustration-tab','photo-tab']) {
  byId(id).addEventListener('click', () => showStudioTab(id === 'photo-tab'));
  byId(id).addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); const photo = event.key === 'End' || (event.key !== 'Home' && id === 'illustration-tab');
    showStudioTab(photo); byId(photo ? 'photo-tab' : 'illustration-tab').focus();
  });
}
function renderSavedProjects() {
  const container = byId('saved-project-list'); container.replaceChildren();
  let projects;
  try { projects = readProjects(window.localStorage); }
  catch (error) { byId('saved-project-status').textContent = error.message; return; }
  byId('project-count').textContent = projects.length;
  if (!projects.length) { const empty = document.createElement('p'); empty.className = 'empty-saved'; empty.textContent = 'No saved projects yet. Build an estimate, give it a name and save it here.'; container.append(empty); }
  for (const project of projects) {
    const card = document.createElement('article'); card.className = 'saved-project-card';
    const title = document.createElement('h3'); title.textContent = project.name; title.title = project.name;
    const address = document.createElement('p'); address.textContent = project.address || 'Manual project — no address entered';
    const detail = document.createElement('p');
    const estimate = estimateProject(project.inputs, project.options);
    detail.textContent = `${range(estimate.total)} · ${estimate.productNames.tier} · Saved ${new Date(project.updatedAt).toLocaleDateString()}`;
    const actions = document.createElement('div'); actions.className = 'saved-project-actions';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'outline-button'; open.textContent = 'Open project';
    open.addEventListener('click', () => restoreProject(project));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'outline-button'; remove.textContent = 'Delete';
    remove.addEventListener('click', async () => {
      if (remove.dataset.confirm !== 'yes') { remove.dataset.confirm = 'yes'; remove.textContent = 'Confirm delete'; return; }
      try {
        deleteProject(window.localStorage, project.id);
        if (activeProjectId === project.id) activeProjectId = null;
        try { await deletePhoto(project.id); } catch { notify('Estimate deleted. Browser photo storage was unavailable; clear site data to remove any remaining local photo.'); }
        renderSavedProjects();
      } catch (error) { byId('saved-project-status').textContent = error.message; }
    });
    actions.append(open, remove); card.append(title, address, detail, actions); container.append(card);
  }
}
function openProjectDialog() {
  byId('project-name').value = activeProjectId ? readProjects(window.localStorage).find(p => p.id === activeProjectId)?.name || '' : addressEl.value.trim().slice(0,80) || 'My exterior refresh';
  byId('saved-project-status').textContent = '';
  renderSavedProjects();
  if (!projectDialog.open) projectDialog.showModal();
}
byId('open-projects').addEventListener('click', () => { try { openProjectDialog(); } catch (error) { notify(error.message); } });
byId('save-project').addEventListener('click', () => { if (calculate({focus:true})) { try { openProjectDialog(); byId('project-name').focus(); } catch(error) { notify(error.message); } } });
byId('close-projects').addEventListener('click', () => projectDialog.close());
byId('save-project-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!calculate({focus:true})) { projectDialog.close(); return; }
  const name = byId('project-name').value.trim();
  if (!name) { byId('saved-project-status').textContent = 'Give your project a name.'; return; }
  const button = event.submitter; button.disabled = true;
  try {
    const project = { id: activeProjectId || crypto.randomUUID(), name, address: addressEl.value.trim(), updatedAt:new Date().toISOString(), inputs:readInputs(), options:projectOptions() };
    saveProject(window.localStorage, project); activeProjectId = project.id;
    let photoMessage = '';
    try { const photo = editor.snapshot(); if (photo) await savePhoto(project.id, photo); else await deletePhoto(project.id); }
    catch { photoMessage = ' The estimate is saved, but photo storage is unavailable.'; }
    renderSavedProjects(); projectDialog.close(); notify(`“${name}” saved on this device.${photoMessage}`);
  } catch (error) { byId('saved-project-status').textContent = `Project could not be saved: ${error.message}`; }
  finally { button.disabled = false; }
});
async function restoreProject(project) {
  const serial = ++projectLoadSerial;
  lookupSerial++; lookupController?.abort(); matched = null;
  lookupButton.disabled = false; lookupButton.removeAttribute('aria-busy');
  for (const [key,value] of Object.entries(project.inputs)) if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value;
  for (const kind of ['siding','windows','doors']) byId(`scope-${kind}`).checked = project.options[kind];
  for (const key of ['sidingProduct','windowProduct','doorProduct','coveragePercent']) byId(key).value = project.options[key];
  form.querySelector(`[name="tier"][value="${project.options.tier}"]`).checked = true;
  selectedColor = project.options.color; addressEl.value = project.address; activeProjectId = project.id;
  addressStatus.textContent = 'Saved address restored. Use Find address to request a fresh Census match.'; addressStatus.className = 'field-help';
  editor.reset(); syncProjectControls(); hasCalculated = true; calculate(); projectDialog.close();
  try { const photo = await loadPhoto(project.id); if (serial === projectLoadSerial && photo) { await editor.setPhoto(photo.blob,photo.areas); if (serial === projectLoadSerial) showStudioTab(true); } }
  catch { if (serial === projectLoadSerial) notify('Estimate restored. The saved photo could not be opened.'); }
  if (serial === projectLoadSerial) notify(`“${project.name}” restored.`);
}
byId('new-project').addEventListener('click', () => {
  projectLoadSerial++; lookupSerial++; lookupController?.abort(); matched = null; activeProjectId = null;
  lookupButton.disabled = false; lookupButton.removeAttribute('aria-busy');
  form.reset(); selectedColor = DEFAULT_PROJECT.color; addressEl.value = ''; editor.reset();
  addressStatus.textContent = 'Address lookup is optional. Census matching does not measure your home.'; addressStatus.className = 'field-help';
  setCatalogRates(); syncProjectControls(); hasCalculated = true; calculate(); showStudioTab(false); projectDialog.close(); notify('New project started with clearly labeled example measurements.');
});
window.addEventListener('storage', event => { if (event.key === 'curbquote.projects.v1') renderSavedProjects(); });
syncProjectControls(); renderSavedProjects(); hasCalculated = true; calculate();
