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
import { houseSpecFromStyle, resolveHomeStyle, modelGuardrailLabel, styleSilhouette, ROOF_COLORS, ROOF_MATERIALS, TRIM_COLORS, MASONRY_FINISHES, SCENES, DEFAULT_DESIGN } from './house-spec.js';
import { fetchPublicFootprint } from './footprint-client.js';

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
let selectedHomeStyle = DEFAULT_PROJECT.homeStyle;
let manualStyleOverride = false;
let footprintData = null;
let manualInputsBackup = null;
let footprintController = null;
let activeProjectId = null;
let projectLoadSerial = 0;
let assistant;
let propertyLookup;
let remodel;
const wizard = setupWizard({
  onChange: step => {
    if (!remodel) return;
    if ((step === 3 || step === 4) && byId('step3-3d-stage')) remodel.attach(byId('step3-3d-stage'));
    else if (step === 5) remodel.attach(byId('remodel-stage'));
  }
});
const propertyPreview = setupPropertyPreview({ onPhoto: () => {
  wizard.show(5); showStudioTab('photo'); byId('photo-tab').scrollIntoView({ block: 'center', behavior: 'instant' }); byId('photo-tab').focus();
} });
const editor = new PhotoEditor({ canvas: byId('photo-canvas'), input: byId('photo-upload'), status: byId('photo-status'), finish: byId('finish-area'), undo: byId('undo-area'), clear: byId('clear-areas'), download: byId('download-preview'), remove: byId('remove-photo') });
let remodelDesign = { ...DEFAULT_DESIGN, split: 100 };
const ADDITIONS = [['add-porch', 'porch'], ['add-dormers', 'dormers'], ['add-shutters', 'shutters'], ['add-garage', 'garage'], ['add-fence', 'fence']];
const DESIGN_PICKERS = [['roof', 'roof', ROOF_COLORS], ['roof-material', 'roofMaterial', ROOF_MATERIALS], ['trim', 'trim', TRIM_COLORS], ['masonry', 'masonry', MASONRY_FINISHES], ['scene', 'scene', SCENES]];
// Each style card gets a small front-elevation drawing built from the style's own proportions.
for (const card of document.querySelectorAll('[data-archetype]')) {
  const svgNS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(svgNS, 'svg'), parts = styleSilhouette(card.dataset.archetype);
  svg.setAttribute('viewBox', '0 0 96 56'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'style-art');
  for (const [key, cls] of [['body', 'art-body'], ['roof', 'art-roof'], ['windows', 'art-window'], ['door', 'art-door'], ['porch', 'art-porch']]) {
    if (!parts[key]) continue;
    const path = document.createElementNS(svgNS, 'path'); path.setAttribute('d', parts[key]); path.setAttribute('class', cls); svg.append(path);
  }
  const ground = document.createElementNS(svgNS, 'path'); ground.setAttribute('d', 'M4 52.5H92'); ground.setAttribute('class', 'art-ground'); svg.prepend(ground);
  card.prepend(svg);
}
let remodelState = 'idle';
remodel = setupRemodel3D({
  stage: byId('remodel-stage'),
  previewStage: byId('step3-3d-stage'),
  getSpec: beforeOverride => houseSpecFromStyle(
    readInputs(),
    selectedHomeStyle,
    footprintData,
    projectOptions(),
    typeof beforeOverride === 'boolean' ? { ...remodelDesign, before: beforeOverride } : remodelDesign
  ),
  onStatus: message => {
    byId('remodel-status').textContent = message;
    if (byId('step3-3d-status')) byId('step3-3d-status').textContent = message;
  },
  onSplitChange: (split, state) => reflectCanvasSplit(split, state),
  onOrbitChange: on => byId('remodel-orbit')?.setAttribute('aria-pressed', String(on)),
  // The download button stays disabled until a rendered scene exists, instead of failing silently.
  onReady: () => { remodelState = 'ready'; byId('remodel-download').disabled = false; },
  onError: () => {
    remodelState = 'error'; byId('remodel-download').disabled = true;
    byId('remodel-placeholder-title').textContent = '3D could not start here';
    byId('remodel-placeholder-text').textContent = 'This device or browser could not open WebGL. The example home and your photo still work.';
    if (byId('step3-placeholder-title')) {
      byId('step3-placeholder-title').textContent = '3D could not start here';
      byId('step3-placeholder-text').textContent = 'This device or browser could not open WebGL. Your estimate still works normally.';
    }
  }
});
const projectDialog = byId('projects-dialog');
byId('photo-upload').addEventListener('change', () => { projectLoadSerial++; });
function projectOptions() {
  return {
    siding: byId('scope-siding').checked, windows: byId('scope-windows').checked, doors: byId('scope-doors').checked,
    sidingProduct: byId('sidingProduct').value, windowProduct: byId('windowProduct').value, doorProduct: byId('doorProduct').value,
    tier: form.querySelector('[name="tier"]:checked').value, coveragePercent: byId('coveragePercent').value, color: selectedColor,
    homeStyle: selectedHomeStyle
  };
}
function setCatalogRates() {
  // The options validator also checks scope; rates can still reset while scope is temporarily empty.
  const options = { ...projectOptions(), siding: true, coveragePercent: 100 };
  for (const [key, value] of Object.entries(catalogRates(options))) byId(key).value = value;
}
function areRatesCustomized() {
  const expected = catalogRates({ ...projectOptions(), siding: true, coveragePercent: 100 });
  return Object.entries(expected).some(([key, value]) => Number(byId(key).value) !== Number(value));
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
  byId('choice-field-siding')?.classList.toggle('is-excluded', !p.siding);
  byId('choice-field-windows')?.classList.toggle('is-excluded', !p.windows);
  byId('choice-field-doors')?.classList.toggle('is-excluded', !p.doors);
  const customized = areRatesCustomized();
  if (byId('price-details-summary')) {
    const cov = p.siding ? `${byId('coveragePercent').value || 100}% coverage` : 'siding off';
    byId('price-details-summary').textContent = `${cov} · ${customized ? 'edited rates' : 'catalog rates'} ⌄`;
  }
  if (byId('reset-rates')) byId('reset-rates').disabled = !customized;
}
function syncProjectControls({ microResponse = false } = {}) {
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
  for (const card of document.querySelectorAll('[data-archetype]')) card.setAttribute('aria-pressed', String(card.dataset.archetype === selectedHomeStyle));
  const badgeText = modelGuardrailLabel(footprintData);
  if (byId('step3-studio-badge')) byId('step3-studio-badge').textContent = badgeText;
  if (byId('studio-model-badge')) byId('studio-model-badge').textContent = badgeText;
  if (byId('footprint-source-pill')) {
    byId('footprint-source-pill').textContent = footprintData?.source?.provider || 'Manual dimensions';
  }
  if (byId('clear-footprint')) byId('clear-footprint').hidden = !footprintData;
  editor.setColor(COLORS[selectedColor].hex);
  const currentSpec = houseSpecFromStyle(readInputs(), selectedHomeStyle, footprintData, p, remodelDesign);
  if (byId('step3-3d-status') && !remodel.isOpen) byId('step3-3d-status').textContent = `${currentSpec.label}. Updates live as you type.`;
  byId('dock-pill-siding')?.classList.toggle('is-active', p.siding);
  byId('dock-pill-windows')?.classList.toggle('is-active', p.windows);
  byId('dock-pill-doors')?.classList.toggle('is-active', p.doors);
  if (byId('dock-scope-summary')) {
    const active = [['siding', 'Siding'], ['windows', 'windows'], ['doors', 'doors']].filter(([k]) => p[k]).map(([, label]) => label);
    byId('dock-scope-summary').textContent = active.length ? `${active.join(', ')} included` : 'Choose at least one trade';
  }
  if (byId('dock-choice-readout')) {
    byId('dock-choice-readout').textContent = `${resolveHomeStyle(selectedHomeStyle).name} · ${COLORS[selectedColor].name} ${PRODUCTS.siding[p.sidingProduct].name.toLowerCase()} · ${TIERS[p.tier].name} tier · ${ROOF_COLORS[remodelDesign.roof].name} ${ROOF_MATERIALS[remodelDesign.roofMaterial].name.toLowerCase()}`;
  }
  syncRemodelControls();
  remodel.refresh({ microResponse });
}
function syncRemodelControls() {
  const split = remodelDesign.before ? 0 : (remodelDesign.split ?? 100);
  for (const stage of [byId('step3-3d-stage'), byId('remodel-stage')]) {
    if (split > 0 && split < 100) stage.dataset.splitActive = 'true';
    else delete stage.dataset.splitActive;
  }
  byId('remodel-before').setAttribute('aria-pressed', String(split === 0));
  byId('remodel-after').setAttribute('aria-pressed', String(split === 100));
  if (byId('remodel-split-half')) byId('remodel-split-half').setAttribute('aria-pressed', String(split === 50));
  for (const button of document.querySelectorAll('[data-dock-split]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.dockSplit) === split));
  }
  if (byId('remodel-split')) byId('remodel-split').value = String(split);
  if (byId('remodel-split-readout')) {
    byId('remodel-split-readout').textContent = split === 0 ? 'Before (100%)' : split === 100 ? 'After (100%)' : `${100 - split}% Before · ${split}% After`;
  }
  for (const id of ADDITIONS.map(([id]) => id)) byId(id).disabled = split === 0;
  for (const [attr, key] of DESIGN_PICKERS) for (const button of document.querySelectorAll(`[data-${attr}]`)) button.setAttribute('aria-pressed', String(button.dataset[attr.replace(/-(\w)/g, (_, c) => c.toUpperCase())] === remodelDesign[key]));
  byId('roof-name').textContent = `${ROOF_COLORS[remodelDesign.roof].name} ${ROOF_MATERIALS[remodelDesign.roofMaterial].name.toLowerCase()}`;
  if (byId('trim-name')) byId('trim-name').textContent = TRIM_COLORS[remodelDesign.trim].name;
  const additions = [['porch', 'covered porch'], ['dormers', 'dormers'], ['shutters', 'shutters'], ['garage', 'garage'], ['fence', 'picket fence']]
    .filter(([key]) => remodelDesign[key]).map(([, label]) => label);
  const p = projectOptions();
  if (byId('dock-choice-readout')) {
    byId('dock-choice-readout').textContent = `${resolveHomeStyle(selectedHomeStyle).name} · ${COLORS[selectedColor].name} ${PRODUCTS.siding[p.sidingProduct].name.toLowerCase()} · ${TIERS[p.tier].name} tier · ${ROOF_COLORS[remodelDesign.roof].name} ${ROOF_MATERIALS[remodelDesign.roofMaterial].name.toLowerCase()}`;
  }
  const afterDesc = `${p.siding ? `${COLORS[selectedColor].name} ${PRODUCTS.siding[p.sidingProduct].name.toLowerCase()}` : 'your siding choices'}, ${`${ROOF_COLORS[remodelDesign.roof].name} ${ROOF_MATERIALS[remodelDesign.roofMaterial].name.toLowerCase()}`.toLowerCase()} roof, ${p.windows ? PRODUCTS.windows[p.windowProduct].name.toLowerCase() : 'existing windows'}, ${p.doors ? PRODUCTS.doors[p.doorProduct].name.toLowerCase() : 'existing doors'}${additions.length ? `, ${additions.join(', ')}` : ', no additions'}`;
  byId('remodel-compare-note').textContent = split === 0
    ? `Before: the same house in a dated palette, with no porch, dormers, shutters, garage or fence.`
    : split === 100
    ? `After: ${afterDesc}.`
    : `Split comparison (${100 - split}% Before on left, ${split}% After on right): comparing the dated palette against ${afterDesc}.`;
  byId('remodel-download').disabled = remodelState !== 'ready';
}
function reflectCanvasSplit(value, { commit = false } = {}) {
  const split = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  remodelDesign.split = split;
  remodelDesign.before = split === 0;
  syncRemodelControls();
  if (commit) {
    const message = split === 0
      ? 'Before: the home as it stands, in a dated palette with no additions.'
      : split === 100
      ? 'After: your siding, materials and additions below.'
      : `Split comparison: ${100 - split}% Before on left, ${split}% After on right.`;
    byId('remodel-status').textContent = message;
    if (byId('step3-3d-status')) byId('step3-3d-status').textContent = message;
  }
}
function notify(message) { byId('project-toast').textContent = message; byId('project-toast').hidden = false; }


function readInputs() {
  return Object.fromEntries(Object.keys(DEFAULT_INPUT).map(key => [key, form.elements.namedItem(key).value]));
}
function refreshReport() {
  byId('print-report-content').textContent = lastResult ? buildEstimateSummary(lastResult, {
    address: addressEl.value.trim(), matchedAddress: matched?.matchedAddress, generatedAt, propertyData: propertyLookup?.context(), footprintData
  }) : 'ALCO PRODUCTS / No valid estimate\nReturn to the estimator and correct the home details before calculating or printing.';
  byId('save-summary').disabled = !lastResult;
  byId('print-summary').disabled = !lastResult;
  byId('save-project').disabled = !lastResult;
  byId('result-address').textContent = addressEl.value.trim() || 'No address provided — manual estimate';
}
let lastRangeText = '';
let pulseTimer = null;
function paintLiveRange(text) {
  const changed = Boolean(lastRangeText && lastRangeText !== text);
  lastRangeText = text;
  const nodes = [...document.querySelectorAll('[data-live-range]'), byId('total-range')].filter(Boolean);
  for (const node of document.querySelectorAll('[data-live-range]')) node.textContent = text;
  if (changed) {
    clearTimeout(pulseTimer);
    for (const node of nodes) node.dataset.pulse = 'true';
    pulseTimer = setTimeout(() => { for (const node of nodes) delete node.dataset.pulse; }, 360);
  }
}
const COST_TRADES = [
  { key: 'siding', label: 'Siding' },
  { key: 'windows', label: 'Windows' },
  { key: 'doors', label: 'Doors' }
];
function paintCostShares(result) {
  const amounts = COST_TRADES.map(({ key }) => {
    const pair = result?.items?.[key] || [0, 0];
    return result?.project?.[key] ? Math.max(0, (Number(pair[0]) + Number(pair[1])) / 2) : 0;
  });
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  const shares = amounts.map(amount => total > 0 ? amount / total : 0);
  let cursor = 0;
  const lastActive = amounts.reduce((last, amount, index) => amount > 0 ? index : last, -1);
  COST_TRADES.forEach(({ key, label }, index) => {
    const included = result ? Boolean(result.project[key]) : Boolean(byId(`scope-${key}`)?.checked);
    let width = total > 0 && included ? shares[index] * 100 : 0;
    if (index === lastActive) width = 100 - cursor;
    for (const segment of document.querySelectorAll(`[data-share-segment="${key}"]`)) {
      segment.setAttribute('x', cursor.toFixed(3));
      segment.setAttribute('width', width.toFixed(3));
    }
    if (width > 0) cursor += width;
    const percent = result ? included && total > 0 ? `${Math.round(shares[index] * 100)}%` : included ? '0%' : 'Off' : '—';
    for (const node of document.querySelectorAll(`[data-share-percent="${key}"]`)) node.textContent = percent;
    for (const node of document.querySelectorAll(`[data-share-range="${key}"]`)) {
      node.textContent = result ? included ? range(result.items[key]) : 'Not included' : '—';
    }
    for (const node of document.querySelectorAll(`[data-share-value="${key}"]`)) {
      node.textContent = result ? included ? `${percent} share` : 'Not included' : '—';
    }
    for (const row of document.querySelectorAll(`[data-cost-share-row="${key}"]`)) row.classList.toggle('is-excluded', !included);
  });
  const description = result && total > 0
    ? `Illustrative cost share at the combined range midpoint: ${COST_TRADES.map(({ key, label }, index) => result.project[key] ? `${label} ${Math.round(shares[index] * 100)} percent` : `${label} not included`).join(', ')}.`
    : 'Cost shares appear when a valid estimate is available.';
  for (const title of document.querySelectorAll('.cost-share-bar title')) title.textContent = description;
}
function paintResult(result) {
  byId('empty-state').hidden = true;
  byId('results').hidden = false;
  byId('total-range').textContent = range(result.total);
  paintLiveRange(range(result.total));
  byId('siding-range').textContent = result.project.siding ? range(result.items.siding) : 'Not selected';
  byId('window-range').textContent = result.project.windows ? range(result.items.windows) : 'Not selected';
  byId('door-range').textContent = result.project.doors ? range(result.items.doors) : 'Not selected';
  paintCostShares(result);
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
  paintChoiceHints();
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
    paintCostShares(null);
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
byId('reset-rates')?.addEventListener('click', () => {
  setCatalogRates();
  syncProjectControls();
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
function resetFootprintState({ restoreManual = false } = {}) {
  footprintController?.abort();
  footprintController = null;
  if (restoreManual && manualInputsBackup) {
    for (const [key, value] of Object.entries(manualInputsBackup)) {
      if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value;
    }
  }
  footprintData = null;
  manualInputsBackup = null;
  if (byId('footprint-status')) {
    byId('footprint-status').className = 'field-help';
    byId('footprint-status').textContent = matched?.coordinates
      ? 'Ready to look up public or authorized building dimensions for this matched address.'
      : 'Using your manual dimensions below. Match a Step 1 address to query public building outlines.';
  }
}

/** A style brings its own roof, masonry and typical additions; trim, lighting, garage and fence stay as chosen. */
function applyStyleDesign(style) {
  remodelDesign.roof = ROOF_COLORS[style.roof] ? style.roof : 'charcoal';
  remodelDesign.roofMaterial = ROOF_MATERIALS[style.roofMaterial] ? style.roofMaterial : 'shingle';
  remodelDesign.masonry = MASONRY_FINISHES[style.masonry] ? style.masonry : 'brick';
  for (const key of ['porch', 'dormers', 'shutters']) { remodelDesign[key] = style[key]; byId(`add-${key}`).checked = style[key]; }
}
function applyStylePreset(styleId, { manual = true } = {}) {
  const style = resolveHomeStyle(styleId);
  selectedHomeStyle = style.id;
  if (manual) manualStyleOverride = true;
  const currentArea = footprintData?.areaSqFt || (Math.max(12, Number(byId('lengthFt').value) || 48) * Math.max(12, Number(byId('widthFt').value) || 34));
  const widthFt = Math.max(16, Math.min(64, Math.round(Math.sqrt(currentArea / style.ratio) * 2) / 2));
  const lengthFt = Math.max(18, Math.min(90, Math.round((currentArea / widthFt) * 2) / 2));
  byId('lengthFt').value = String(Math.max(lengthFt, widthFt));
  byId('widthFt').value = String(Math.min(lengthFt, widthFt));
  byId('stories').value = String(footprintData?.stories || style.stories);
  byId('storyHeightFt').value = String(style.storyHeightFt);
  byId('gableRiseFt').value = String(style.gableRiseFt);
  byId('masonryPercent').value = String(style.masonryPercent);
  applyStyleDesign(style);
  syncProjectControls({ microResponse: true });
  if (hasCalculated) calculate();
  assistant?.changed('homeStyle');
}

byId('home-style-picker')?.addEventListener('click', event => {
  const card = event.target.closest('[data-archetype]');
  if (!card) return;
  applyStylePreset(card.dataset.archetype, { manual: true });
});

byId('footprint-consent')?.addEventListener('click', () => {
  const next = byId('footprint-consent').getAttribute('aria-pressed') !== 'true';
  byId('footprint-consent').setAttribute('aria-pressed', String(next));
});

byId('fetch-footprint')?.addEventListener('click', async () => {
  const statusEl = byId('footprint-status'), button = byId('fetch-footprint');
  const consented = byId('footprint-consent')?.getAttribute('aria-pressed') === 'true';
  if (!consented) {
    statusEl.className = 'field-help error';
    statusEl.textContent = 'Check confirmation above before requesting building dimensions for this address.';
    byId('footprint-consent')?.focus();
    return;
  }
  if (!matched?.coordinates) {
    statusEl.className = 'field-help error';
    statusEl.textContent = 'Match a contiguous U.S. address in Step 1 first, or enter your measurements manually below.';
    return;
  }
  footprintController?.abort();
  const controller = new AbortController();
  footprintController = controller;
  button.disabled = true;
  statusEl.className = 'field-help';
  statusEl.textContent = 'Checking authorized & public ODbL building footprints…';
  try {
    const result = await fetchPublicFootprint({
      address: addressEl.value.trim(),
      coordinates: matched.coordinates,
      styleId: selectedHomeStyle,
      consented: true,
      signal: controller.signal
    });
    if (!manualInputsBackup) manualInputsBackup = readInputs();
    footprintData = result;
    if (!manualStyleOverride && result.suggestedStyle) {
      selectedHomeStyle = resolveHomeStyle(result.suggestedStyle).id;
    }
    const style = resolveHomeStyle(selectedHomeStyle);
    byId('lengthFt').value = String(Math.round(Math.max(18, Math.min(90, result.lengthFt)) * 2) / 2);
    byId('widthFt').value = String(Math.round(Math.max(16, Math.min(64, result.widthFt)) * 2) / 2);
    if (result.stories) byId('stories').value = String(Math.min(4, Math.max(1, Math.round(result.stories))));
    byId('storyHeightFt').value = String(style.storyHeightFt);
    byId('gableRiseFt').value = String(style.gableRiseFt);
    applyStyleDesign(style);
    statusEl.className = 'field-help success';
    statusEl.textContent = `${result.source?.provider || 'Public building outline'}: ~${Math.round(result.areaSqFt).toLocaleString()} sq ft ground outline (${Math.round(result.perimeterFt)} ft perimeter) · sized as ${byId('lengthFt').value} × ${byId('widthFt').value} ft (${style.name}). Style variant — approximate, not your surveyed footprint.`;
    syncProjectControls({ microResponse: true });
    if (hasCalculated) calculate();
    refreshReport();
  } catch (error) {
    if (controller.signal.aborted) return;
    statusEl.className = 'field-help error';
    statusEl.textContent = error instanceof Error ? error.message : 'Footprint lookup failed. Enter dimensions manually.';
  } finally {
    if (footprintController === controller) footprintController = null;
    button.disabled = false;
  }
});

byId('clear-footprint')?.addEventListener('click', () => {
  resetFootprintState({ restoreManual: true });
  syncProjectControls({ microResponse: true });
  if (hasCalculated) calculate();
  refreshReport();
});

function addressChanged() {
  cancelAddressLookup(); resetFootprintState(); propertyLookup?.clear({ restoreInputs: true }); assistant?.changed('property-address');
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
  if (byId('footprint-status')) {
    byId('footprint-status').className = 'field-help';
    byId('footprint-status').textContent = 'Ready to look up public or authorized building dimensions for this matched address.';
  }
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
    if (!footprintData && byId('footprint-status')) {
      byId('footprint-status').className = 'field-help';
      byId('footprint-status').textContent = 'Ready to look up public or authorized building dimensions for this matched address.';
    }
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
  syncProjectControls({ microResponse: true });
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
  if (selected === 'remodel') remodel.open(byId('remodel-stage')); else remodel.close();
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
byId('remodel-open').addEventListener('click', () => remodel.open(byId('remodel-stage')));
byId('step3-3d-open')?.addEventListener('click', () => remodel.open(byId('step3-3d-stage')));
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
function applyRemodelSplit(splitValue, { animate = false } = {}) {
  const split = Math.max(0, Math.min(100, Number(splitValue)));
  remodelDesign.split = split;
  remodelDesign.before = split === 0;
  remodel.setSplit(split, { animate });
  syncRemodelControls();
  if (!animate) remodel.refresh();
  const msg = split === 0
    ? 'Before: the home as it stands, in a dated palette with no additions.'
    : split === 100
    ? 'After: your siding, materials and additions below.'
    : `Split comparison: ${100 - split}% Before on left, ${split}% After on right.`;
  byId('remodel-status').textContent = msg;
  if (byId('step3-3d-status')) byId('step3-3d-status').textContent = msg;
}
for (const [id, split] of [['remodel-before', 0], ['remodel-split-half', 50], ['remodel-after', 100]]) {
  byId(id)?.addEventListener('click', () => applyRemodelSplit(split, { animate: true }));
}
for (const button of document.querySelectorAll('[data-dock-split]')) {
  button.addEventListener('click', () => applyRemodelSplit(button.dataset.dockSplit, { animate: true }));
}
byId('remodel-split')?.addEventListener('input', event => applyRemodelSplit(event.target.value, { animate: false }));
for (const button of document.querySelectorAll('[data-remodel-view], [data-step3-view]')) {
  button.addEventListener('click', () => remodel.setView(button.dataset.remodelView || button.dataset.step3View));
}
byId('remodel-download').addEventListener('click', () => remodel.download());
for (const [attr, key, catalog] of DESIGN_PICKERS) {
  const dataKey = attr.replace(/-(\w)/g, (_, c) => c.toUpperCase());
  document.addEventListener('click', event => {
    const button = event.target.closest(`[data-${attr}]`);
    if (!button || !Object.hasOwn(catalog, button.dataset[dataKey])) return;
    remodelDesign[key] = button.dataset[dataKey]; syncRemodelControls(); remodel.refresh({ microResponse: key !== 'scene' });
  });
}
for (const [id, key] of ADDITIONS) byId(id).addEventListener('change', () => {
  remodelDesign[key] = byId(id).checked; syncRemodelControls(); remodel.refresh({ microResponse: true });
});
byId('remodel-orbit')?.addEventListener('click', () => { byId('remodel-orbit').setAttribute('aria-pressed', String(remodel.orbit())); });
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
    const project = { id: activeProjectId || crypto.randomUUID(), name, address: addressEl.value.trim(), updatedAt:new Date().toISOString(), inputs:readInputs(), options:projectOptions(), planning: assistant?.metadata(), propertyData: propertyLookup?.context(), footprintData };
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
  selectedColor = project.options.color;
  selectedHomeStyle = resolveHomeStyle(project.options.homeStyle).id;
  footprintData = project.footprintData || null;
  manualInputsBackup = null;
  addressEl.value = project.address; activeProjectId = project.id;
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
  form.reset(); selectedColor = DEFAULT_PROJECT.color; selectedHomeStyle = DEFAULT_PROJECT.homeStyle; manualStyleOverride = false; resetFootprintState(); byId('footprint-consent')?.setAttribute('aria-pressed', 'false'); addressEl.value = ''; editor.reset();
  addressStatus.textContent = 'Your property view loads as you type a complete U.S. address. Location is approximate.'; addressStatus.className = 'field-help';
  remodelDesign = { ...DEFAULT_DESIGN, split: 100 }; remodel.setSplit(100); for (const [id, key] of ADDITIONS) byId(id).checked = DEFAULT_DESIGN[key]; syncRemodelControls();
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
    if (snapshot.options.homeStyle) selectedHomeStyle = resolveHomeStyle(snapshot.options.homeStyle).id;
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
