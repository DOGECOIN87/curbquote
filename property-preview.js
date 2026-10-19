import { isAddressMatch } from './address.js';
import { aerialView, hasAerialCoverage, moveView, pointInView, DEFAULT_VIEW_METERS } from './property-view.js';
import { setupProperty3D } from './property-3d.js';
import { setupPropertyMap } from './property-map.js';

/** Images are replaced atomically and discarded immediately when the address changes. */
export function setupPropertyPreview({ onPhoto }) {
  const byId = id => document.getElementById(id);
  const stage = byId('aerial-stage'), images = byId('aerial-images'), tools = byId('aerial-controls');
  const overlay = byId('aerial-placeholder'), marker = byId('aerial-marker'), status = byId('aerial-status');
  let serial = 0, pendingImage, timeout, match = null, view = null, center = null;
  let width = DEFAULT_VIEW_METERS, loaded = false, pointer = null, has3d = false, saved = null;
  const toggle3d = byId('aerial-3d-toggle'), widthLabel = byId('aerial-width'), tools3d = byId('aerial-3d-controls'), topButton = byId('aerial-3d-top');
  const north = document.querySelector('.aerial-north'), usgsCredit = document.querySelector('.aerial-meta a');
  const view3d = setupProperty3D({ stage, onFailure: () => { if (saved) unavailable3d(); } });
  const toggleMap = byId('aerial-map-toggle'), mapControls = byId('map-mode-controls'), mapCredit = byId('map-attribution');
  const viewMap = setupPropertyMap({
    stage, onFailure: unavailableMap,
    onStatus: message => { if (viewMap.isOpen) { if (status.textContent !== message) status.textContent = message; syncMap(); } },
    onSelection: selected => { byId('map-clear-selection').hidden = !selected; byId('map-selection').hidden = !selected; }
  });
  view3d.available.then(ok => { has3d = ok; sync3d(); });
  function sync3d() {
    toggle3d.hidden = !has3d || !match;
    toggle3d.textContent = view3d.isOpen ? 'Aerial photo' : 'View in 3D';
    if (!view3d.isOpen) tools3d.hidden = true;
    // North-up and the USGS credit describe the aerial photo; the 3D view rotates and credits Google on screen.
    north.hidden = usgsCredit.hidden = view3d.isOpen;
    topButton.setAttribute('aria-pressed', String(view3d.isOpen && view3d.isTop));
  }
  function syncMap() {
    toggleMap.hidden = !viewMap.available || !match;
    toggleMap.textContent = viewMap.isOpen ? 'Back to aerial view' : 'Explore map';
    toggleMap.setAttribute('aria-pressed', String(viewMap.isOpen));
    mapControls.hidden = mapCredit.hidden = !viewMap.isOpen;
    if (viewMap.isOpen) widthLabel.textContent = `${viewMap.mode === 'hybrid' ? 'HYBRID' : 'MAP'} · DISPLAY ONLY`;
    for (const button of mapControls.querySelectorAll('[data-map-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mapMode === viewMap.mode));
    byId('map-hybrid').disabled = !match || !hasAerialCoverage(match.coordinates);
  }
  /** Puts the aerial controls and text back exactly as they were, resuming an interrupted image load. */
  function restore2d() {
    const previous = saved; saved = null; sync3d(); syncMap();
    if (!previous) return;
    tools.hidden = previous.tools; widthLabel.textContent = previous.width; status.textContent = previous.status;
    if (previous.reload) load();
  }
  function unavailable3d() { view3d.close(); restore2d(); status.textContent = 'The 3D view is unavailable right now. The aerial view still works.'; }
  function unavailableMap() { viewMap.close(); restore2d(); status.textContent = 'The interactive map is unavailable right now. The aerial view and your estimate still work.'; }
  async function openMap() {
    if (view3d.isOpen) { view3d.close(); restore2d(); }
    const location = match;
    saved = { tools: tools.hidden, width: widthLabel.textContent, status: status.textContent, reload: Boolean(pendingImage) };
    if (saved.reload) cancel();
    tools.hidden = true; widthLabel.textContent = 'MAP · DISPLAY ONLY'; status.textContent = 'Loading the interactive map…';
    const pending = viewMap.show(location); syncMap();
    try {
      const ready = await pending;
      if (!ready || !viewMap.isOpen || match !== location) return;
      status.textContent = viewMap.message; syncMap();
    } catch { if (match === location && saved) unavailableMap(); }
  }
  /** Opens 3D over the current view. `reload` loads the aerial photo if 3D is closed or fails. */
  async function open3d({ reload = Boolean(pendingImage) } = {}) {
    if (viewMap.isOpen) { viewMap.close(); restore2d(); }
    const location = match;
    saved = { tools: tools.hidden, width: widthLabel.textContent, status: status.textContent, reload };
    if (pendingImage) cancel();
    tools.hidden = true; widthLabel.textContent = 'GOOGLE 3D · DISPLAY ONLY';
    status.textContent = 'Loading the Google 3D view…';
    const pending = view3d.show(location); sync3d(); syncMap();
    let result;
    try { result = await pending; }
    catch { if (match === location && saved) unavailable3d(); return; }
    if (!result || !view3d.isOpen) return;
    tools3d.hidden = result !== 'framed'; sync3d();
    status.textContent = result === 'framed'
      ? 'Google 3D view. The dot is the approximate address point. Drag to orbit, scroll or pinch to zoom, or use Top view. For recognizing the building only; it supplies no measurements.'
      : 'Google 3D view from above. Zoom in to find the building. It supplies no measurements.';
  }
  function cancel() {
    serial++; clearTimeout(timeout);
    if (pendingImage) { pendingImage.onload = pendingImage.onerror = null; pendingImage.removeAttribute('src'); pendingImage = null; }
    stage.removeAttribute('aria-busy');
  }
  function placeholder(title, text) {
    overlay.hidden = false; byId('aerial-placeholder-title').textContent = title; byId('aerial-placeholder-text').textContent = text;
  }
  function clear() {
    cancel(); view3d.close(); viewMap.close(); saved = null; match = view = center = pointer = null; loaded = false; width = DEFAULT_VIEW_METERS; sync3d(); syncMap();
    images.replaceChildren(); marker.setAttribute('hidden', ''); tools.hidden = true; byId('aerial-retry').hidden = true;
    byId('aerial-address').textContent = 'Start with your address'; byId('aerial-width').textContent = 'AERIAL PREVIEW';
    placeholder('Your place starts here.', 'Type a complete U.S. address. Your property will appear automatically.');
    status.textContent = 'An aerial view helps you recognize the building. It does not supply renovation measurements.';
  }
  function searching() {
    clear(); stage.setAttribute('aria-busy', 'true');
    placeholder('Finding your place…', 'Matching the address, then bringing the surrounding buildings into view.');
    status.textContent = 'Looking up the approximate address location…';
  }
  function failed(message = 'No location match yet. Check the address or continue with your home details.') {
    clear(); placeholder('Let’s find your place.', message); status.textContent = message;
  }
  function syncMarker() {
    const p = pointInView(view, match.coordinates);
    marker.toggleAttribute('hidden', p.x < 0 || p.x > 960 || p.y < 0 || p.y > 600);
    byId('aerial-marker-point').setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`);
  }
  function load() {
    if (view3d.isOpen) { view3d.close(); saved = null; sync3d(); }
    if (viewMap.isOpen) { viewMap.close(); saved = null; syncMap(); }
    cancel(); const requestSerial = serial;
    let next;
    try { next = aerialView(center, width); }
    catch { status.textContent = 'That view is outside the available aerial coverage. Recenter on the address.'; return; }
    loaded = false; images.replaceChildren(); marker.setAttribute('hidden', ''); tools.hidden = true;
    stage.setAttribute('aria-busy', 'true'); byId('aerial-retry').hidden = true;
    placeholder('Bringing your place into view…', 'Loading aerial imagery. Some locations take a little longer.');
    status.textContent = 'Loading USGS / USDA aerial imagery…';
    const img = new Image(); pendingImage = img;
    img.alt = `Aerial imagery around ${match.matchedAddress}; the address location is approximate.`;
    img.width = 960; img.height = 600; img.decoding = 'async'; img.referrerPolicy = 'no-referrer'; img.draggable = false;
    const error = () => {
      if (requestSerial !== serial) return;
      cancel(); placeholder('Aerial view is unavailable.', 'Retry the imagery, or use your own exterior photo. Your estimate still works.');
      byId('aerial-retry').hidden = false; status.textContent = 'The imagery service did not return a view. Coverage and image age vary by location.';
    };
    img.onerror = error;
    img.onload = () => {
      if (requestSerial !== serial) return;
      if (!img.naturalWidth || !img.naturalHeight) { error(); return; }
      clearTimeout(timeout); pendingImage = null; img.onload = img.onerror = null;
      view = next; loaded = true; images.replaceChildren(img); overlay.hidden = true; tools.hidden = false;
      stage.removeAttribute('aria-busy'); syncMarker();
      byId('aerial-width').textContent = `VIEW WIDTH · ${Math.round(width)} M`;
      byId('aerial-zoom-in').disabled = width <= 60; byId('aerial-zoom-out').disabled = width >= 1200;
      status.textContent = 'Aerial view ready. The pin is an approximate Census address point. Pan or tap the image to center the building.';
    };
    timeout = setTimeout(error, 25000); img.src = next.url;
  }
  function show(location) {
    if (!isAddressMatch(location)) { failed(); return; }
    clear(); match = location; byId('aerial-address').textContent = location.matchedAddress; sync3d(); syncMap();
    const covered = hasAerialCoverage(location.coordinates);
    if (covered) center = { ...location.coordinates };
    else {
      placeholder('No aerial coverage here yet.', 'This preview covers the contiguous U.S. You can use your own exterior photo for this property.');
      status.textContent = 'Address matched. Aerial imagery for Alaska, Hawaii and U.S. territories is not connected.';
    }
    // The 3D view leads when it is available; the aerial photo loads only if 3D is closed or fails.
    if (has3d) open3d({ reload: covered });
    else if (covered) load();
  }
  function pan(x, y) {
    if (!loaded || !view) return;
    const next = moveView(view, x, y);
    if (!hasAerialCoverage(next)) { status.textContent = 'You reached the edge of aerial coverage.'; return; }
    center = next; load();
  }
  for (const button of tools.querySelectorAll('[data-pan]')) button.addEventListener('click', () => {
    const [x, y] = button.dataset.pan.split(',').map(Number); pan(x, y);
  });
  byId('aerial-zoom-in').addEventListener('click', () => { width = Math.max(60, width / 1.6); load(); });
  byId('aerial-zoom-out').addEventListener('click', () => { width = Math.min(1200, width * 1.6); load(); });
  byId('aerial-recenter').addEventListener('click', () => { center = { ...match.coordinates }; width = DEFAULT_VIEW_METERS; load(); });
  byId('aerial-retry').addEventListener('click', load);
  byId('aerial-photo').addEventListener('click', onPhoto);
  toggle3d.addEventListener('click', () => { if (view3d.isOpen) { view3d.close(); restore2d(); } else if (match) open3d(); });
  toggleMap.addEventListener('click', () => { if (viewMap.isOpen) { viewMap.close(); restore2d(); } else if (match) openMap(); });
  for (const button of mapControls.querySelectorAll('[data-map-mode]')) button.addEventListener('click', () => { viewMap.setMode(button.dataset.mapMode); syncMap(); });
  byId('map-recenter').addEventListener('click', () => viewMap.recenter());
  byId('map-clear-selection').addEventListener('click', () => viewMap.clearSelection());
  topButton.addEventListener('click', () => { view3d.setTop(!view3d.isTop); sync3d(); });
  byId('aerial-3d-rotate').addEventListener('click', () => view3d.rotate());
  byId('aerial-3d-recenter').addEventListener('click', () => view3d.recenter());
  stage.addEventListener('keydown', event => {
    const delta = { ArrowLeft: [-.3, 0], ArrowRight: [.3, 0], ArrowUp: [0, -.3], ArrowDown: [0, .3] }[event.key];
    if (!delta || !loaded || view3d.isOpen || viewMap.isOpen) return; event.preventDefault(); pan(...delta);
  });
  stage.addEventListener('pointerdown', event => {
    if (!loaded || view3d.isOpen || viewMap.isOpen || event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    if (event.pointerType === 'mouse') stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointercancel', () => { pointer = null; });
  stage.addEventListener('pointerup', event => {
    const start = pointer; pointer = null;
    if (!start || start.id !== event.pointerId || !loaded) return;
    const bounds = stage.getBoundingClientRect(), dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) < 6) pan((event.clientX - bounds.left) / bounds.width - .5, (event.clientY - bounds.top) / bounds.height - .5);
    else if (event.pointerType === 'mouse') pan(-dx / bounds.width, -dy / bounds.height);
  });
  clear(); return { clear, searching, failed, show };
}
