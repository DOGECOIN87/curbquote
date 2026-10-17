import { isAddressMatch } from './address.js';
import { aerialView, hasAerialCoverage, moveView, pointInView, DEFAULT_VIEW_METERS } from './property-view.js';

/** Images are replaced atomically and discarded immediately when the address changes. */
export function setupPropertyPreview({ onPhoto }) {
  const byId = id => document.getElementById(id);
  const stage = byId('aerial-stage'), images = byId('aerial-images'), tools = byId('aerial-controls');
  const overlay = byId('aerial-placeholder'), marker = byId('aerial-marker'), status = byId('aerial-status');
  let serial = 0, pendingImage, timeout, match = null, view = null, center = null;
  let width = DEFAULT_VIEW_METERS, loaded = false, pointer = null;
  function cancel() {
    serial++; clearTimeout(timeout);
    if (pendingImage) { pendingImage.onload = pendingImage.onerror = null; pendingImage.removeAttribute('src'); pendingImage = null; }
    stage.removeAttribute('aria-busy');
  }
  function placeholder(title, text) {
    overlay.hidden = false; byId('aerial-placeholder-title').textContent = title; byId('aerial-placeholder-text').textContent = text;
  }
  function clear() {
    cancel(); match = view = center = pointer = null; loaded = false; width = DEFAULT_VIEW_METERS;
    images.replaceChildren(); marker.setAttribute('hidden', ''); tools.hidden = true; byId('aerial-retry').hidden = true;
    byId('aerial-address').textContent = 'Start with your address'; byId('aerial-width').textContent = 'AERIAL PREVIEW';
    placeholder('Your place starts here.', 'Type a complete U.S. address. An aerial view will appear automatically.');
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
    clear(); match = location; byId('aerial-address').textContent = location.matchedAddress;
    if (!hasAerialCoverage(location.coordinates)) {
      placeholder('No aerial coverage here yet.', 'This preview covers the contiguous U.S. You can use your own exterior photo for this property.');
      status.textContent = 'Address matched. Aerial imagery for Alaska, Hawaii and U.S. territories is not connected.'; return;
    }
    center = { ...location.coordinates }; load();
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
  stage.addEventListener('keydown', event => {
    const delta = { ArrowLeft: [-.3, 0], ArrowRight: [.3, 0], ArrowUp: [0, -.3], ArrowDown: [0, .3] }[event.key];
    if (!delta || !loaded) return; event.preventDefault(); pan(...delta);
  });
  stage.addEventListener('pointerdown', event => {
    if (!loaded || event.button !== 0) return;
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
