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
import { houseSpecFromStyle, resolveHomeStyle, modelGuardrailLabel, styleSilhouette, ROOF_COLORS, ROOF_MATERIALS, TRIM_COLORS, MASONRY_FINISHES, SCENES, DEFAULT_DESIGN, DOOR_HEX } from './house-spec.js';
import { fetchPublicFootprint } from './footprint-client.js';
import { setupLeadForm } from './lead-form.js';
import { parseChangeRequest, describeChange } from './intent.js';
import { setupAddressSuggestions } from './address-suggest.js';
import { OFFICES, serviceArea } from './alco.js';

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
// Every match goes through here, so the service-area note and Alco's phone numbers follow the address.
let office = OFFICES.bethesda;
function setMatched(location) {
  matched = location;
  const area = location && location.source !== EXTERIOR_EXAMPLE.source ? serviceArea(location.matchedAddress) : null;
  const note = byId('service-area');
  note.textContent = area?.message || ''; note.hidden = !area?.message; note.dataset.status = area?.status || '';
  office = area?.office || OFFICES.bethesda;
  for (const link of document.querySelectorAll('[data-alco-tel]')) link.href = `tel:${office.tel}`;
  for (const phone of document.querySelectorAll('[data-alco-phone]')) phone.textContent = office.phone;
}
let lookupSerial = 0;
let lookupController = null;
let lookupTimer = null;
let addressComposing = false;
let invalidField = null;
let selectedColor = DEFAULT_PROJECT.color;
let selectedHomeStyle = DEFAULT_PROJECT.homeStyle;
let manualStyleOverride = false;
let footprintData = null;
// Typed size fields are never overwritten by the automatic open-data lookup.
let measurementsTouched = false;
// The inputs and source from before the homeowner confirmed a measured size, for Undo.
let sizeBeforeConfirm = null;
let manualInputsBackup = null;
let footprintController = null;
let activeProjectId = null;
let projectLoadSerial = 0;
let assistant;
let propertyLookup;
let remodel;
const wizard = setupWizard({
  onChange: step => {
    // The stylesheet keys each step's frame off data-active-step (data-step marks the step panels).
    document.body.dataset.activeStep = String(step);
    paintStepContext(step);
    setSheet(false);
    paintPanel();
    if (!remodel) return;
    if (step >= 2 && step <= 4) remodel.attach(byId('step3-3d-stage'));
    else if (step === 5) remodel.attach(byId('remodel-stage'));
  }
});
const propertyPreview = setupPropertyPreview({
  onPhoto: () => { wizard.show(5); showStudioTab('photo'); byId('photo-tab').scrollIntoView({ block: 'center', behavior: 'instant' }); byId('photo-tab').focus(); },
  // The measuring pass shows the size this page is using; height is stories × story height plus the roof rise.
  // The 3D view also traces the mapped building outline when the open-data lookup found one.
  getDimensions: () => {
    const value = id => Number(byId(id).value) || 0, wallFt = value('stories') * (value('storyHeightFt') || 9);
    return { lengthFt: value('lengthFt'), widthFt: value('widthFt'), wallFt, heightFt: wallFt + value('gableRiseFt'), fromPublicData: Boolean(footprintData), outline: footprintData?.polygon?.coordinates?.[0] ?? null };
  },
  onConfirmSize: measured => confirmMeasuredSize(measured),
  onUndoSize: () => undoMeasuredSize()
});
const editor = new PhotoEditor({ canvas: byId('photo-canvas'), input: byId('photo-upload'), status: byId('photo-status'), finish: byId('finish-area'), undo: byId('undo-area'), clear: byId('clear-areas'), download: byId('download-preview'), remove: byId('remove-photo'), onDraw: () => mirrorPhoto() });
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
  welcomeStage: byId('welcome-stage'),
  proposalStage: byId('proposal-stage'),
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
  onAnchors: anchors => placeHotspots(anchors),
  onOrbitChange: on => {
    byId('remodel-orbit')?.setAttribute('aria-pressed', String(on));
    byId('studio-rotate').setAttribute('aria-pressed', String(on));
    // The Step 1 turntable's pause control appears once the house starts turning (never with reduced motion).
    const toggle = byId('turntable-toggle');
    if (toggle) { if (on) toggle.hidden = false; toggle.textContent = on ? 'Pause rotation' : 'Rotate house'; }
  },
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
/**
 * "Show my choices on this photo": the homeowner's own photo, restyled by an image model on the server
 * (api/visualize). Hidden on the static site and wherever AI is not connected.
 */
