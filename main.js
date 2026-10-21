import { DEFAULT_INPUT } from './estimate.js';
import { DEFAULT_PROJECT, COLORS, PRODUCTS, TIERS, catalogRates, estimateProject } from './project.js';
import { readProjects, saveProject, deleteProject, savePhoto, loadPhoto, deletePhoto } from './storage.js';
import { PhotoEditor } from './photo-editor.js';
import { isAddressMatch, validateAddress, isAutomaticAddressReady } from './address.js';
import { buildEstimateSummary } from './summary.js';
import { setupAssistant } from './assistant-ui.js';
import { setupPropertyLookup } from './property-ui.js';
import { setupPropertyPreview } from './property-preview.js';
import { EXTERIOR_EXAMPLE } from './exterior-catalog.js';
import { STATIC_SITE } from './config.js';
import { lookupCensus } from './census-jsonp.js';
import { setupWizard } from './wizard.js';
import { setupRemodel3D } from './remodel-3d.js';
import { houseSpec, ROOF_COLORS, DEFAULT_DESIGN } from './house-spec.js';

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
let lookupTimer = null;
let addressComposing = false;
let invalidField = null;
let selectedColor = DEFAULT_PROJECT.color;
let activeProjectId = null;
let projectLoadSerial = 0;
let assistant;
let propertyLookup;
const wizard = setupWizard();
const propertyPreview = setupPropertyPreview({ onPhoto: () => {
  wizard.show(5); showStudioTab('photo'); byId('photo-tab').scrollIntoView({ block: 'center', behavior: 'instant' }); byId('photo-tab').focus();
} });
const editor = new PhotoEditor({ canvas: byId('photo-canvas'), input: byId('photo-upload'), status: byId('photo-status'), finish: byId('finish-area'), undo: byId('undo-area'), clear: byId('clear-areas'), download: byId('download-preview'), remove: byId('remove-photo') });
let remodelDesign = { ...DEFAULT_DESIGN };
let remodelState = 'idle';
const remodel = setupRemodel3D({
  stage: byId('remodel-stage'),
  getSpec: () => houseSpec(readInputs(), projectOptions(), remodelDesign),
  onStatus: message => { byId('remodel-status').textContent = message; },
  // The download button stays disabled until a rendered scene exists, instead of failing silently.
  onReady: () => { remodelState = 'ready'; byId('remodel-download').disabled = false; },
  onError: () => {
    remodelState = 'error'; byId('remodel-download').disabled = true;
    byId('remodel-placeholder-title').textContent = '3D could not start here';
    byId('remodel-placeholder-text').textContent = 'This device or browser could not open WebGL. The example home and your photo still work.';
  }
});
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
const exampleRate = (kind, product, unit) => {
  const low = PRODUCTS[kind][product].rates[0] * TIERS[projectOptions().tier].multiplier;
  const high = PRODUCTS[kind][product].rates[1] * TIERS[projectOptions().tier].multiplier;
  return `Example ${dollars(Math.round(low))}–${dollars(Math.round(high))} ${unit} installed`;
};
function paintChoiceHints() {
  const p = projectOptions();
  byId('siding-product-hint').textContent = p.siding ? `${exampleRate('siding', p.sidingProduct, 'per sq ft')} · ${TIERS[p.tier].name} tier` : 'Siding is switched off in step 2.';
  byId('window-product-hint').textContent = p.windows ? `${exampleRate('windows', p.windowProduct, 'each')} · ${TIERS[p.tier].name} tier` : 'Windows are switched off in step 2.';
  byId('door-product-hint').textContent = p.doors ? `${exampleRate('doors', p.doorProduct, 'each')} · ${TIERS[p.tier].name} tier` : 'Doors are switched off in step 2.';
}
function syncProjectControls() {
  const p = projectOptions();
  paintChoiceHints();
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
  remodel.refresh();
}
function syncRemodelControls() {
  byId('remodel-before').setAttribute('aria-pressed', String(remodelDesign.before));
  byId('remodel-after').setAttribute('aria-pressed', String(!remodelDesign.before));
  for (const id of ['add-porch', 'add-dormers', 'add-shutters']) byId(id).disabled = remodelDesign.before;
  for (const button of document.querySelectorAll('[data-roof]')) button.setAttribute('aria-pressed', String(button.dataset.roof === remodelDesign.roof));
  byId('roof-name').textContent = ROOF_COLORS[remodelDesign.roof].name;
  const additions = [['porch', 'covered porch'], ['dormers', 'dormers'], ['shutters', 'shutters']]
    .filter(([key]) => remodelDesign[key]).map(([, label]) => label);
  const p = projectOptions();
  byId('remodel-compare-note').textContent = remodelDesign.before
    ? `Before: the same house in a dated palette, with no porch, dormers or shutters.`
    : `After: ${p.siding ? `${COLORS[selectedColor].name} ${PRODUCTS.siding[p.sidingProduct].name.toLowerCase()}` : 'your siding choices'}, ${ROOF_COLORS[remodelDesign.roof].name.toLowerCase()}, ${p.windows ? PRODUCTS.windows[p.windowProduct].name.toLowerCase() : 'existing windows'}, ${p.doors ? PRODUCTS.doors[p.doorProduct].name.toLowerCase() : 'existing doors'}${additions.length ? `, ${additions.join(', ')}` : ', no additions'}.`;
  byId('remodel-download').disabled = remodelState !== 'ready';
}
function notify(message) { byId('project-toast').textContent = message; byId('project-toast').hidden = false; }


