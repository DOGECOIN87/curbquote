import { isAddressMatch } from './address.js';
import { aerialView, hasAerialCoverage, moveView, pointInView, DEFAULT_VIEW_METERS } from './property-view.js';
import { setupProperty3D } from './property-3d.js';
import { setupPropertyMap } from './property-map.js';
import { streetView, flyoverAvailable, flyoverVideo } from './google-maps.js';
import { webgl2Available } from './cesium-runtime.js';

/**
 * Images are replaced atomically and discarded immediately when the address changes.
 * The property view degrades in tiers, so something useful always shows:
 * reviewed local exterior → Google 3D (key or Cesium ion) → key-free open 3D buildings
 * (OpenStreetMap heights) → USGS aerial photo → street map → the homeowner's own photo.
 * The stage's data-view (empty, busy, error, matched) lets the Step 1 canvas show its welcome state.
 * After a match the 3D view leads and circles the building (not with reduced motion); choosing the
 * aerial photo is remembered on this device, so later matches open the photo instead. When Google
 * already has an Aerial View flyover of the address, it plays first as a lead-in over the loading
 * 3D view and hands over to the interactive view when it ends or is tapped away (never with
 * reduced motion, and never over a reviewed local exterior).
 */
const VIEW_KEY = 'curbquote.property.view';
// How long a match waits for the 3D credential check before choosing a view without it.
const AVAILABLE_WAIT = 4000;
const GOOGLE_READY = 'Google 3D view. Drag to look around, scroll or pinch to zoom, tap a roof to measure that building, or use Top view. Measurements here are approximate; the estimate uses the sizes in Step 3.';
const prefers3d = () => { try { return localStorage.getItem(VIEW_KEY) !== 'photo'; } catch { return true; } };
const rememberView = value => { try { localStorage.setItem(VIEW_KEY, value); } catch {} };
export function setupPropertyPreview({ onPhoto, getDimensions = () => ({}), onConfirmSize, onUndoSize }) {
  const byId = id => document.getElementById(id);
  const stage = byId('aerial-stage'), images = byId('aerial-images'), tools = byId('aerial-controls');
  const overlay = byId('aerial-placeholder'), marker = byId('aerial-marker'), status = byId('aerial-status');
  let serial = 0, pendingImage, timeout, match = null, view = null, center = null;
  let width = DEFAULT_VIEW_METERS, loaded = false, pointer = null, has3d = false, saved = null, fallbackNote = '';
  const toggle3d = byId('aerial-3d-toggle'), widthLabel = byId('aerial-width'), tools3d = byId('aerial-3d-controls'), topButton = byId('aerial-3d-top'), orbitButton = byId('aerial-3d-orbit');
  const north = document.querySelector('.aerial-north'), usgsCredit = document.querySelector('.aerial-meta a');
  const view3d = setupProperty3D({ stage, getPadding: overlayPadding,
    onFailure: error => { if (saved) unavailable3d(error); },
    onViewChange: () => sync3d(),
    // A tap on a roof in Google's view measures that building.
    onPick: at => measure3d({ at }),
    // The detailed tiles arrived after the overview was shown: offer the view tools and start circling.
    onFramed: () => {
      if (!view3d.isOpen) return;
      tools3d.hidden = false; sync3d(); status.textContent = GOOGLE_READY;
      if (!view3d.isOrbiting && !matchMedia('(prefers-reduced-motion: reduce)').matches) view3d.orbit();
      measure3d();
    },
    onOrbitChange: orbiting => {
      if (orbiting) status.textContent = 'Circling the building in 3D. Drag, scroll or press 3D again to stop.';
      else if (view3d.isOpen) status.textContent = view3d.hasLocal(match)
        ? 'Roof surface from USGS laser surveys, with simplified walls. Drag to orbit; pinch or scroll to zoom. Openings and finishes are not captured. Preview only; no estimate measurements.'
        : GOOGLE_READY;
      sync3d();
    }
  });
  /** Measures the building in Google's view (or the one tapped); the chip says where the numbers came from. */
  async function measure3d(options) {
    const location = match, result = await view3d.measure(getDimensions() || {}, options);
    if (!result || match !== location || !view3d.isOpen) return;
    showMeasure({ note: {
      outline: result.measuredHeight ? 'Approximate, from the mapped outline and the 3D view' : 'Approximate, from the mapped outline',
      surface: 'Approximate, measured in the 3D view. Not your home? Tap its roof.',
      solar: 'Approximate, from Google’s roof data and the 3D view. Not your home? Tap its roof.'
    }[result.source] });
    offerSize(result);
  }
  // "Is this your home?": a measured building sizes the estimate only once the homeowner confirms it.
  const confirmCard = byId('measure-confirm'), confirmText = byId('measure-confirm-text');
  let offered = null, confirmed = null;
  const sameSize = (a, b) => a && b && a.sides.join() === b.sides.join() && a.heightFt === b.heightFt;
  function confirmState(state, text = '') {
    confirmCard.hidden = !state; confirmCard.dataset.state = state;
    if (state !== 'ask') photo.hidden = true;
    // The card changes the open area above it, so the house is framed again once it has laid out.
    requestAnimationFrame(() => view3d.refit());
    byId('measure-yes').hidden = byId('measure-no').hidden = state !== 'ask';
    byId('measure-undo').hidden = state !== 'done';
    if (state === 'ask') {
      const [short, long] = [...offered.sides].sort((a, b) => a - b), tall = offered.measuredHeight && offered.heightFt ? `, ${Math.round(offered.heightFt)} ft tall` : '';
      confirmText.textContent = `Is this your home? About ${long} × ${short} ft${tall}.`;
      showFront(offered);
    } else if (state === 'pick') confirmText.textContent = view3d.isOpen ? 'Tap your home’s roof in the 3D view to measure it.' : 'Tap your home on the map to measure it.';
    else if (text) confirmText.textContent = text;
  }
  /** A new measurement asks again, unless it is the building already confirmed (a replay or a re-frame). */
  // A Street View photo of the front of the measured building, shown as Google provides it.
  const photo = byId('measure-photo'), photoImage = photo.querySelector('img'), photoCredit = photo.querySelector('figcaption');
  let photoFor = null;
  async function showFront(measured) {
    const [lon, lat] = measured.centre || [match?.coordinates.lon, match?.coordinates.lat], key = `${lat},${lon}`;
    if (!Number.isFinite(lat) || photoFor === key) { photo.hidden = !photoImage.src; return; }
    photoFor = key; photo.hidden = true;
    const location = match, view = await streetView([lat, lon]);
    if (!view || match !== location || photoFor !== key || confirmCard.dataset.state !== 'ask') return;
    photoImage.onload = () => { photo.hidden = false; requestAnimationFrame(() => view3d.refit()); }; photoImage.onerror = () => { photo.hidden = true; };
    photoCredit.textContent = `Street View${view.date ? `, ${view.date}` : ''} · Google`;
    photoImage.src = view.url;
  }
  function offerSize(measured) {
    if (!measured?.sides || measured.sides.length < 2) { offered = null; if (confirmCard.dataset.state !== 'pick') confirmState(''); return; }
    offered = measured;
    if (sameSize(confirmed, measured)) return;
    confirmState('ask');
  }
  byId('measure-yes').addEventListener('click', () => {
    if (!offered) return;
    const applied = onConfirmSize?.(offered); confirmed = offered;
    confirmState('done', applied ? `Your estimate now uses ${applied}.` : 'Your estimate now uses this size.');
  });
  byId('measure-no').addEventListener('click', () => confirmState('pick'));
  byId('measure-undo').addEventListener('click', () => { onUndoSize?.(); confirmed = null; if (offered) confirmState('ask'); else confirmState(''); });
  // Google's pre-rendered Aerial View flyover, when one already exists for the address.
  const flyover = byId('flyover'), flyoverToggle = byId('flyover-toggle');
  let flyoverId = null, flyoverLead = false, flyoverSearch = null;
  function closeFlyover() { flyoverLead = false; flyover.classList.remove('flyover-out'); flyover.pause(); flyover.removeAttribute('src'); flyover.hidden = true; flyoverToggle.setAttribute('aria-pressed', 'false'); flyoverToggle.textContent = 'Flyover'; }
  /** The lead-in ends: fade the video out over the interactive 3D view that loaded beneath it. */
  function finishFlyoverLead() {
    if (!flyoverLead) return;
    flyoverLead = false; flyover.pause(); flyover.classList.add('flyover-out');
    setTimeout(() => { if (flyover.classList.contains('flyover-out')) closeFlyover(); }, 550);
    if (view3d.isOpen) status.textContent = GOOGLE_READY;
  }
  async function openFlyover({ lead = false } = {}) {
    const location = match, url = await flyoverVideo(flyoverId, { portrait: innerHeight > innerWidth });
    if (!url || match !== location) { if (!lead) status.textContent = 'The flyover video is unavailable right now.'; return; }
    flyover.setAttribute('aria-label', `Photorealistic aerial flyover of ${location.matchedAddress}, provided by Google Maps.`);
    // Reduced motion: the video waits for the homeowner to press play.
    flyover.controls = matchMedia('(prefers-reduced-motion: reduce)').matches; flyover.autoplay = !flyover.controls;
    // A lead-in plays once, so its end can hand over to the 3D view; a manual open loops.
    flyover.loop = !lead; flyoverLead = lead; flyover.classList.remove('flyover-out');
    flyover.src = url; flyover.hidden = false; flyoverToggle.setAttribute('aria-pressed', 'true'); flyoverToggle.textContent = lead ? 'Skip flyover' : 'Close flyover';
    status.textContent = lead
      ? 'A flyover of your place, from Google Maps. The interactive 3D view opens when it finishes — tap the video to skip ahead.'
      : 'Flyover video from Google Maps. Display only; it is not measured.';
  }
  flyover.addEventListener('ended', finishFlyoverLead);
  flyover.addEventListener('click', () => { if (flyoverLead) finishFlyoverLead(); });
  // On phones the view options fold behind one button in the 3D stack; picking one folds them again.
  const viewMore = byId('view-more'), viewFoot = byId('view-foot');
  const foldViews = open => { viewFoot.toggleAttribute('data-open', open); viewMore.setAttribute('aria-expanded', String(open)); };
  viewMore.addEventListener('click', () => foldViews(!viewFoot.hasAttribute('data-open')));
  viewFoot.querySelector('.aerial-actions').addEventListener('click', event => { if (event.target.closest('button')) foldViews(false); });
  flyoverToggle.addEventListener('click', () => { if (!flyover.hidden) closeFlyover(); else if (flyoverId) openFlyover(); });
  async function findFlyover(location) {
    const found = await flyoverAvailable(location.matchedAddress);
    if (!found || match !== location) return null;
    flyoverId = found.videoId; flyoverToggle.hidden = false;
    // Without WebGL there is no live 3D view, so the flyover leads.
    if (!webgl2Available()) openFlyover();
    return found;
  }
  const toggleMap = byId('aerial-map-toggle'), mapControls = byId('map-mode-controls'), mapCredit = byId('map-attribution'), mapOrbit = byId('map-orbit');
  const housenumbersWrap = byId('map-housenumbers'), housenumberListEl = byId('map-housenumber-list');
  /**
   * Space taken by the floating panels at the top and bottom of the view, in screen pixels. Only panels
   * across the middle of the view count: a search box in the top left corner does not hide the house.
   */
  function overlayPadding() {
    const box = stage.getBoundingClientRect();
    if (!box.height) return null;
    const middle = box.left + box.width / 2, band = box.width * .2, half = box.top + box.height / 2;
    const panels = [...document.querySelectorAll('.instant-estimate, .view-dock, .change-dock, :is(.view-top-left, .view-foot, .proposal-switch-wrap) > :not([hidden])')]
      .filter(el => el.offsetParent).map(el => el.getBoundingClientRect())
      .filter(r => r.width && r.right > middle - band && r.left < middle + band && r.height < box.height / 2);
    const header = parseFloat(getComputedStyle(stage).getPropertyValue('--map-top')) || 0;
    const top = Math.max(header, ...panels.filter(r => r.bottom < half).map(r => r.bottom - box.top));
    const bottom = Math.max(0, ...panels.filter(r => r.top > half).map(r => box.bottom - r.top));
    return { top: Math.min(top, box.height / 3), bottom: Math.min(bottom, box.height / 2), left: 0, right: 0 };
  }
  /** Moves the photo's centre south so the address sits in the open area above the bottom panels. */
  function framed(coords) {
    const padding = overlayPadding(), box = stage.getBoundingClientRect();
    if (!padding) return { ...coords };
    const imagePx = (padding.bottom - padding.top) / 2 / Math.max(box.width / 960, box.height / 600);
    return { lat: coords.lat - imagePx * width / 960 / 110540, lon: coords.lon };
  }
  const viewMap = setupPropertyMap({
    stage, onFailure: unavailableMap, getPadding: overlayPadding, onOrbitChange: () => syncMap(), getDimensions,
    onMeasure: result => {
      showMeasure(result && { ...result, note: 'Approximate, from the mapped building outline. Not your home? Tap it on the map.' });
      offerSize(result?.approximate ? { ...result, source: 'map' } : null);
    },
    onBearing: bearing => byId('map-north').style.setProperty('--bearing', `${-bearing}deg`),
    onStatus: message => {
      if (!viewMap.isOpen) return;
      const text = fallbackNote ? `${fallbackNote} ${message}` : message;
      if (status.textContent !== text) status.textContent = text;
      syncMap();
    },
    onSelection: selected => { byId('map-clear-selection').hidden = !selected; byId('map-selection').hidden = !selected; },
    onHousenumbers: list => {
      if (!viewMap.isOpen || !housenumbersWrap) return;
      housenumberListEl.replaceChildren();
      if (!list.length) { housenumbersWrap.hidden = true; return; }
      housenumbersWrap.hidden = false;
      for (const entry of list) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'housenumber-pill';
        btn.textContent = entry.housenumber;
        btn.setAttribute('role', 'listitem');
        btn.setAttribute('aria-label', `Center map on house number ${entry.housenumber}`);
        btn.addEventListener('click', () => viewMap.focusHousenumber(entry));
        housenumberListEl.append(btn);
      }
    }
  });
  view3d.available.then(ok => { has3d = ok; sync3d(); });
  const open3dShown = () => viewMap.isOpen && viewMap.mode === '3d';
  /** Tells the styles which view is showing: photo, map, hybrid, 3d (open buildings), google or exterior. */
  function syncMode() { stage.dataset.mode = viewMap.isOpen ? viewMap.mode : view3d.isOpen ? (view3d.isExterior ? 'exterior' : 'google') : 'photo'; }
  function sync3d() {
    syncMode();
    toggle3d.hidden = !match || !(has3d || view3d.hasLocal(match) || viewMap.available);
    toggle3d.textContent = view3d.isOpen || open3dShown() ? 'Aerial photo' : view3d.hasLocal(match) ? 'Exterior model' : 'View in 3D';
    if (!view3d.isOpen) tools3d.hidden = true;
    // Aerial orientation/credits do not describe the rotating model. Each 3D source has its own credit.
    north.hidden = usgsCredit.hidden = view3d.isOpen;
    if (open3dShown()) north.hidden = true;
    byId('exterior-credit').hidden = !(view3d.isOpen && view3d.isExterior);
    topButton.setAttribute('aria-pressed', String(view3d.isOpen && view3d.isTop));
    if (orbitButton) { orbitButton.setAttribute('aria-pressed', String(Boolean(view3d.isOrbiting))); orbitButton.hidden = !view3d.isOpen; }
  }
  function syncMap() {
    syncMode();
    toggleMap.hidden = !viewMap.available || !match;
    toggleMap.textContent = viewMap.isOpen ? 'Back to aerial view' : 'Explore map';
    toggle3d.textContent = view3d.isOpen || open3dShown() ? 'Aerial photo' : match && view3d.hasLocal(match) ? 'Exterior model' : 'View in 3D';
    toggleMap.setAttribute('aria-pressed', String(viewMap.isOpen));
    mapControls.hidden = mapCredit.hidden = !viewMap.isOpen;
    toggleMap.hidden ||= open3dShown(); byId('map-zoom').hidden = !viewMap.isOpen;
    mapOrbit.hidden = !open3dShown(); mapOrbit.textContent = viewMap.isOrbiting ? 'Stop orbit' : 'Orbit 360°';
    mapOrbit.setAttribute('aria-pressed', String(viewMap.isOrbiting));
    if (!viewMap.isOpen && housenumbersWrap) housenumbersWrap.hidden = true;
    if (viewMap.isOpen) widthLabel.textContent = `${viewMap.mode === '3d' ? 'Open 3D buildings' : viewMap.mode === 'hybrid' ? 'Hybrid' : 'Map'} · display only`;
    for (const button of mapControls.querySelectorAll('[data-map-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mapMode === viewMap.mode));
    byId('map-hybrid').disabled = !match || !hasAerialCoverage(match.coordinates);
  }
  /** Puts the aerial controls and text back exactly as they were, resuming an interrupted image load. */
  function restore2d() {
    const previous = saved; saved = null; sync3d(); syncMap();
    if (loaded) drawAerialMeasure();
    if (!previous) return;
    tools.hidden = previous.tools; widthLabel.textContent = previous.width; status.textContent = previous.status;
    if (previous.reload) load();
  }
  /** Says what to fix when Google 3D was refused, so a site owner can tell a token setting from an outage. */
  function refusalNote(error) {
    const code = error?.status;
    if (error?.via === 'ion' && (code === 401 || code === 403)) return 'Cesium ion refused the token for this site address: add it under the token’s Allowed URLs.';
    if (error?.via === 'ion' && code === 404) return 'This Cesium ion account cannot open Google’s 3D tiles.';
    if (error?.via === 'google' && (code === 400 || code === 403)) return 'Google refused the Map Tiles key for this site address.';
    return 'Google 3D is unavailable right now.';
  }
  /** Google 3D failed (denied key, quota, network): try the key-free 3D buildings before the aerial photo. */
  function unavailable3d(error) {
    const location = match, note = refusalNote(error);
    view3d.close(); closeFlyover(); restore2d(); status.dataset.tone = 'warn';
    if (viewMap.available && location && !view3d.hasLocal(location)) {
      fallbackNote = `${note} Showing the key-free 3D view.`;
      openMap({ initialMode: '3d', fallback: true }); status.textContent = `${note} Loading open 3D buildings instead…`; return;
    }
    status.textContent = `${note} The aerial view still works.`;
  }
  function unavailableMap(fallback = false) {
    viewMap.close(); restore2d();
    status.textContent = fallback ? 'The 3D view is unavailable right now. The aerial view still works.' : 'The interactive map is unavailable right now. The aerial view and your estimate still work.';
  }
  async function openMap({ initialMode = null, fallback = false, reload = false, orbit = false } = {}) {
    if (view3d.isOpen) { view3d.close(); restore2d(); }
    if (!fallback) { fallbackNote = ''; delete status.dataset.tone; }
    const location = match, solid = initialMode === '3d';
    saved = { tools: tools.hidden, width: widthLabel.textContent, status: status.textContent, reload: reload || Boolean(pendingImage) || Boolean(saved?.reload) };
    if (pendingImage) cancel();
    tools.hidden = true; widthLabel.textContent = solid ? 'Open 3D buildings · display only' : 'Map · display only';
    status.textContent = solid ? 'Loading open 3D buildings from OpenStreetMap…' : 'Loading the interactive map…';
    const pending = viewMap.show(location, { initialMode }); syncMap(); sync3d();
    try {
      const ready = await pending;
      if (!ready || !viewMap.isOpen || match !== location) return;
      status.textContent = fallbackNote ? `${fallbackNote} ${viewMap.message}` : viewMap.message;
      if (orbit) viewMap.orbit(true);
      syncMap(); sync3d();
    } catch { if (match === location && saved) unavailableMap(fallback || solid); }
  }
  /** Opens 3D over the current view. `reload` loads the aerial photo if 3D is closed or fails. */
  async function open3d({ reload = Boolean(pendingImage), orbit = false } = {}) {
    if (viewMap.isOpen) { viewMap.close(); restore2d(); }
    const location = match; fallbackNote = ''; delete status.dataset.tone;
    saved = { tools: tools.hidden, width: widthLabel.textContent, status: status.textContent, reload };
    if (pendingImage) cancel();
    const local = view3d.hasLocal(location);
    showMeasure(null); tools.hidden = true; widthLabel.textContent = local ? 'Exterior model · 2017 survey' : 'Google 3D · display only';
    status.textContent = local ? 'Loading the measured exterior model…' : 'Loading the Google 3D view…';
    const pending = view3d.show(location); sync3d(); syncMap();
    let result;
    try { result = await pending; }
    catch (error) { if (match === location && saved) unavailable3d(error); return; }
    if (!result || !view3d.isOpen) return;
    tools3d.hidden = result !== 'framed'; sync3d();
    // Circling starts on any successful open, framed or overview: gating it on 'framed' meant
    // phones (where the height sample often lands late) never saw the Earth-style rotation.
    if (orbit && !view3d.isOrbiting && !matchMedia('(prefers-reduced-motion: reduce)').matches) view3d.orbit();
    status.textContent = local
      ? 'Roof surface from USGS laser surveys, with simplified walls. Drag to orbit; pinch or scroll to zoom. Openings and finishes are not captured. Preview only; no estimate measurements.'
      : view3d.isOrbiting ? 'Circling the building in 3D. Drag, scroll or press 3D again to stop.'
      : result === 'framed' ? GOOGLE_READY
      : 'Google 3D view from above while the detailed view loads. It moves in on the building when it is ready.';
    // The camera keeps circling while the measuring pass samples the surface and draws.
    if (!local && result === 'framed') measure3d();
  }
  function cancel() {
    serial++; clearTimeout(timeout);
    if (pendingImage) { pendingImage.onload = pendingImage.onerror = null; pendingImage.removeAttribute('src'); pendingImage = null; }
    stage.removeAttribute('aria-busy');
  }
  const measureChip = byId('measure-chip'), measureNote = byId('measure-note'), measureGroup = byId('aerial-measure');
  function showMeasure(result) {
    measureChip.hidden = !result;
    if (!result && confirmCard.dataset.state !== 'done') confirmState('');
    if (result) measureNote.textContent = result.note;
  }
  function clearAerialMeasure() { measureGroup.replaceChildren(); }
  /**
   * Draws the measured size on the top-down photo — only when the size came from real building
   * data. Without it nothing is drawn: a default rectangle on someone's actual property reads as
   * a measurement that never happened.
   */
  function drawAerialMeasure() {
    clearAerialMeasure();
    if (!loaded || !view || !match) return;
    const dims = getDimensions() || {};
    if (!dims.fromPublicData) return;
    const lengthFt = dims.lengthFt || 48, widthFt = dims.widthFt || 34;
    const perFoot = 960 / (width * 3.28084), p = pointInView(view, match.coordinates);
    const w = lengthFt * perFoot, h = widthFt * perFoot, x0 = p.x - w / 2, y0 = p.y - h / 2, gap = 14, svg = 'http://www.w3.org/2000/svg';
    const path = (d, className) => { const el = document.createElementNS(svg, 'path'); el.setAttribute('d', d); el.setAttribute('class', className); el.setAttribute('pathLength', '1'); el.setAttribute('vector-effect', 'non-scaling-stroke'); measureGroup.append(el); };
    path(`M${x0} ${y0}H${x0 + w}V${y0 + h}H${x0}Z`, 'measure-trace measure-glow');
    path(`M${x0} ${y0}H${x0 + w}V${y0 + h}H${x0}Z`, 'measure-trace');
    path(`M${x0} ${y0 + h + gap}H${x0 + w}M${x0} ${y0 + h + gap - 6}v12M${x0 + w} ${y0 + h + gap - 6}v12`, 'measure-dim');
    path(`M${x0 + w + gap} ${y0}V${y0 + h}M${x0 + w + gap - 6} ${y0}h12M${x0 + w + gap - 6} ${y0 + h}h12`, 'measure-dim');
    for (const [cx, cy] of [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]) {
      const dot = document.createElementNS(svg, 'circle'); dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('r', '4'); dot.setAttribute('class', 'measure-corner'); measureGroup.append(dot);
    }
    for (const [feet, lx, ly] of [[lengthFt, x0 + w / 2, y0 + h + gap], [widthFt, x0 + w + gap, y0 + h / 2]]) {
      const text = `≈ ${Math.round(feet)} ft`, tag = document.createElementNS(svg, 'g'), box = document.createElementNS(svg, 'rect'), words = document.createElementNS(svg, 'text');
      const boxW = text.length * 7.2 + 16;
      tag.setAttribute('class', 'measure-tag'); tag.setAttribute('transform', `translate(${lx} ${ly})`);
      Object.entries({ x: -boxW / 2, y: -12, width: boxW, height: 24, rx: 7 }).forEach(([k, v]) => box.setAttribute(k, v));
      words.setAttribute('text-anchor', 'middle'); words.setAttribute('dy', '4.5'); words.textContent = text;
      tag.append(box, words); measureGroup.append(tag);
    }
    showMeasure({ note: 'Size from public data; placement is illustrative' });
  }
  function placeholder(title, text) {
    overlay.hidden = false; byId('aerial-placeholder-title').textContent = title; byId('aerial-placeholder-text').textContent = text;
  }
  function clear() {
    closeFlyover(); flyoverId = null; flyoverSearch = null; flyoverToggle.hidden = true;
    cancel(); view3d.close(); viewMap.close(); saved = null; match = view = center = pointer = photoFor = null; photo.hidden = true; photoImage.removeAttribute('src'); loaded = false; width = DEFAULT_VIEW_METERS; fallbackNote = ''; delete status.dataset.tone; offered = confirmed = null; confirmState(''); sync3d(); syncMap();
    if (housenumbersWrap) housenumbersWrap.hidden = true;
    if (housenumberListEl) housenumberListEl.replaceChildren();
    images.replaceChildren(); marker.setAttribute('hidden', ''); tools.hidden = true; byId('aerial-retry').hidden = true;
    stage.dataset.view = 'empty'; clearAerialMeasure(); showMeasure(null); byId('aerial-address').textContent = 'Start with your address'; byId('aerial-width').textContent = 'Aerial preview';
    placeholder('Your place starts here.', 'Type a complete U.S. address. Your property will appear automatically.');
    status.textContent = 'An aerial view helps you recognize the building. It does not supply renovation measurements.';
  }
  function searching() {
    clear(); stage.setAttribute('aria-busy', 'true'); stage.dataset.view = 'busy';
    placeholder('Finding your place…', 'Matching the address, then bringing the surrounding buildings into view.');
    status.textContent = 'Looking up the approximate address location…';
  }
  function failed(message = 'No location match yet. Check the address or continue with your home details.') {
    clear(); stage.dataset.view = 'error'; placeholder('Let’s find your place.', message); status.textContent = message;
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
    loaded = false; images.replaceChildren(); marker.setAttribute('hidden', ''); tools.hidden = true; clearAerialMeasure();
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
      stage.removeAttribute('aria-busy'); syncMarker(); drawAerialMeasure();
      byId('aerial-width').textContent = `View width · ${Math.round(width)} m`;
      byId('aerial-zoom-in').disabled = width <= 60; byId('aerial-zoom-out').disabled = width >= 1200;
      status.textContent = has3d || view3d.hasLocal(match)
        ? 'Aerial view ready. The pin is an approximate Census address point. Pan or tap the image to center the building.'
        : 'Aerial view ready (optional 3D tiles are not connected here). The pin is an approximate Census address point. Pan or tap the image to center the building.';
    };
    timeout = setTimeout(error, 25000); img.src = next.url;
  }
  function show(location) {
    if (!isAddressMatch(location)) { failed(); return; }
    clear(); match = location; stage.dataset.view = 'matched'; byId('aerial-address').textContent = location.matchedAddress; sync3d(); syncMap(); flyoverSearch = findFlyover(location);
    const covered = hasAerialCoverage(location.coordinates);
    if (covered) center = framed(location.coordinates);
    else {
      placeholder('No aerial coverage here yet.', 'This preview covers the contiguous U.S. You can use your own exterior photo for this property.');
      status.textContent = 'Address matched. Aerial imagery for Alaska, Hawaii and U.S. territories is not connected.';
    }
    // The 3D view leads and circles the building; the aerial photo loads only if 3D is closed or fails,
    // or when this visitor chose the photo before. A saved address can match before the 3D check
    // answers, so wait briefly for it rather than settling for the key-free view.
    const choose = async () => {
      if (match !== location) return;
      if (view3d.hasLocal(location) || has3d) {
        // When Google already has a flyover of this address, it leads: the 3D view loads
        // underneath and the video hands over to it when it ends or is tapped away. The
        // flyover lookup gets a short grace period so a slow answer never delays the 3D view.
        const lead = !view3d.hasLocal(location) && !matchMedia('(prefers-reduced-motion: reduce)').matches
          ? await Promise.race([flyoverSearch, new Promise(resolve => setTimeout(() => resolve(null), 2500))]).catch(() => null)
          : null;
        if (match !== location) return;
        open3d({ reload: covered, orbit: true });
        if (lead) openFlyover({ lead: true });
      }
      else if (viewMap.available && prefers3d()) openMap({ initialMode: '3d', reload: covered, orbit: true });
      else if (covered) load();
    };
    Promise.race([view3d.available, new Promise(resolve => setTimeout(resolve, AVAILABLE_WAIT))]).then(ok => { if (ok) has3d = true; choose(); });
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
  byId('aerial-recenter').addEventListener('click', () => { width = DEFAULT_VIEW_METERS; center = framed(match.coordinates); load(); });
  byId('aerial-retry').addEventListener('click', load);
  byId('aerial-photo').addEventListener('click', onPhoto);
  toggle3d.addEventListener('click', () => {
    if (view3d.isOpen) { rememberView('photo'); view3d.close(); closeFlyover(); restore2d(); }
    else if (open3dShown()) { rememberView('photo'); viewMap.close(); closeFlyover(); restore2d(); }
    else if (match && (has3d || view3d.hasLocal(match))) { rememberView('3d'); open3d({ orbit: true }); }
    else if (match) { rememberView('3d'); openMap({ initialMode: '3d', orbit: true }); }
  });
  mapOrbit.addEventListener('click', () => { viewMap.orbit(); syncMap(); });
  byId('map-zoom-in').addEventListener('click', () => viewMap.zoomBy(1));
  byId('map-zoom-out').addEventListener('click', () => viewMap.zoomBy(-1));
  byId('map-north').addEventListener('click', () => viewMap.north());
  byId('measure-replay').addEventListener('click', () => { if (viewMap.isOpen) viewMap.measure(); else if (view3d.isOpen) measure3d(); else drawAerialMeasure(); });
  toggleMap.addEventListener('click', () => { if (viewMap.isOpen) { viewMap.close(); restore2d(); } else if (match) { closeFlyover(); openMap(); } });
  for (const button of mapControls.querySelectorAll('[data-map-mode]')) button.addEventListener('click', () => { viewMap.setMode(button.dataset.mapMode); syncMap(); sync3d(); });
  byId('map-recenter').addEventListener('click', () => viewMap.recenter());
  byId('map-clear-selection').addEventListener('click', () => viewMap.clearSelection());
  topButton.addEventListener('click', () => { view3d.setTop(!view3d.isTop); sync3d(); });
  byId('aerial-3d-rotate').addEventListener('click', () => { view3d.rotate(); sync3d(); });
  byId('aerial-3d-recenter').addEventListener('click', () => { view3d.recenter(); sync3d(); });
  orbitButton?.addEventListener('click', () => view3d.orbit());
  byId('aerial-3d-zoom-in').addEventListener('click', () => view3d.zoomBy(1));
  byId('aerial-3d-zoom-out').addEventListener('click', () => view3d.zoomBy(-1));
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
    // The photo covers the stage (cropped, never stretched), so screen points map through that crop.
    const bounds = stage.getBoundingClientRect(), dx = event.clientX - start.x, dy = event.clientY - start.y;
    const scale = Math.max(bounds.width / 960, bounds.height / 600), shownW = 960 * scale, shownH = 600 * scale;
    const left = bounds.left + (bounds.width - shownW) / 2, top = bounds.top + (bounds.height - shownH) / 2;
    if (Math.hypot(dx, dy) < 6) pan((event.clientX - left) / shownW - .5, (event.clientY - top) / shownH - .5);
    else if (event.pointerType === 'mouse') pan(-dx / shownW, -dy / shownH);
  });
  /** New dimensions (for example from the public building outline) redraw the measuring pass in view. */
  const remeasure = () => {
    if (view3d.isOpen) { if (!view3d.isExterior) measure3d(); }
    else if (loaded && !viewMap.isOpen) drawAerialMeasure();
  };
  clear(); return { clear, searching, failed, show, remeasure };
}