const conceptButton = byId('photo-concept'), conceptResult = byId('photo-concept-result');
if (!STATIC_SITE) fetch('api/visualize', { cache: 'no-store' }).then(response => response.ok ? response.json() : {}).then(body => { conceptButton.hidden = !body.available; }).catch(() => {});
async function photoForConcept(file) {
  const bitmap = await createImageBitmap(file), scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  return canvas.toDataURL('image/jpeg', .85);
}
conceptButton.addEventListener('click', async () => {
  if (!editor.file) return;
  const p = projectOptions(), status = byId('photo-status');
  const design = { siding: PRODUCTS.siding[p.sidingProduct].name, color: COLORS[selectedColor].name, roof: `${ROOF_COLORS[remodelDesign.roof].name} ${ROOF_MATERIALS[remodelDesign.roofMaterial].name}` };
  if (remodelDesign.trim !== 'default') design.trim = TRIM_COLORS[remodelDesign.trim].name;
  conceptButton.disabled = true; conceptButton.setAttribute('aria-busy', 'true'); status.textContent = 'Making a photo-real concept of your choices. This can take up to a minute…';
  try {
    const response = await fetch('api/visualize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: await photoForConcept(editor.file), design }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.image) throw new Error(body.error || 'The photo concept could not be made right now.');
    conceptResult.querySelector('img').src = body.image; conceptResult.hidden = false;
    status.textContent = 'Concept ready below. It is illustrative and does not change your estimate.';
  } catch (error) { status.textContent = error.message; }
  finally { conceptButton.disabled = !editor.file; conceptButton.removeAttribute('aria-busy'); }
});
byId('photo-upload').addEventListener('change', () => { conceptResult.hidden = true; setTimeout(() => { conceptButton.disabled = !editor.file; }, 300); });
const projectDialog = byId('projects-dialog');
byId('photo-upload').addEventListener('change', () => { projectLoadSerial++; });

/**
 * Exterior Studio (Steps 2–4). The rail holds each step's controls; the canvas shows the concept house
 * (or the homeowner's photo) with hotspots and camera controls; the material bar edits the chosen
 * surface through the same Step 4 controls; "Your project" summarises the live estimate. On phones the
 * studio is a bottom sheet and "Your project" opens as a second sheet over it.
 */
const STEP_NAMES = ['Address', 'Project', 'Home', 'Choices', 'Estimate'];
const SURFACES = { siding: { label: 'Siding', select: 'sidingProduct' }, windows: { label: 'Windows', select: 'windowProduct' }, doors: { label: 'Doors', select: 'doorProduct' } };
// The bar offers five siding colours; the full palette stays in Step 4, and a colour picked there takes the fifth place.
const FEATURED_COLORS = ['sage', 'white', 'greige', 'charcoal', 'cream'];
const CALLOUTS = { 2: 'Confirm your home details to refine this range.', 3: 'Your measurements and home style refine this range as you type.', 4: 'Your materials and quality move this range.' };
const ROW_FIELDS = { siding: 'lengthFt', windows: 'replaceWindows', doors: 'replaceDoors' };
const compactQuery = matchMedia('(max-width: 1023.98px), (max-height: 599.98px)');
const studioCanvas = byId('studio-canvas'), studioPanel = byId('project-panel');
let surface = 'siding', projectName = '', photoFromStudio = false, sheetOpener = null;
const displayName = () => projectName || 'Example home';
function paintStepContext(step) {
  for (const node of document.querySelectorAll('[data-step-number]')) node.textContent = String(step);
  for (const node of document.querySelectorAll('[data-step-name]')) node.textContent = STEP_NAMES[step - 1];
}
/** The address card's two lines, in title case when the text is Census capitals. */
function addressLines() {
  const text = (matched?.matchedAddress || addressEl.value).trim();
  if (!text) return ['No address yet', 'Add yours to size the estimate'];
  const [street, ...rest] = text.split(',').map(part => part.trim()).filter(Boolean);
  if (text !== text.toUpperCase()) return [street, rest.join(', ')];
  const title = (part, keep) => part.split(/\s+/).map(word => keep.test(word) || /\d/.test(word) ? word : word[0] + word.slice(1).toLowerCase()).join(' ');
  return [title(street, /^(N|S|E|W|NE|NW|SE|SW)$/), rest.map(part => title(part, /^[A-Z]{2}$/)).join(', ').replace(/, (\d{5}(-\d{4})?)$/, ' $1')];
}
function paintPanel() {
  const p = projectOptions(), result = lastResult, count = key => Number(result?.inputs?.[key] ?? byId(key).value) || 0;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const details = {
    siding: !p.siding ? 'Not selected' : result?.project.siding ? `${number.format(result.geometry.sidingNetSqFt)} sq ft (estimated)` : '—',
    windows: !p.windows ? 'Not selected' : `${plural(count('replaceWindows'), 'window')} (estimated)`,
    doors: !p.doors ? 'Not selected' : plural(count('replaceDoors'), 'door')
  };
  for (const [kind, text] of Object.entries(details)) {
    byId(`scope-detail-${kind}`).textContent = text;
    document.querySelector(`[data-scope-row="${kind}"]`).classList.toggle('is-off', !p[kind]);
  }
  const [line1, line2] = addressLines();
  byId('panel-address-line1').textContent = line1; byId('panel-address-line2').textContent = line2;
  byId('panel-home-name').textContent = byId('project-title-text').textContent = displayName();
  byId('estimate-callout-text').textContent = CALLOUTS[wizard.current] || CALLOUTS[2];
}
/** What the bar's swatches set for each surface: siding colour, trim colour, or the entry door (its finish). */
function surfaceSwatches(kind) {
  if (kind === 'windows') return { label: 'Trim colour', selected: remodelDesign.trim, options: Object.entries(TRIM_COLORS).map(([key, { name, hex }]) => ({ key, name: `${name} trim`, hex })) };
  if (kind === 'doors') return { label: 'Entry door', selected: byId('doorProduct').value, options: Object.entries(DOOR_HEX).map(([key, hex]) => ({ key, name: PRODUCTS.doors[key].name, hex })) };
  const keys = FEATURED_COLORS.includes(selectedColor) ? FEATURED_COLORS : [...FEATURED_COLORS.slice(0, 4), selectedColor];
  return { label: 'Siding colour', selected: selectedColor, options: keys.map(key => ({ key, name: COLORS[key].name, hex: COLORS[key].hex })) };
}
function paintSwatches() {
  const group = byId('material-swatches'), { label, selected, options } = surfaceSwatches(surface), keys = `${surface}:${options.map(option => option.key)}`;
  group.setAttribute('aria-label', label);
  // Rebuilt only when the set changes, so arrow keys keep focus on the same buttons.
  if (group.dataset.keys !== keys) {
    group.dataset.keys = keys;
    group.replaceChildren(...options.map(({ key, name, hex }) => {
      const swatch = document.createElement('button');
      swatch.type = 'button'; swatch.className = 'material-swatch'; swatch.dataset.swatch = key; swatch.title = name;
      swatch.setAttribute('role', 'radio'); swatch.setAttribute('aria-label', name);
      if (hex) swatch.style.setProperty('--swatch', hex); else swatch.classList.add('is-style-default');
      return swatch;
    }));
  }
  for (const swatch of group.children) {
    const on = swatch.dataset.swatch === selected;
    swatch.setAttribute('aria-checked', String(on)); swatch.tabIndex = on ? 0 : -1;
  }
}
function paintMaterialBar() {
  const p = projectOptions(), { label, select } = SURFACES[surface], included = p[surface], panel = byId('material-panel');
  for (const tab of document.querySelectorAll('[data-surface-tab]')) {
    const active = tab.dataset.surfaceTab === surface;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
  }
  for (const spot of document.querySelectorAll('[data-hotspot]')) spot.setAttribute('aria-pressed', String(spot.dataset.hotspot === surface));
  panel.setAttribute('aria-labelledby', `surface-tab-${surface}`);
  panel.toggleAttribute('data-off', !included);
  byId('material-off').hidden = included;
  byId('material-off-text').textContent = `${label} ${surface === 'siding' ? 'isn’t' : 'aren’t'} part of your project yet.`;
  byId('material-add').textContent = `Add ${label.toLowerCase()}`;
  paintSwatches();
  const proxy = byId('material-select'), source = byId(select);
  if (proxy.dataset.surface !== surface) {
    proxy.dataset.surface = surface; proxy.setAttribute('aria-label', `${label} material`);
    proxy.replaceChildren(...[...source.options].map(option => new Option(option.textContent, option.value)));
  }
  proxy.value = source.value;
  byId('material-colour').textContent = surface === 'siding' ? COLORS[selectedColor].name : `${TRIM_COLORS[remodelDesign.trim].name} trim`;
  byId('material-colour').parentElement.hidden = surface === 'doors';
}
function paintMaterialCard() {
  const p = projectOptions(), swatch = byId('material-card-swatch'), product = PRODUCTS[surface][p[SURFACES[surface].select]].name;
  const [hex, shown] = surface === 'windows' ? [TRIM_COLORS[remodelDesign.trim].hex, `Trim shown: ${TRIM_COLORS[remodelDesign.trim].name}`]
    : surface === 'doors' ? [DOOR_HEX[p.doorProduct], 'Shown on the 3D house'] : [COLORS[selectedColor].hex, `Shown: ${COLORS[selectedColor].name}`];
  swatch.classList.toggle('is-style-default', !hex);
  if (hex) swatch.style.setProperty('--swatch', hex);
  byId('material-card-trade').textContent = SURFACES[surface].label;
  byId('material-card-product').textContent = p[surface] ? product : `${product} · not in your project`;
  byId('material-card-shown').textContent = shown;
}
function paintStudio() { paintPanel(); paintMaterialBar(); paintMaterialCard(); }
function setSurface(kind) { surface = kind; paintMaterialBar(); paintMaterialCard(); }
/** Floats each hotspot over the surface the 3D view found for it, or hides it when that surface faces away. */
function placeHotspots(anchors) {
  for (const { surface: kind, x, y, visible } of anchors) {
    const spot = document.querySelector(`[data-hotspot="${kind}"]`);
    spot.hidden = !visible;
    if (visible) spot.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
}
/** Bar choices go through the real Step 4 controls, so the estimate, saved projects and drafts see them as usual. */
function setControl(id, value) {
  const control = byId(id);
  if (control.value === value || control.disabled) return;
  control.value = value; control.dispatchEvent(new Event('input', { bubbles: true }));
}
function chooseSwatch(key) {
  if (surface === 'siding') chooseColor(key);
  else if (surface === 'doors') setControl('doorProduct', key);
  else { remodelDesign.trim = key; syncRemodelControls(); remodel.refresh({ microResponse: true }); paintStudio(); }
}
for (const spot of document.querySelectorAll('[data-hotspot]')) spot.addEventListener('click', () => setSurface(spot.dataset.hotspot));
const surfaceTabs = [...document.querySelectorAll('[data-surface-tab]')];
for (const tab of surfaceTabs) {
  tab.addEventListener('click', () => setSurface(tab.dataset.surfaceTab));
  tab.addEventListener('keydown', event => {
    const index = surfaceTabs.indexOf(tab), next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: surfaceTabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = surfaceTabs[(next + surfaceTabs.length) % surfaceTabs.length];
    setSurface(target.dataset.surfaceTab); target.focus();
  });
}
byId('material-swatches').addEventListener('click', event => { const swatch = event.target.closest('[data-swatch]'); if (swatch) chooseSwatch(swatch.dataset.swatch); });
byId('material-swatches').addEventListener('keydown', event => {
  const swatches = [...byId('material-swatches').children], index = swatches.indexOf(document.activeElement);
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  const next = step ? (index + step + swatches.length) % swatches.length : event.key === 'Home' ? 0 : event.key === 'End' ? swatches.length - 1 : -1;
  if (index < 0 || next < 0) return;
  event.preventDefault();
  chooseSwatch(swatches[next].dataset.swatch);
  byId('material-swatches').children[next]?.focus();
});
byId('material-select').addEventListener('change', event => setControl(SURFACES[surface].select, event.target.value));
byId('material-add').addEventListener('click', () => {
  const box = byId(`scope-${surface}`);
  if (!box.checked) { box.checked = true; box.dispatchEvent(new Event('input', { bubbles: true })); }
});
// The camera controls sit just above the material bar, whatever height it wraps to.
new ResizeObserver(() => {
  const bar = byId('material-bar');
  if (!compactQuery.matches && bar.offsetHeight) studioCanvas.style.setProperty('--controls-bottom', `${bar.offsetHeight + 30}px`);
  else studioCanvas.style.removeProperty('--controls-bottom');
}).observe(byId('material-bar'));
byId('studio-reset').addEventListener('click', () => remodel.reset());
byId('studio-rotate-left').addEventListener('click', () => remodel.rotate(-Math.PI / 6));
byId('studio-rotate-right').addEventListener('click', () => remodel.rotate(Math.PI / 6));
byId('studio-rotate').addEventListener('click', () => byId('studio-rotate').setAttribute('aria-pressed', String(remodel.orbit())));
byId('studio-zoom-in').addEventListener('click', () => remodel.zoom(1.25));
byId('studio-zoom-out').addEventListener('click', () => remodel.zoom(1 / 1.25));
if (document.fullscreenEnabled) {
  const button = byId('studio-fullscreen');
  button.hidden = false;
  button.addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : studioCanvas.requestFullscreen()).catch(() => {}));
  document.addEventListener('fullscreenchange', () => {
    const on = document.fullscreenElement === studioCanvas;
    button.setAttribute('aria-pressed', String(on)); button.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
  });
}
/** 3D view or Photo: the homeowner's photo with their marked walls, else the aerial photo of the address, else an upload prompt. */
function setStudioView(view) {
  studioCanvas.dataset.view = view;
  byId('view-3d').setAttribute('aria-pressed', String(view === '3d'));
  byId('view-photo').setAttribute('aria-pressed', String(view === 'photo'));
  byId('step3-3d-stage').hidden = view !== '3d';
  byId('studio-photo').hidden = view !== 'photo';
  paintPhotoView();
}
function paintPhotoView() {
  const photo = Boolean(editor.bitmap), aerial = document.querySelector('#aerial-images img'), studioAerial = byId('studio-aerial');
  const aerialSrc = !photo && aerial?.complete && aerial.naturalWidth ? aerial.currentSrc || aerial.src : '';
  byId('studio-photo-canvas').hidden = !photo;
  studioAerial.hidden = !aerialSrc;
  if (aerialSrc && studioAerial.src !== aerialSrc) studioAerial.src = aerialSrc;
  byId('studio-photo-empty').hidden = photo || Boolean(aerialSrc);
  const note = photo ? (editor.areas.length ? 'Your marked walls show your siding colour.' : 'Mark the walls on your photo to try your colours on it.') : aerialSrc ? 'Aerial photo of your address. Upload your own photo to see your choices on it.' : '';
  byId('studio-photo-note').hidden = !note;
  byId('studio-photo-note-text').textContent = note;
  byId('studio-mark-walls').hidden = !photo;
}
function mirrorPhoto() {
  if (editor.bitmap) {
    const source = byId('photo-canvas'), mirror = byId('studio-photo-canvas'), context = mirror.getContext('2d');
    if (mirror.width !== source.width || mirror.height !== source.height) { mirror.width = source.width; mirror.height = source.height; }
    context.clearRect(0, 0, mirror.width, mirror.height); context.drawImage(source, 0, 0);
  }
  // A photo chosen from the studio opens straight into the Photo view.
  if (photoFromStudio && editor.bitmap) { photoFromStudio = false; setStudioView('photo'); } else paintPhotoView();
}
byId('view-3d').addEventListener('click', () => setStudioView('3d'));
byId('view-photo').addEventListener('click', () => setStudioView('photo'));
// One hidden file picker serves every "Upload home photo" button; the buttons are what keyboards and screen readers reach.
for (const button of document.querySelectorAll('[data-photo-upload]')) button.addEventListener('click', () => {
  photoFromStudio = Boolean(button.closest('#estimate-form'));
  setSheet(false);
  byId('photo-upload').click();
});
byId('photo-upload').addEventListener('cancel', () => { photoFromStudio = false; });
byId('studio-mark-walls').addEventListener('click', () => { wizard.show(5); showStudioTab('photo'); byId('photo-panel').scrollIntoView({ block: 'start', behavior: 'instant' }); byId('photo-canvas').focus(); });
byId('estimate-info').addEventListener('click', () => {
  const open = byId('estimate-breakdown').hidden;
  byId('estimate-breakdown').hidden = !open; byId('estimate-info').setAttribute('aria-expanded', String(open));
});
// A scope row opens what its number comes from: the measurements, or the scope choice when it is off.
for (const row of document.querySelectorAll('[data-scope-row]')) row.addEventListener('click', () => {
  const kind = row.dataset.scopeRow, field = byId(projectOptions()[kind] ? ROW_FIELDS[kind] : `scope-${kind}`);
  setSheet(false); wizard.reveal(field); field.focus();
});
/** Phones: "Your project" opens from the estimate strip, the folder button or a swipe up on the handle. */
function setSheet(open, opener = null) {
  if (open && !compactQuery.matches) return;
  if (open === (form.dataset.sheet === 'open')) return;
  if (open) form.dataset.sheet = 'open'; else delete form.dataset.sheet;
  for (const control of document.querySelectorAll('[data-open-sheet]')) control.setAttribute('aria-expanded', String(open));
  for (const part of form.children) if (part !== studioPanel && !part.classList.contains('sheet-scrim')) part.inert = open;
  if (open) { sheetOpener = opener; studioPanel.scrollTop = 0; byId('panel-title').focus({ preventScroll: true }); }
  else if (sheetOpener?.getClientRects().length) { sheetOpener.focus({ preventScroll: true }); sheetOpener = null; }
}
document.addEventListener('click', event => {
  const opener = event.target.closest('[data-open-sheet]');
  if (opener) setSheet(opener.id !== 'open-project-sheet' || form.dataset.sheet !== 'open', opener);
  else if (event.target.closest('[data-close-sheet]')) setSheet(false);
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && form.dataset.sheet === 'open') { event.preventDefault(); setSheet(false); } });
compactQuery.addEventListener('change', () => { if (!compactQuery.matches) setSheet(false); });
function onSwipe(element, direction, action) {
  let start = null;
  element.addEventListener('pointerdown', event => {
    if (event.button > 0 || (event.target !== element && event.target.closest('button'))) return;
    start = { id: event.pointerId, y: event.clientY }; element.setPointerCapture(event.pointerId);
  });
  element.addEventListener('pointerup', event => { if (start?.id === event.pointerId && (event.clientY - start.y) * direction > 24) action(); start = null; });
  element.addEventListener('pointercancel', () => { start = null; });
}
onSwipe(document.querySelector('.sheet-grab'), -1, () => setSheet(true, document.querySelector('.sheet-grab')));
onSwipe(document.querySelector('.panel-head'), 1, () => setSheet(false));
/** There are no accounts: the account button says so and offers saved projects and a call. */
const accountButton = byId('account-button'), accountMenu = byId('account-menu');
function setAccountMenu(open) { accountMenu.hidden = !open; accountButton.setAttribute('aria-expanded', String(open)); }
accountButton.addEventListener('click', () => setAccountMenu(accountMenu.hidden));
accountButton.parentElement.addEventListener('focusout', event => { if (!accountButton.parentElement.contains(event.relatedTarget)) setAccountMenu(false); });
accountButton.parentElement.addEventListener('keydown', event => { if (event.key === 'Escape' && !accountMenu.hidden) { setAccountMenu(false); accountButton.focus(); } });
// Installable app: the service worker keeps the studio working offline once visited. Browsers that offer an
// install prompt get an "Install the app" item; iPhone and iPad Safari get the Add to Home Screen steps.
const installButton = byId('install-app'), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installPrompt = null;
if ('serviceWorker' in navigator && !navigator.webdriver) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; installButton.hidden = false; });
addEventListener('appinstalled', () => { installPrompt = null; installButton.hidden = true; });
installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  const prompt = installPrompt; installPrompt = null; installButton.hidden = true; setAccountMenu(false);
  await prompt.prompt();   // One use per event; the browser sends a fresh one if the person declines.
});
byId('install-ios').hidden = standalone || !(/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
document.addEventListener('click', event => { if (!accountMenu.hidden && !event.target.closest('.account')) setAccountMenu(false); });
for (const item of document.querySelectorAll('[data-open-projects]')) item.addEventListener('click', () => { setAccountMenu(false); try { openProjectDialog(); } catch (error) { notify(error.message); } });
/** The project name in the top bar renames the project; a saved project is renamed on this device straight away. */
const titleText = byId('project-title-text'), titleInput = byId('project-title-input'), renameButton = byId('rename-project');
renameButton.addEventListener('click', () => {
  titleInput.value = projectName; titleInput.placeholder = 'Example home';
  titleText.hidden = renameButton.hidden = true; titleInput.hidden = false; titleInput.focus(); titleInput.select();
});
function finishRename(commit, { refocus = true } = {}) {
  if (titleInput.hidden) return;
  titleInput.hidden = true; titleText.hidden = renameButton.hidden = false;
  const name = titleInput.value.trim().slice(0, 80);
  if (commit && name && name !== projectName) renameProject(name);
  if (refocus) renameButton.focus({ preventScroll: true });
}
function renameProject(name) {
  projectName = name;
  let message = `Named “${name}”. Save the project on step 5 to keep it on this device.`;
  try {
    const saved = activeProjectId && readProjects(window.localStorage).find(project => project.id === activeProjectId);
    if (saved) { saveProject(window.localStorage, { ...saved, name, updatedAt: new Date().toISOString() }); renderSavedProjects(); message = `Renamed to “${name}”.`; }
  } catch (error) { message = error.message; }
  paintPanel(); notify(message);
}
titleInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); finishRename(true); }
  else if (event.key === 'Escape') { event.preventDefault(); finishRename(false); }
});
// Clicking elsewhere keeps the new name and leaves focus where the click put it.
titleInput.addEventListener('blur', () => finishRename(true, { refocus: false }));
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
  byId('house-texture').setAttribute('fill', 'url(#lap-pattern)');
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
  syncRemodelControls();
  paintInstant();
  paintStudio();
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
  byId('send-lead').disabled = !lastResult;
  byId('save-project').disabled = !lastResult;
  byId('result-address').textContent = addressEl.value.trim() || 'No address provided — manual estimate';
  paintStudio();
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
    byId('result-status').textContent = `Estimate updated: ${range(lastResult.total)}.`;
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
  // The address box has its own handler; recalculating the whole estimate per keystroke
  // makes typing lag on phones, and the price never depends on the raw address text.
  // The material bar's select only forwards to the real Step 4 control, which reports its own change.
  if (event.target === addressEl || event.target.closest('[data-proxy]')) return;
  if (event.target.matches('#lengthFt,#widthFt,#stories')) measurementsTouched = true;
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
  lookupSerial++; lookupController?.abort(); lookupController = null; setMatched(null);
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
  sizeBeforeConfirm = null;
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
  statusEl.textContent = 'Checking Google Solar and public building footprints…';
  try {
    const result = await fetchPublicFootprint({
      address: addressEl.value.trim(),
      coordinates: matched.coordinates,
      styleId: selectedHomeStyle,
      consented: true,
      signal: controller.signal
    });
    applyFootprint(result);
  } catch (error) {
    if (controller.signal.aborted) return;
    statusEl.className = 'field-help error';
    statusEl.textContent = error instanceof Error ? error.message : 'Footprint lookup failed. Enter dimensions manually.';
  } finally {
    if (footprintController === controller) footprintController = null;
    button.disabled = false;
  }
});

