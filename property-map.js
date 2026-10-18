import { isAddressMatch } from './address.js';
import { hasAerialCoverage } from './property-view.js';
import { propertyMapStyle, buildingHighlight, emptySelection } from './map-style.js';
import { webgl2Available } from './property-3d.js';

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
export function setupPropertyMap({ stage, onStatus, onSelection, onFailure }) {
  const container = document.createElement('div'); container.id = 'property-map'; container.className = 'aerial-map'; container.hidden = true;
  container.setAttribute('aria-label', 'Interactive map around the approximate address'); stage.append(container);
  let map = null, open = false, serial = 0, location = null, mode = 'hybrid', stopWaiting, dataReady = false, aerialReady = false;
  const available = webgl2Available();
  function close() {
    serial++; open = false; dataReady = aerialReady = false; stopWaiting?.(); stopWaiting = null;
    const previous = map; map = null;
    try { previous?.remove(); } catch { /* context may already be lost */ }
    container.replaceChildren(); container.hidden = true; container.removeAttribute('aria-busy'); onSelection?.(false);
  }
  function message() {
    const prefix = mode === 'hybrid' ? aerialReady ? 'Hybrid view ready.' : 'Map ready; aerial imagery is loading.' : 'Map view ready.';
    return `${prefix} Tap a mapped building to highlight it. Drag, use arrow keys, or use two fingers on a phone. The dot is an approximate address point.`;
  }
  function setMode(value) {
    mode = value === 'hybrid' && hasAerialCoverage(location?.coordinates) ? 'hybrid' : 'map';
    if (map?.getLayer('aerial')) map.setLayoutProperty('aerial', 'visibility', mode === 'hybrid' ? 'visible' : 'none');
    if (map?.getLayer('building-fill')) {
      map.setPaintProperty('building-fill', 'fill-opacity', mode === 'hybrid' ? .17 : .75);
      map.setPaintProperty('building-outline', 'line-color', mode === 'hybrid' ? '#d4ffac' : '#49654e');
      map.setPaintProperty('roads', 'line-opacity', mode === 'hybrid' ? .5 : 1);
    }
    if (dataReady && open) onStatus?.(message());
    return mode;
  }
  function clearSelection() { map?.getSource('selected')?.setData(emptySelection()); onSelection?.(false); }
  async function show(value) {
    close();
    if (!available || !isAddressMatch(value)) throw new Error('Interactive map is unavailable on this device.');
    const request = serial; location = value; mode = hasAerialCoverage(value.coordinates) ? 'hybrid' : 'map';
    open = true; container.hidden = false; container.setAttribute('aria-busy', 'true');
    let importTimeout;
    const api = await Promise.race([loadRenderer(), new Promise((_, reject) => { importTimeout = setTimeout(() => reject(new Error('Map runtime timed out.')), 10000); })]).finally(() => clearTimeout(importTimeout));
    if (request !== serial || !open) return null;
    api.setWorkerUrl(`${VENDOR}maplibre-gl-worker.mjs`);
    api.setWorkerCount(1);
    api.setMaxParallelImageRequests(6);
    const { lon, lat } = value.coordinates;
    const instance = map = new api.Map({
      container, style: propertyMapStyle(value), center: [lon, lat], zoom: 18, minZoom: 13, maxZoom: 20,
      renderWorldCopies: false, attributionControl: false, dragRotate: false, touchPitch: false,
      cooperativeGestures: true, prefetchZoomDelta: 0,
      transformRequest: url => ({ url, credentials: 'omit', referrerPolicy: 'no-referrer' })
    });
    instance.addControl(new api.NavigationControl({ showCompass: false }), 'top-right');
    const selectAt = point => {
      if (request !== serial || !open) return;
      if (!instance.getLayer('building-fill')) return;
      const feature = instance.queryRenderedFeatures(point, { layers: ['building-fill'] }).map(buildingHighlight).find(Boolean);
      instance.getSource('selected').setData(feature || emptySelection()); onSelection?.(Boolean(feature));
    };
    instance.getCanvas().setAttribute('aria-label', 'Property map. Arrow keys pan, plus and minus zoom, Enter highlights a building at the center, and Escape clears the highlight.');
    instance.getCanvas().addEventListener('keydown', event => {
      if (event.key === 'Escape') clearSelection();
      if (event.key === 'Enter') { event.preventDefault(); selectAt([container.clientWidth / 2, container.clientHeight / 2]); }
    });
    instance.on('click', event => selectAt(event.point));
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
        if (request === serial && open && event.sourceId === 'naip' && event.coord && mode === 'hybrid') {
          aerialReady = instance.isSourceLoaded('naip'); if (dataReady) onStatus?.(message());
        }
        if (request !== serial || !open || event.sourceId !== 'openmaptiles' || !event.coord || !instance.isSourceLoaded('openmaptiles') || ready) return;
        ready = dataReady = true; container.removeAttribute('aria-busy'); setMode(mode); finish(null, true);
      });
      instance.on('error', event => {
        if (request !== serial || !open) return;
        if (event.sourceId === 'naip') {
          setMode('map'); onStatus?.('Map shown. The aerial tile service is unavailable; street names and mapped outlines are still usable.');
        } else if (event.sourceId === 'openmaptiles') fail();
      });
      instance.on('webglcontextlost', fail);
    });
  }
  return {
    available, show, close, setMode, clearSelection,
    recenter: () => { if (map && location) { const { lon, lat } = location.coordinates; map.jumpTo({ center: [lon, lat], zoom: 18, bearing: 0, pitch: 0 }); } },
    get isOpen() { return open; }, get mode() { return mode; }, get message() { return message(); }
  };
}