function readInputs() {
  return Object.fromEntries(Object.keys(DEFAULT_INPUT).map(key => [key, form.elements.namedItem(key).value]));
}
function refreshReport() {
  byId('print-report-content').textContent = lastResult ? buildEstimateSummary(lastResult, {
    address: addressEl.value.trim(), matchedAddress: matched?.matchedAddress, generatedAt, propertyData: propertyLookup?.context()
  }) : 'ALCO PRODUCTS / No valid estimate\nReturn to the estimator and correct the home details before calculating or printing.';
  byId('save-summary').disabled = !lastResult;
  byId('print-summary').disabled = !lastResult;
  byId('save-project').disabled = !lastResult;
  byId('result-address').textContent = addressEl.value.trim() || 'No address provided — manual estimate';
}
function paintLiveRange(text) {
  for (const node of document.querySelectorAll('[data-live-range]')) node.textContent = text;
}
function paintResult(result) {
  byId('empty-state').hidden = true;
  byId('results').hidden = false;
  byId('total-range').textContent = range(result.total);
  paintLiveRange(range(result.total));
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
  propertyLookup?.edited('stories'); propertyLookup?.edited('yearBuilt');
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
    if (scroll) wizard.show(5, { focus: true });
    return true;
  } catch (error) {
    lastResult = null;
    paintLiveRange('Needs a fix');
    errorEl.textContent = error.message;
    errorEl.hidden = false;
    byId('results').hidden = true;
    byId('empty-state').hidden = false;
    byId('result-status').textContent = 'Estimate unavailable. Correct the indicated home detail.';
    invalidField = error.field ? form.elements.namedItem(error.field) || byId(error.field) : null;
    if (invalidField) {
      invalidField.setAttribute('aria-invalid', 'true');
      invalidField.setAttribute('aria-errormessage', 'form-error');
      if (focus) { wizard.reveal(invalidField); invalidField.focus(); }
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
  propertyLookup?.edited(event.target.id);
  assistant?.changed(event.target.id);
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
function cancelAddressLookup() {
  clearTimeout(lookupTimer); lookupTimer = null;
  lookupSerial++; lookupController?.abort(); lookupController = null; matched = null;
  lookupButton.disabled = false; lookupButton.removeAttribute('aria-busy');
  propertyPreview.clear();
}
function scheduleAddressLookup() {
  if (addressComposing || !isAutomaticAddressReady(addressEl.value)) return;
  addressStatus.textContent = 'Address ready. Loading your property preview automatically…';
  lookupTimer = setTimeout(() => lookupAddress({ automatic: true }), 700);
}
function addressChanged() {
  cancelAddressLookup(); propertyLookup?.clear({ restoreInputs: true }); assistant?.changed('property-address');
  addressEl.removeAttribute('aria-invalid'); addressStatus.className = 'field-help';
  addressStatus.textContent = addressEl.value.trim() ? 'Keep typing your street, city and state or ZIP. Your property view will load automatically.' : 'Your property view loads as you type a complete U.S. address. Location is approximate.';
  refreshReport(); scheduleAddressLookup();
}
addressEl.addEventListener('input', addressChanged);
addressEl.addEventListener('compositionstart', () => { addressComposing = true; cancelAddressLookup(); });
addressEl.addEventListener('compositionend', () => { addressComposing = false; addressChanged(); });
addressEl.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.isComposing && !addressComposing) { event.preventDefault(); lookupAddress(); }
});
lookupButton.addEventListener('click', () => lookupAddress());
byId('exterior-example').addEventListener('click', () => {
  addressEl.value = EXTERIOR_EXAMPLE.matchedAddress;
  addressChanged(); cancelAddressLookup();
  matched = { matchedAddress: EXTERIOR_EXAMPLE.matchedAddress, coordinates: { ...EXTERIOR_EXAMPLE.coordinates }, source: EXTERIOR_EXAMPLE.source };
  propertyPreview.show(matched);
  addressStatus.className = 'field-help success';
  addressStatus.textContent = `Example: ${EXTERIOR_EXAMPLE.name}, Austin. This prototype model covers this address only. Enter your address to return to your property.`;
  refreshReport();
});
async function lookupAddress({ automatic = false } = {}) {
  clearTimeout(lookupTimer); lookupTimer = null;
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
  propertyPreview.searching();
  if (!automatic) propertyLookup?.lookup();
  try {
    let payload;
    // The static demo has no server, so it asks Census directly.
    if (STATIC_SITE) payload = await lookupCensus(address, controller.signal);
    else {
      const response = await fetch(`api/geocode?${new URLSearchParams({ address })}`, {
        headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal
      });
      try { payload = await response.json(); }
      catch { throw new Error('Address lookup returned an unreadable response. Try again or estimate manually.'); }
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Address lookup is unavailable. Try again or estimate manually.');
    }
    if (!isAddressMatch(payload)) throw new Error('Address lookup returned incomplete location data. Try again or estimate manually.');
    if (serial !== lookupSerial) return;
    matched = payload;
    propertyPreview.show(payload);
    if (automatic) propertyLookup?.lookup({ automatic: true });
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
    propertyPreview.failed(addressStatus.textContent);
    refreshReport();
  } finally {
    clearTimeout(timeout);
    if (serial === lookupSerial) {
      lookupButton.disabled = false;
      lookupButton.removeAttribute('aria-busy');
      lookupController = null;
    }
  }
}

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
  assistant?.changed('color');
});
const STUDIO_TABS = [['remodel', 'remodel-tab', 'remodel-panel'], ['illustration', 'illustration-tab', 'illustration-panel'], ['photo', 'photo-tab', 'photo-panel']];
function showStudioTab(tab) {
  const selected = tab === true ? 'photo' : tab === false ? 'illustration' : tab;
  for (const [name, tabId, panelId] of STUDIO_TABS) {
    const active = name === selected;
    byId(panelId).hidden = !active;
    byId(tabId).setAttribute('aria-selected', String(active)); byId(tabId).tabIndex = active ? 0 : -1;
  }
  if (selected === 'remodel') remodel.open(); else remodel.close();
}
for (const [name, tabId] of STUDIO_TABS.map(([n, t]) => [n, t])) {
  byId(tabId).addEventListener('click', () => showStudioTab(name));
  byId(tabId).addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const index = STUDIO_TABS.findIndex(([n]) => n === name);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? STUDIO_TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + STUDIO_TABS.length) % STUDIO_TABS.length;
    showStudioTab(STUDIO_TABS[next][0]); byId(STUDIO_TABS[next][1]).focus();
  });
}
byId('remodel-open').addEventListener('click', () => remodel.open());
/** Any "Preview in 3D" control lands on the estimate step with the studio on screen. */
function openStudio() {
  wizard.show(5, { focus: true });
  showStudioTab('remodel');
  requestAnimationFrame(() => {
    byId('remodel-stage').scrollIntoView({ block: 'center', behavior: 'instant' });
    byId('remodel-stage').setAttribute('tabindex', '-1');
    byId('remodel-stage').focus({ preventScroll: true });
  });
}
for (const button of document.querySelectorAll('[data-open-studio]')) button.addEventListener('click', openStudio);
byId('jump-to-3d').addEventListener('click', openStudio);
for (const [id, before] of [['remodel-before', true], ['remodel-after', false]]) byId(id).addEventListener('click', () => {
  remodelDesign.before = before; syncRemodelControls(); remodel.refresh();
  byId('remodel-status').textContent = before ? 'Before: the home as it stands, in a dated palette with no additions.' : 'After: your siding, materials and additions below.';
});
for (const button of document.querySelectorAll('[data-remodel-view]')) button.addEventListener('click', () => remodel.setView(button.dataset.remodelView));
byId('remodel-download').addEventListener('click', () => remodel.download());
byId('roof-picker').addEventListener('click', event => {
  const button = event.target.closest('[data-roof]'); if (!button) return;
  remodelDesign.roof = button.dataset.roof; syncRemodelControls(); remodel.refresh();
});
for (const [id, key] of [['add-porch', 'porch'], ['add-dormers', 'dormers'], ['add-shutters', 'shutters']]) byId(id).addEventListener('change', () => {
  remodelDesign[key] = byId(id).checked; remodel.refresh();
});
syncRemodelControls();
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
    const project = { id: activeProjectId || crypto.randomUUID(), name, address: addressEl.value.trim(), updatedAt:new Date().toISOString(), inputs:readInputs(), options:projectOptions(), planning: assistant?.metadata(), propertyData: propertyLookup?.context() };
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
  cancelAddressLookup();
  for (const [key,value] of Object.entries(project.inputs)) if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value;
  for (const kind of ['siding','windows','doors']) byId(`scope-${kind}`).checked = project.options[kind];
  for (const key of ['sidingProduct','windowProduct','doorProduct','coveragePercent']) byId(key).value = project.options[key];
  form.querySelector(`[name="tier"][value="${project.options.tier}"]`).checked = true;
  selectedColor = project.options.color; addressEl.value = project.address; activeProjectId = project.id;
  propertyLookup?.restore(project.propertyData);
  addressStatus.textContent = 'Saved address restored. Refreshing the aerial location…'; addressStatus.className = 'field-help';
  scheduleAddressLookup();
  editor.reset(); syncProjectControls(); hasCalculated = true; calculate(); projectDialog.close(); wizard.show(5);
  assistant?.restore(project.planning);
  try { const photo = await loadPhoto(project.id); if (serial === projectLoadSerial && photo) { await editor.setPhoto(photo.blob,photo.areas); if (serial === projectLoadSerial) showStudioTab('photo'); } }
  catch { if (serial === projectLoadSerial) notify('Estimate restored. The saved photo could not be opened.'); }
  if (serial === projectLoadSerial) notify(`“${project.name}” restored.`);
}
byId('new-project').addEventListener('click', () => {
  projectLoadSerial++; cancelAddressLookup(); activeProjectId = null;
  propertyLookup?.clear();
  lookupButton.disabled = false; lookupButton.removeAttribute('aria-busy');
  form.reset(); selectedColor = DEFAULT_PROJECT.color; addressEl.value = ''; editor.reset();
  addressStatus.textContent = 'Your property view loads as you type a complete U.S. address. Location is approximate.'; addressStatus.className = 'field-help';
  remodelDesign = { ...DEFAULT_DESIGN }; byId('add-porch').checked = byId('add-shutters').checked = true; byId('add-dormers').checked = false; syncRemodelControls();
  setCatalogRates(); syncProjectControls(); hasCalculated = true; calculate(); showStudioTab('remodel'); projectDialog.close(); wizard.show(1); notify('New project started with clearly labeled example measurements.');
  assistant?.restore();
});
window.addEventListener('storage', event => { if (event.key === 'curbquote.projects.v1') renderSavedProjects(); });
syncProjectControls(); renderSavedProjects(); hasCalculated = true; calculate();
assistant = setupAssistant({
  read: () => ({ inputs: readInputs(), options: projectOptions(), propertyData: propertyLookup?.context() }),
  getAddress: () => addressEl.value.trim(),
  focusField: field => { const input = byId(field); if (!input) return; wizard.reveal(input); input.scrollIntoView({ block: 'center', behavior: 'instant' }); input.focus(); },
  apply: snapshot => {
    for (const [key, value] of Object.entries(snapshot.inputs)) if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value;
    for (const kind of ['siding', 'windows', 'doors']) byId(`scope-${kind}`).checked = snapshot.options[kind];
    for (const key of ['sidingProduct', 'windowProduct', 'doorProduct', 'coveragePercent']) byId(key).value = snapshot.options[key];
    form.querySelector(`[name="tier"][value="${snapshot.options.tier}"]`).checked = true;
    selectedColor = snapshot.options.color;
    if (Object.hasOwn(snapshot, 'address')) {
      propertyLookup?.clear();
      cancelAddressLookup(); addressEl.value = snapshot.address;
      addressStatus.textContent = 'Address restored. Refreshing the aerial location…'; addressStatus.className = 'field-help';
      scheduleAddressLookup();
    }
    if (Object.hasOwn(snapshot, 'propertyData') || Object.hasOwn(snapshot, 'address')) propertyLookup?.restore(snapshot.propertyData);
    syncProjectControls(); hasCalculated = true; calculate();
  },
  applyLocation: location => {
    if (!isAddressMatch(location)) return;
    propertyLookup?.clear({ restoreInputs: true });
    cancelAddressLookup(); matched = location; addressEl.value = location.matchedAddress;
    propertyPreview.show(location);
    addressStatus.textContent = `Approximate Census location: ${location.matchedAddress}. No building measurement retrieved.`; addressStatus.className = 'field-help success'; refreshReport();
  },
  showProperty: payload => { if (payload?.record && typeof payload.address === 'string') propertyLookup?.show(payload.record, payload.address); }
});
propertyLookup = setupPropertyLookup({
  getAddress: () => addressEl.value.trim(), getInputs: readInputs,
  applyInputs: patch => {
    estimateProject({ ...readInputs(), ...patch }, projectOptions());
    for (const [field, value] of Object.entries(patch)) { byId(field).value = value; assistant?.changed(field); }
    hasCalculated = true; calculate();
  },
  onChange: () => { assistant?.changed(); refreshReport(); }
});