/** Sizes the house from a building outline. Automatic results are undone if the address changes. */
function applyFootprint(result, { automatic = false } = {}) {
  if (!manualInputsBackup) manualInputsBackup = readInputs();
  footprintData = { ...result, automatic };
  if (!manualStyleOverride && result.suggestedStyle) selectedHomeStyle = resolveHomeStyle(result.suggestedStyle).id;
  const style = resolveHomeStyle(selectedHomeStyle);
  byId('lengthFt').value = String(Math.round(Math.max(18, Math.min(90, result.lengthFt)) * 2) / 2);
  byId('widthFt').value = String(Math.round(Math.max(16, Math.min(64, result.widthFt)) * 2) / 2);
  if (result.stories) byId('stories').value = String(Math.min(4, Math.max(1, Math.round(result.stories))));
  byId('storyHeightFt').value = String(style.storyHeightFt);
  byId('gableRiseFt').value = String(style.gableRiseFt);
  applyStyleDesign(style);
  byId('footprint-status').className = 'field-help success';
  byId('footprint-status').textContent = `${automatic ? 'Sized automatically from ' : ''}${result.source?.provider || 'Public building outline'}: ~${Math.round(result.areaSqFt).toLocaleString()} sq ft ground outline (${Math.round(result.perimeterFt)} ft perimeter) · sized as ${byId('lengthFt').value} × ${byId('widthFt').value} ft (${style.name}). Style variant — approximate, not your surveyed footprint.`;
  syncProjectControls({ microResponse: true });
  propertyPreview.remeasure();
  if (hasCalculated) calculate();
  refreshReport();
}
/**
 * The homeowner confirmed the building measured in the 3D view or on the map: its sides size the
 * estimate, and a measured height sets the stories. Returns the size now in use, for the card.
 */
