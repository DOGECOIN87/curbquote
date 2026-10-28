import { isAddressMatch } from './address.js';
import { hasAerialCoverage } from './property-view.js';
import { propertyMapStyle, buildingHighlight, emptySelection } from './map-style.js';
import { webgl2Available } from './property-3d.js';
import { setupMapMeasure, measureOutline, FEET_PER_METER } from './measure-overlay.js';

const VENDOR = new URL('./vendor/maplibre/', import.meta.url).href;
const LOAD_TIMEOUT = 20000;
let renderer;
let stylesheet;
function loadRenderer() {
  stylesheet ??= new Promise((resolve, reject) => {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = `${VENDOR}maplibre-gl.css`;
    link.onload = resolve; link.onerror = () => { stylesheet = null; link.remove(); reject(new Error('Map stylesheet unavailable.')); };
    document.head.append(link);
  });
  renderer ??= import(`${VENDOR}maplibre-gl.mjs`).catch(error => { renderer = null; throw error; });
  return Promise.all([renderer, stylesheet]).then(([api]) => api);
}

/** A lazy, display-only map. Closing removes tiles, highlights, workers and the WebGL context. */
export function setupPropertyMap({ stage, onStatus, onSelection, onHousenumbers, onFailure, onOrbitChange, onMeasure, onBearing, getDimensions, getPadding = () => null }) {
  const container = document.createElement('div'); container.id = 'property-map'; container.className = 'aerial-map'; container.hidden = true;
  container.setAttribute('aria-label', 'Interactive map around the approximate address'); stage.append(container);
  let map = null, open = false, serial = 0, location = null, mode = 'hybrid', stopWaiting, dataReady = false, aerialReady = false;
  const MODE_KEY = 'curbquote.map.mode';
  const loadMode = () => { try { const v = localStorage.getItem(MODE_KEY); return v === 'hybrid' || v === 'map' ? v : null; } catch { return null; } };
  const motion = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900;
  const saveMode = v => { try { localStorage.setItem(MODE_KEY, v); } catch {} };
  const available = webgl2Available();
  // The orbit waits for the first measuring pass (it needs a still map), then circles the building.
  let orbitFrame = 0, orbitWanted = false, settled = false, measurer = null;
  /** Measures the mapped building under a screen point. No mapped building, no drawing — a default rectangle on a real property would read as a measurement that never happened. */
  function measureAt(point = null) {
    if (!map || !measurer || !location) return null;
    const { lon, lat } = location.coordinates, at = point || map.project([lon, lat]);
    const layer = mode === '3d' ? 'building-3d' : 'building-fill';
    let raw = null;
    try { raw = map.getLayer(layer) ? map.queryRenderedFeatures([[at.x - 10, at.y - 10], [at.x + 10, at.y + 10]], { layers: [layer] }).find(f => buildingHighlight(f)) : null; } catch {}
    const geometry = raw?.geometry, ring = geometry?.type === 'Polygon' ? geometry.coordinates[0] : geometry?.type === 'MultiPolygon' ? geometry.coordinates[0][0] : null;
    const fallback = getDimensions?.() || {}, mapped = ring ? measureOutline(ring) : null;
    const shape = mapped;
    if (!shape) { onMeasure?.(null); return null; }
    // Only a plausible mapped height is used; the rest falls back to the stories on this page.
    const mappedHeight = Number(raw?.properties?.render_height);
    const heightFt = mapped && mappedHeight > 3 && mappedHeight < 40 ? mappedHeight * FEET_PER_METER : fallback.heightFt;
    const shown = measurer.play(shape, { heightFt });
    onMeasure?.(shown && { ...shown, approximate: Boolean(mapped), measuredHeight: Boolean(mapped) && heightFt !== fallback.heightFt });
    return shown;
  }
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function stopOrbit() {
    if (!orbitFrame && !orbitWanted) return;
    cancelAnimationFrame(orbitFrame); orbitFrame = 0; orbitWanted = false; onOrbitChange?.(false);
  }
  /** Circles the 3D buildings view around its centre. Any drag, wheel, key or mode change stops it. */
  function orbit(on = !(orbitFrame || orbitWanted)) {
    if (!on || !map || mode !== '3d' || reduced()) { stopOrbit(); return false; }
    if (orbitFrame || orbitWanted) return true;
    if (!settled) { orbitWanted = true; onOrbitChange?.(true); return true; }
    startOrbit(); return true;
  }
  function startOrbit() {
    let last = performance.now(); orbitWanted = false; onOrbitChange?.(true);
    const tick = now => {
      if (!map || mode !== '3d') { orbitFrame = 0; onOrbitChange?.(false); return; }
      // A hidden step keeps its place in the turn without rendering.
      if (container.offsetParent) map.setBearing(map.getBearing() + Math.min(.05, (now - last) / 1000) * 7);
      last = now; orbitFrame = requestAnimationFrame(tick);
    };
    orbitFrame = requestAnimationFrame(tick);
  }
  for (const type of ['pointerdown', 'wheel', 'keydown']) container.addEventListener(type, stopOrbit, { passive: true });
  function refreshHousenumbers() {
    if (!map || !open || !onHousenumbers) return;
    try {
      const features = map.queryRenderedFeatures({ layers: ['housenumber'] });
      const seen = new Map();
      for (const f of features) {
        const num = f.properties?.housenumber;
        if (!num) continue;
        const key = String(num);
        if (seen.has(key)) continue;
        const geom = f.geometry;
        if (geom?.type === 'Point' && Array.isArray(geom.coordinates) && geom.coordinates.length === 2) {
          seen.set(key, { housenumber: key, lon: geom.coordinates[0], lat: geom.coordinates[1] });
        } else if (seen.size < 20) {
          // Fallback: centre of map if geometry missing
          seen.set(key, { housenumber: key, lon: null, lat: null });
        }
      }
      const list = [...seen.values()].sort((a,b) => (Number(a.housenumber)||0) - (Number(b.housenumber)||0)).slice(0, 16);
      onHousenumbers(list);
    } catch {}
  }
  function close() {
    stopOrbit(); settled = false; serial++; open = false; dataReady = aerialReady = false; stopWaiting?.(); stopWaiting = null;
    const previous = map; map = null; measurer = null; onMeasure?.(null);
    try { previous?.remove(); } catch { /* context may already be lost */ }
    container.replaceChildren(); container.hidden = true; container.removeAttribute('aria-busy'); onSelection?.(false);
  }
  function message() {
    if (mode === '3d') return 'Open 3D buildings ready. Heights come from OpenStreetMap where mapped and are approximate. Drag to pan, right-drag or two-finger drag to tilt and rotate; dragging also stops the orbit. Display only; no measurements.';
    const prefix = mode === 'hybrid' ? aerialReady ? 'Hybrid view ready.' : 'Map ready; aerial imagery is loading.' : 'Map view ready.';
    return `${prefix} Tap a mapped building to highlight it. Drag, use arrow keys, or use two fingers on a phone. The dot is an approximate address point.`;
  }
  function setMode(value) {
    const covered = hasAerialCoverage(location?.coordinates);
    const next = value === '3d' ? '3d' : value === 'hybrid' && covered ? 'hybrid' : 'map';
    const imagery = next !== 'map' && covered;
    if (next === mode && map?.getLayer('aerial') && map.getLayoutProperty('aerial', 'visibility') === (imagery ? 'visible' : 'none') && map.getLayoutProperty('building-3d', 'visibility') === (next === '3d' ? 'visible' : 'none')) return mode;
    const wasPitched = mode === '3d';
    if (next !== '3d') stopOrbit();
    mode = next;
    if (mode !== '3d') saveMode(mode);
    if (map?.getLayer('aerial')) map.setLayoutProperty('aerial', 'visibility', imagery ? 'visible' : 'none');
    if (map?.getLayer('building-3d')) {
      const solid = mode === '3d';
      map.setLayoutProperty('building-3d', 'visibility', solid ? 'visible' : 'none');
      for (const layer of ['building-fill', 'building-outline']) map.setLayoutProperty(layer, 'visibility', solid ? 'none' : 'visible');
      if (solid) { map.dragRotate.enable(); map.touchPitch.enable(); map.easeTo({ pitch: 58, bearing: -24, zoom: Math.min(map.getZoom(), 18.4), duration: motion() }); }
      else if (wasPitched) { map.dragRotate.disable(); map.touchPitch.disable(); map.easeTo({ pitch: 0, bearing: 0, duration: motion() }); }
    }
    if (map?.getLayer('building-fill')) {
      map.setPaintProperty('building-fill', 'fill-opacity', mode === 'hybrid' ? .22 : .75);
      map.setPaintProperty('building-outline', 'line-color', mode === 'hybrid' ? '#d4ffac' : '#49654e');
      map.setPaintProperty('roads', 'line-opacity', mode === 'hybrid' ? .5 : 1);
    }
    if (dataReady && open) onStatus?.(message());
    return mode;
  }
  function clearSelection() { map?.getSource('selected')?.setData(emptySelection()); onSelection?.(false); }
  function focusHousenumber(entry) {
    if (!map || !entry) return;
    if (Number.isFinite(entry.lon) && Number.isFinite(entry.lat)) map.jumpTo({ center: [entry.lon, entry.lat], zoom: Math.max(map.getZoom(), 19) });
    else if (location) map.jumpTo({ center: [location.coordinates.lon, location.coordinates.lat], zoom: 19 });
  }
  /** `initialMode` '3d' opens straight into the key-free 3D buildings view. */
  async function show(value, { initialMode = null } = {}) {
    close();
    if (!available || !isAddressMatch(value)) throw new Error('Interactive map is unavailable on this device.');
    const request = serial; location = value;
    const saved = loadMode();
    mode = initialMode === '3d' ? '3d' : saved ? (saved === 'hybrid' && !hasAerialCoverage(value.coordinates) ? 'map' : saved) : (hasAerialCoverage(value.coordinates) ? 'hybrid' : 'map');
    open = true; container.hidden = false; container.setAttribute('aria-busy', 'true');
    let importTimeout;
    const api = await Promise.race([loadRenderer(), new Promise((_, reject) => { importTimeout = setTimeout(() => reject(new Error('Map runtime timed out.')), 10000); })]).finally(() => clearTimeout(importTimeout));
    if (request !== serial || !open) return null;
    api.setWorkerUrl(`${VENDOR}maplibre-gl-worker.mjs`);
    api.setWorkerCount(1);
    api.setMaxParallelImageRequests(6);
    const { lon, lat } = value.coordinates;
    const instance = map = new api.Map({
      container, style: propertyMapStyle(value), center: [lon, lat], zoom: 19, minZoom: 14, maxZoom: 20,
      renderWorldCopies: false, attributionControl: false, dragRotate: false, touchPitch: false,
      cooperativeGestures: true, prefetchZoomDelta: 0,
      transformRequest: url => ({ url, credentials: 'omit', referrerPolicy: 'no-referrer' })
    });
    instance.on('rotate', () => onBearing?.(instance.getBearing()));
    // Floating panels cover part of the map, so the address is centred in the open area instead.
    const pad = () => { const padding = getPadding(); if (padding) instance.setPadding(padding); };
    pad(); instance.on('resize', pad);
    const selectAt = point => {
      if (request !== serial || !open) return;
      if (!instance.getLayer('building-fill')) return;
      const feature = instance.queryRenderedFeatures(point, { layers: [mode === '3d' ? 'building-3d' : 'building-fill'] }).map(buildingHighlight).find(Boolean);
      instance.getSource('selected').setData(feature || emptySelection()); onSelection?.(Boolean(feature));
      if (feature) measureAt(Array.isArray(point) ? { x: point[0], y: point[1] } : point);
    };
    instance.getCanvas().setAttribute('aria-label', 'Property map. Arrow keys pan, plus and minus zoom, Enter highlights a building at the center, and Escape clears the highlight.');
    instance.getCanvas().addEventListener('keydown', event => {
      if (event.key === 'Escape') clearSelection();
      if (event.key === 'Enter') { event.preventDefault(); selectAt([container.clientWidth / 2, container.clientHeight / 2]); }
    });
    instance.on('click', event => selectAt(event.point));
    instance.on('moveend', refreshHousenumbers);
    instance.on('idle', refreshHousenumbers);
    return new Promise((resolve, reject) => {
      let ready = false, settled = false;
      const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(deadline); stopWaiting = null; if (error) reject(error); else resolve(result); };
      const fail = () => {
        if (request !== serial || !open) return;
        if (!ready) finish(new Error('Map data is unavailable.'));
        else { close(); onFailure?.(); }
      };
      const deadline = setTimeout(fail, LOAD_TIMEOUT);
      stopWaiting = () => finish(null, null);
      instance.on('sourcedata', event => {
        if (request === serial && open && event.sourceId === 'naip' && event.coord && mode !== 'map') {
          aerialReady = instance.isSourceLoaded('naip'); if (dataReady) onStatus?.(message());
        }
        if (request !== serial || !open || event.sourceId !== 'openmaptiles' || !event.coord || !instance.isSourceLoaded('openmaptiles') || ready) return;
        ready = dataReady = true; container.removeAttribute('aria-busy');
        const initial = mode; mode = null; setMode(initial); refreshHousenumbers();
        try { measurer = setupMapMeasure(instance, api); } catch { measurer = null; }
        instance.once('idle', () => {
          if (request !== serial || !open) return;
          settled = true; measureAt();
          if (orbitWanted && mode === '3d' && !reduced()) startOrbit();
        });
        finish(null, true);
      });
      instance.on('error', event => {
        if (request !== serial || !open) return;
        if (event.sourceId === 'naip') {
          if (mode === '3d') { map.setLayoutProperty('aerial', 'visibility', 'none'); onStatus?.('Open 3D buildings shown on the street map; the aerial tile service is unavailable.'); return; }
          setMode('map'); onStatus?.('Map shown. The aerial tile service is unavailable; street names and mapped outlines are still usable.');
        } else if (event.sourceId === 'openmaptiles') fail();
      });
      instance.on('webglcontextlost', fail);
    });
  }
  return {
    available, show, close, setMode, clearSelection, focusHousenumber, refreshHousenumbers, orbit, measure: () => measureAt(),
    zoomBy: delta => { stopOrbit(); map?.easeTo({ zoom: Math.max(14, Math.min(20, map.getZoom() + delta)), duration: motion() / 3 }); },
    north: () => { stopOrbit(); map?.easeTo({ bearing: 0, duration: motion() }); },
    get isOrbiting() { return Boolean(orbitFrame) || orbitWanted; },
    recenter: () => { if (map && location) { const { lon, lat } = location.coordinates; map.jumpTo(mode === '3d' ? { center: [lon, lat], zoom: 18.4, bearing: -24, pitch: 58 } : { center: [lon, lat], zoom: 19, bearing: 0, pitch: 0 }); } },
    get isOpen() { return open; }, get mode() { return mode; }, get message() { return message(); }
  };
}