function confirmMeasuredSize({ sides, heightFt, measuredHeight, source }) {
  const [short, long] = [...sides].sort((a, b) => a - b), half = n => Math.min(350, Math.max(10, Math.round(n * 2) / 2));
  if (!manualInputsBackup) manualInputsBackup = readInputs();
  sizeBeforeConfirm ??= { inputs: readInputs(), footprintData };
  // The mapped outline keeps its own measured size; the labels on screen are rounded to whole feet.
  const outline = source === 'outline' && footprintData?.lengthFt && footprintData?.widthFt;
  const lengthFt = half(outline ? footprintData.lengthFt : long), widthFt = half(outline ? footprintData.widthFt : short);
  byId('lengthFt').value = String(lengthFt); byId('widthFt').value = String(widthFt);
  if (measuredHeight && heightFt) {
    const storyHeight = Number(byId('storyHeightFt').value) || 9, rise = Number(byId('gableRiseFt').value) || 0;
    byId('stories').value = String(Math.min(4, Math.max(1, Math.round((heightFt - rise) / storyHeight))));
  }
  const from = { outline: footprintData?.source?.provider || 'the mapped building outline', surface: 'the 3D view', solar: 'Google’s roof data', map: 'OpenStreetMap map data' }[source] || 'the 3D view';
  footprintData = {
    ...(footprintData || {}), lengthFt, widthFt, stories: Number(byId('stories').value), automatic: false, confirmed: true,
    areaSqFt: source === 'outline' && footprintData?.areaSqFt ? footprintData.areaSqFt : lengthFt * widthFt,
    perimeterFt: source === 'outline' && footprintData?.perimeterFt ? footprintData.perimeterFt : 2 * (lengthFt + widthFt),
    source: { ...(footprintData?.source || {}), provider: `${from}, confirmed by you`, approximate: true }
  };
  byId('footprint-status').className = 'field-help success';
  byId('footprint-status').textContent = `Sized from ${from}, confirmed by you: ${lengthFt} × ${widthFt} ft, ${byId('stories').value}-story. Approximate; adjust anything that looks off.`;
  syncProjectControls({ microResponse: true }); paintInstant();
  if (hasCalculated) calculate();
  refreshReport();
  return `${lengthFt} × ${widthFt} ft, ${byId('stories').value}-story`;
}
/** Puts back the size and source from before the first confirmation. */
function undoMeasuredSize() {
  if (!sizeBeforeConfirm) return;
  const { inputs, footprintData: before } = sizeBeforeConfirm; sizeBeforeConfirm = null;
  for (const [key, value] of Object.entries(inputs)) if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value;
  footprintData = before;
  byId('footprint-status').className = before ? 'field-help success' : 'field-help';
  byId('footprint-status').textContent = before ? `Sized from ${before.source?.provider || 'a public building outline'}.` : 'Using your manual dimensions below.';
  syncProjectControls({ microResponse: true }); paintInstant();
  if (hasCalculated) calculate();
  refreshReport();
}
/** After an address match, size the house from open data with no extra click, unless the homeowner typed a size. */
async function autoFootprint(location) {
  if (footprintData || measurementsTouched || !location?.coordinates) return;
  footprintController?.abort();
  const controller = new AbortController(), statusEl = byId('footprint-status');
  footprintController = controller;
  statusEl.className = 'field-help'; statusEl.textContent = 'Looking up building measurements for this address…';
  paintInstant('Sizing your home from building data…');
  try {
    const result = await fetchPublicFootprint({ coordinates: location.coordinates, styleId: selectedHomeStyle, openOnly: true, signal: controller.signal });
    // A size the homeowner already confirmed in the 3D view stays.
    if (controller.signal.aborted || matched !== location || measurementsTouched || footprintData?.confirmed) return;
    applyFootprint(result, { automatic: true });
  } catch (error) {
    if (controller.signal.aborted || matched !== location) return;
    statusEl.className = 'field-help';
    statusEl.textContent = error instanceof Error ? error.message : 'No public building outline is available. Enter measurements manually below.';
  } finally {
    if (footprintController === controller) footprintController = null;
    paintInstant();
  }
}
/** The Step 1 card: what the instant number is based on, in one line. */
function paintInstant(busy = '') {
  if (!byId('instant-basis')) return;
  const p = projectOptions(), style = resolveHomeStyle(selectedHomeStyle);
  const scopes = [['siding', 'siding'], ['windows', 'windows'], ['doors', 'doors']].filter(([key]) => p[key]).map(([, label]) => label);
  const scope = scopes.length > 1 ? `${scopes.slice(0, -1).join(', ')} and ${scopes.at(-1)}` : scopes[0] || 'no trades selected';
  const size = `${byId('lengthFt').value} × ${byId('widthFt').value} ft, ${byId('stories').value}-story ${style.name.toLowerCase()}`;
  // "This address" only once the size comes from the home itself; until then it is a typical home.
  byId('instant-label').textContent = footprintData ? 'Estimate for this address' : 'Estimate for a typical home';
  byId('instant-basis').textContent = busy || (footprintData
    ? `${size}, sized from ${footprintData.source?.provider || 'a public building outline'} · ${scope} · ${TIERS[p.tier].name} tier.`
    : matched
    ? `${size} until you confirm your home’s size · ${scope}.`
    : `Example ${size} · ${scope} · ${TIERS[p.tier].name} tier. Enter your address to size it to your home.`);
}

byId('clear-footprint')?.addEventListener('click', () => {
  resetFootprintState({ restoreManual: true });
  syncProjectControls({ microResponse: true });
  if (hasCalculated) calculate();
  refreshReport();
});

let addressResetTimer = 0;
function addressChanged() {
  const undoAuto = footprintData?.automatic === true && !measurementsTouched;
  cancelAddressLookup(); assistant?.changed('property-address');
  addressEl.removeAttribute('aria-invalid'); addressStatus.className = 'field-help';
  addressStatus.textContent = addressEl.value.trim() ? 'Keep typing your street, city and state or ZIP. Your property view will load automatically.' : 'Your property view loads as you type a complete U.S. address. Location is approximate.';
  // The reset below rebuilds the footprint state, the property inputs and the report. Running it
  // on every keystroke made typing stutter and glitch on phones (worst mid-word, while the
  // keyboard is up), so it now runs once, shortly after typing pauses — still before the
  // automatic lookup fires, so the order the rest of the flow expects is unchanged.
  clearTimeout(addressResetTimer);
  addressResetTimer = setTimeout(() => {
    resetFootprintState({ restoreManual: undoAuto }); propertyLookup?.clear({ restoreInputs: true });
    if (undoAuto) { syncProjectControls(); if (hasCalculated) calculate(); }
    refreshReport();
  }, 350);
  scheduleAddressLookup();
}
// Suggestions first: Enter on a highlighted suggestion picks it before the lookup below runs.
setupAddressSuggestions({ input: addressEl, panel: byId('address-suggest'), list: byId('address-suggestions'), onPick: text => { addressEl.value = text; addressChanged(); clearTimeout(lookupTimer); lookupAddress(); } });
addressEl.addEventListener('input', addressChanged);
// Warm the 3D runtime while the visitor types: it is megabytes of script, and a match usually
// follows, so by the time the property loads the engine is already parsed and ready.
addressEl.addEventListener('focus', () => {
  if (navigator.connection?.saveData) return;
  import('./cesium-runtime.js').then(module => module.loadCesium()).catch(() => {});
}, { once: true });
addressEl.addEventListener('compositionstart', () => { addressComposing = true; cancelAddressLookup(); });
addressEl.addEventListener('compositionend', () => { addressComposing = false; addressChanged(); });
addressEl.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.isComposing && !addressComposing) { event.preventDefault(); lookupAddress(); }
});
lookupButton.addEventListener('click', () => lookupAddress());
byId('exterior-example').addEventListener('click', () => {
  addressEl.value = EXTERIOR_EXAMPLE.matchedAddress;
  addressChanged(); cancelAddressLookup();
  setMatched({ matchedAddress: EXTERIOR_EXAMPLE.matchedAddress, coordinates: { ...EXTERIOR_EXAMPLE.coordinates }, source: EXTERIOR_EXAMPLE.source });
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
  setMatched(null);
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
    setMatched(payload);
    propertyPreview.show(payload);
    autoFootprint(payload);
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
    setMatched(null);
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
setupLeadForm({
  getPhone: () => office.phone,
  getRequest: () => calculate({ focus: true }) && {
    estimate: { address: (matched?.matchedAddress || addressEl.value.trim()).slice(0, 200) || undefined, range: lastRangeText.slice(0, 80) || undefined },
    brief: byId('print-report-content').textContent.slice(0, 16000)
  }
});
// Browser-menu printing must also validate the current fields and never expose stale costs.
window.addEventListener('beforeprint', () => { if (hasCalculated) calculate(); else refreshReport(); });
// Color changes update the illustration, marked photo areas and saved estimate context.
function chooseColor(color) {
  selectedColor = color;
  syncProjectControls({ microResponse: true });
  if (hasCalculated) calculate();
  assistant?.changed('color');
}
byId('color-picker').addEventListener('click', event => {
  const button = event.target.closest('[data-color]');
  if (button) chooseColor(button.dataset.color);
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
    if (key === 'trim') paintStudio();
  });
}
for (const [id, key] of ADDITIONS) byId(id).addEventListener('change', () => {
  remodelDesign[key] = byId(id).checked; syncRemodelControls(); remodel.refresh({ microResponse: true });
});
byId('turntable-toggle')?.addEventListener('click', () => remodel.toggleTurntable());
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
  byId('project-name').value = activeProjectId ? readProjects(window.localStorage).find(p => p.id === activeProjectId)?.name || '' : projectName || addressEl.value.trim().slice(0,80) || 'My exterior refresh';
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
    saveProject(window.localStorage, project); activeProjectId = project.id; projectName = name; paintPanel();
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
  addressEl.value = project.address; activeProjectId = project.id; projectName = project.name;
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
  projectLoadSerial++; cancelAddressLookup(); activeProjectId = null; projectName = '';
  propertyLookup?.clear();
  lookupButton.disabled = false; lookupButton.removeAttribute('aria-busy');
  form.reset(); measurementsTouched = false; selectedColor = DEFAULT_PROJECT.color; selectedHomeStyle = DEFAULT_PROJECT.homeStyle; manualStyleOverride = false; resetFootprintState(); byId('footprint-consent')?.setAttribute('aria-pressed', 'false'); addressEl.value = ''; editor.reset();
  addressStatus.textContent = 'Your property view loads as you type a complete U.S. address. Location is approximate.'; addressStatus.className = 'field-help';
  remodelDesign = { ...DEFAULT_DESIGN, split: 100 }; remodel.setSplit(100); for (const [id, key] of ADDITIONS) byId(id).checked = DEFAULT_DESIGN[key]; syncRemodelControls();
  setCatalogRates(); syncProjectControls(); hasCalculated = true; calculate(); showStudioTab('remodel'); projectDialog.close(); wizard.show(1); notify('New project started with clearly labeled example measurements.');
  assistant?.restore();
});
window.addEventListener('storage', event => { if (event.key === 'curbquote.projects.v1') renderSavedProjects(); });
syncProjectControls(); renderSavedProjects(); hasCalculated = true; calculate();

// Step 1 is a full-screen map. The address bar sits in the middle until a home is found, then moves
// to the top left as a search box and "What would you like to change?" takes the middle.
const hero = document.querySelector('.hero'), stageEl = byId('aerial-stage');
let dockAndContinue = false;
function dockAddress() {
  if (stageEl.dataset.view !== 'matched') return;
  hero.dataset.dock = 'top';
  // Pressing Enter or the arrow moves straight on to the change bar; a match found while typing keeps the caret.
  if (dockAndContinue) { dockAndContinue = false; byId('change-request').focus({ preventScroll: true }); }
}
new MutationObserver(() => { if (stageEl.dataset.view === 'matched') dockAddress(); }).observe(stageEl, { attributes: true, attributeFilter: ['data-view'] });
addressEl.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) dockAndContinue = true; });
lookupButton.addEventListener('click', () => { dockAndContinue = true; });
addressEl.addEventListener('input', () => { dockAndContinue = false; if (hero.dataset.mode === 'proposal') exitProposal(); if (!addressEl.value.trim()) hero.dataset.dock = 'center'; });

/** Applies an understood request to the same controls Steps 2–4 use, so the estimate stays the single source of prices. */
function applyChange(change) {
  const touch = input => input.dispatchEvent(new Event('input', { bubbles: true }));
  if (change.trades) for (const key of ['siding', 'windows', 'doors']) {
    const box = byId(`scope-${key}`);
    if (box.checked !== change.trades[key]) { box.checked = change.trades[key]; touch(box); }
  }
  if (change.tier) { const radio = form.querySelector(`[name="tier"][value="${change.tier}"]`); if (radio && !radio.checked) { radio.checked = true; touch(radio); } }
  if (change.sidingProduct && byId('sidingProduct').value !== change.sidingProduct) { byId('sidingProduct').value = change.sidingProduct; touch(byId('sidingProduct')); }
  if (change.color) document.querySelector(`#color-picker [data-color="${change.color}"]`)?.click();
  if (change.homeStyle) applyStylePreset(change.homeStyle, { manual: true });
  // Studio finishes and additions change the 3D concept only.
  const design = change.design || {};
  for (const [key, attr] of [['roof', 'roof'], ['roofMaterial', 'roof-material'], ['trim', 'trim'], ['masonry', 'masonry'], ['scene', 'scene']]) {
    if (design[key]) document.querySelector(`[data-${attr}="${design[key]}"]`)?.click();
  }
  for (const key of ['porch', 'garage', 'fence', 'shutters', 'dormers']) {
    const box = byId(`add-${key}`);
    if (key in design && box.checked !== design[key]) { box.checked = design[key]; box.dispatchEvent(new Event('change', { bubbles: true })); }
  }
}
const changesLook = change => Boolean(change.color || change.homeStyle || change.sidingProduct || Object.keys(change.design || {}).length);

// A request that changes the look opens the proposal: the concept house fills the map, an
// Original / Proposed switch compares it with the Before version, and the bar refines it.
function paintProposal() {
  const style = resolveHomeStyle(selectedHomeStyle);
  byId('proposal-caption').textContent = `${style.name} · ${COLORS[selectedColor].name} siding · ${ROOF_COLORS[remodelDesign.roof].name} ${ROOF_MATERIALS[remodelDesign.roofMaterial].name.toLowerCase()} roof`;
  byId('proposal-estimate-label').textContent = lastResult ? `Estimate project · ${byId('total-range').textContent}` : 'Estimate project';
}
function setProposalView(original) {
  byId('proposal-original').setAttribute('aria-pressed', String(original));
  byId('proposal-proposed').setAttribute('aria-pressed', String(!original));
  remodel.setSplit(original ? 0 : 100, { animate: true });
}
function enterProposal() {
  hero.dataset.mode = 'proposal';
  changeInput.placeholder = 'Refine this design…'; changeInput.setAttribute('aria-label', 'Refine this design');
  setProposalView(false); paintProposal();
}
function exitProposal() {
  delete hero.dataset.mode;
  changeInput.placeholder = 'What would you like to change?'; changeInput.setAttribute('aria-label', 'What would you like to change?');
  remodel.setSplit(100);
}
byId('proposal-original').addEventListener('click', () => setProposalView(true));
byId('proposal-proposed').addEventListener('click', () => setProposalView(false));
byId('proposal-exit').addEventListener('click', exitProposal);
byId('save-concept').addEventListener('click', () => byId('save-project').click());
function budgetNote(budget) {
  const total = lastResult?.total;
  if (!budget || !total) return '';
  const money = `$${budget.toLocaleString('en-US')}`;
  return budget >= total[1] ? ` That fits a budget of ${money}.` : budget < total[0] ? ` That is above a budget of ${money}; fewer trades or the Standard tier lower it.` : ` A budget of ${money} falls inside this range.`;
}
const changeStatus = byId('change-status'), changeInput = byId('change-request'), changeMore = byId('change-more');
// One suggestion group is open at a time: general (+), materials or features.
const CHIP_GROUPS = [['change-chips', changeMore], ['material-chips', byId('proposal-materials')], ['feature-chips', byId('proposal-features')]];
function showChips(id = null) {
  for (const [group, button] of CHIP_GROUPS) {
    const open = group === id; byId(group).hidden = !open; button.setAttribute('aria-expanded', String(open));
  }
  changeMore.setAttribute('aria-label', id === 'change-chips' ? 'Hide suggestions' : 'Show suggestions');
}
for (const [group, button] of CHIP_GROUPS) {
  button.addEventListener('click', () => showChips(byId(group).hidden ? group : null));
  byId(group).addEventListener('click', event => {
    const chip = event.target.closest('[data-change]');
    if (!chip) return;
    changeInput.value = chip.dataset.change; byId('change-form').requestSubmit();
  });
}
byId('change-form').addEventListener('submit', event => {
  event.preventDefault();
  const text = changeInput.value.trim();
  if (!text) { changeInput.focus(); return; }
  const change = parseChangeRequest(text);
  if (!change.recognized) {
    changeStatus.textContent = 'Here I can change siding, windows, doors, colour, home style and finish level. For anything else, use “Need help deciding?” below the map.';
    return;
  }
  applyChange(change); showChips(); changeInput.value = '';
  const range = lastResult ? `${byId('total-range').textContent}` : '';
  changeStatus.textContent = `Updated: ${describeChange(change)}.${range ? ` New range ${range}.` : ''}${budgetNote(change.budget)}`;
  if (changesLook(change) && hero.dataset.mode !== 'proposal') enterProposal(); else if (hero.dataset.mode === 'proposal') paintProposal();
});

const fullscreenToggle = byId('fullscreen-toggle');
if (document.fullscreenEnabled) {
  fullscreenToggle.hidden = false;
  fullscreenToggle.addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}));
  document.addEventListener('fullscreenchange', () => fullscreenToggle.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement))));
}
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
    cancelAddressLookup(); setMatched(location); addressEl.value = location.matchedAddress;
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
