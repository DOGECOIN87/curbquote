/**
 * Reviewed local exteriors take precedence for covered addresses. Other properties can use
 * optional Google tiles. Both views are display-only and never feed the estimator or assistant.
 * One Google tileset (one billed session) is reused for the rest of the visit.
 */
import { STATIC_SITE, STATIC_MAP3D } from './config.js';
import { loadCesium, webgl2Available } from './cesium-runtime.js';
import { exteriorForLocation } from './exterior-catalog.js';
import { setupExterior3D } from './property-exterior.js';
export { webgl2Available } from './cesium-runtime.js';

const HEIGHT_TIMEOUT = 15000;
const TILE_FAILURES = 6;
// CesiumJS defaults to a 1.5 GB in-memory tile cache for Google tiles, too much for phones.
const CACHE_BYTES = 256 * 1024 * 1024;

export function setupProperty3D(options) {
  const google = setupGoogle3D(options), exterior = setupExterior3D(options), localAvailable = webgl2Available();
  let current = google, serial = 0;
  const hasLocal = location => localAvailable && Boolean(exteriorForLocation(location));
  return {
    available: google.available, hasLocal,
    async show(location) {
      const request = ++serial; google.close(); exterior.close(); current = hasLocal(location) ? exterior : google;
      try { const result = await current.show(location); return request === serial ? result : null; }
      catch (error) { if (request !== serial) return null; throw error; }
    },
    close() { serial++; google.close(); exterior.close(); },
    setTop: value => current.setTop(value), rotate: () => current.rotate(), recenter: () => current.recenter(), orbit: () => current.orbit(),
    get isOpen() { return current.isOpen; }, get isTop() { return current.isTop; }, get isExterior() { return current === exterior; }, get isOrbiting() { return Boolean(current.isOrbiting); }
  };
}
function setupGoogle3D({ stage, onFailure, onOrbitChange }) {
  const container = document.createElement('div');
  container.className = 'aerial-3d'; container.hidden = true;
  container.setAttribute('aria-label', 'Google 3D view around the approximate address location');
  stage.append(container);
  let key = null, ionToken = null, Cesium = null, widget = null, marker = null, ready = null, serial = 0, open = false;
  let target = null, heading = 0, top = false;
  let orbitFrame = 0, orbiting = false;
  const available = (STATIC_SITE ? Promise.resolve(STATIC_MAP3D) : fetch('api/map3d', { headers: { Accept: 'application/json' }, cache: 'no-store' }).then(response => response.ok ? response.json() : {}))
    .then(config => {
      if (config?.configured) { key = typeof config.key === 'string' ? config.key : null; ionToken = key ? null : typeof config.ionToken === 'string' ? config.ionToken : null; }
      return Boolean(key || ionToken) && webgl2Available();
    })
    .catch(() => false);
  function cancelOrbit() {
    if (orbitFrame) cancelAnimationFrame(orbitFrame);
    orbitFrame = 0;
    if (orbiting) {
      orbiting = false;
      onOrbitChange?.(false);
    }
  }
  function destroy() {
    cancelOrbit();
    try { widget?.destroy(); } catch { /* already torn down */ }
    widget = marker = ready = null; container.replaceChildren();
  }
  function start() {
    ready ??= (async () => {
      Cesium ??= await loadCesium();
      widget = new Cesium.CesiumWidget(container, { baseLayer: false, globe: false, skyBox: false, requestRenderMode: true, showRenderLoopErrors: false });
      widget.useDefaultRenderLoop = open;
      widget.scene.renderError.addEventListener((_, error) => {
        const active = open; destroy(); close();
        // A hidden Google view must not replace a newer local exterior or map.
        if (active) onFailure?.(error);
      });
      // Without a Google key, CesiumJS requests the same tiles through Cesium ion with the configured token.
      if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;
      const tileset = widget.scene.primitives.add(await Cesium.createGooglePhotorealistic3DTileset(key ? { key } : {}, { showCreditsOnScreen: true, cacheBytes: CACHE_BYTES, maximumCacheOverflowBytes: CACHE_BYTES }));
      // A key that runs out of quota or is revoked mid-visit fails tile by tile; hand over to the next tier.
      let loadedTiles = 0, failedTiles = 0;
      tileset.tileLoad.addEventListener(() => { loadedTiles++; });
      tileset.tileFailed.addEventListener(() => {
        if (++failedTiles < TILE_FAILURES || loadedTiles > failedTiles * 4) return;
        const active = open; destroy(); close();
        if (active) onFailure?.(new Error('Google 3D tiles were refused.'));
      });
      marker = widget.scene.primitives.add(new Cesium.PointPrimitiveCollection()).add({
        pixelSize: 14, color: Cesium.Color.fromCssColorString('#89C63F'), outlineColor: Cesium.Color.fromCssColorString('#102303'), outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY
      });
      // Any manual interaction should stop the locked orbit.
      widget.canvas.addEventListener('pointerdown', cancelOrbit);
      widget.canvas.addEventListener('wheel', cancelOrbit, { passive: true });
      widget.scene.requestRender();
    })();
    return ready;
  }
  async function groundHeight(lon, lat) {
    const scene = widget.scene;
    if (!scene.sampleHeightSupported) return null;
    const timer = new Promise(resolve => setTimeout(resolve, HEIGHT_TIMEOUT, []));
    const [point] = await Promise.race([scene.sampleHeightMostDetailed([Cesium.Cartographic.fromDegrees(lon, lat)]), timer]);
    return Number.isFinite(point?.height) ? point.height : null;
  }
  /** Angled or straight-down view of the address point; animated unless reduced motion is preferred. */
  function frame(duration = 0) {
    if (!widget || !target) return;
    const { BoundingSphere, HeadingPitchRange, Math: CesiumMath } = Cesium;
    const offset = new HeadingPitchRange(heading, CesiumMath.toRadians(top ? -89.5 : -35), top ? 125 : 115);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) duration = 0;
    widget.scene.camera.flyToBoundingSphere(new BoundingSphere(target, 1), { offset, duration });
    widget.scene.requestRender();
  }
  /** Cinematic locked 360° orbit — most visually appealing. Ease-in-out with subtle altitude/pitch breathing. */
  function orbit() {
    if (!widget || !target) return;
    if (orbiting) { cancelOrbit(); return; }
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      heading = (heading + Math.PI / 2) % (2 * Math.PI);
      cancelOrbit();
      frame(0.8);
      return;
    }
    orbiting = true;
    onOrbitChange?.(true);
    widget.useDefaultRenderLoop = true;
    const startHeading = heading;
    const duration = 20000; // 20s — cinematic, not dizzy
    const startTime = performance.now();
    const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const tick = now => {
      if (!orbiting || !open || !widget) { cancelOrbit(); return; }
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = easeInOutCubic(t);
      heading = (startHeading + eased * Math.PI * 2) % (2 * Math.PI);
      const { HeadingPitchRange, Math: CesiumMath } = Cesium;
      // Subtle pitch bob (+3°) and range breathing (±3%) give a drone-like reveal, still locked on centre.
      const basePitch = top ? -89.5 : -35;
      const baseRange = top ? 125 : 115;
      const pitchBob = Math.sin(eased * Math.PI * 2) * 3;
      const rangeBreath = baseRange * (1 + Math.sin(eased * Math.PI * 2) * 0.03);
      const offset = new HeadingPitchRange(heading, CesiumMath.toRadians(basePitch + pitchBob), rangeBreath);
      try { widget.scene.camera.lookAt(target, offset); } catch { /* camera not ready */ }
      widget.scene.requestRender();
      if (t < 1) orbitFrame = requestAnimationFrame(tick);
      else { orbitFrame = 0; orbiting = false; onOrbitChange?.(false); }
    };
    orbitFrame = requestAnimationFrame(tick);
  }
  /** Resolves 'framed' (on the address point), 'overview' (no surface height) or null if superseded. */
  async function show(location) {
    const request = ++serial; open = true; container.hidden = false;
    try { await start(); }
    // A failed start leaves nothing half-built, so the next attempt begins again.
    catch (error) { destroy(); if (request === serial) close(); throw error; }
    if (request !== serial) return null;
    const { lat, lon } = location.coordinates, { Cartesian3 } = Cesium, camera = widget.scene.camera;
    widget.useDefaultRenderLoop = true; marker.show = false; target = null; heading = 0; top = false;
    camera.setView({ destination: Cartesian3.fromDegrees(lon, lat, 1800) });
    const height = await groundHeight(lon, lat);
    if (request !== serial) return null;
    if (height !== null) {
      target = Cartesian3.fromDegrees(lon, lat, height);
      marker.position = target; marker.show = true; frame();
    }
    widget.scene.requestRender();
    return height === null ? 'overview' : 'framed';
  }
  function close() {
    cancelOrbit();
    serial++; open = false; container.hidden = true;
    if (widget) widget.useDefaultRenderLoop = false;
  }
  return {
    available, show, close,
    setTop(value) { cancelOrbit(); top = value; frame(0.8); },
    rotate() { cancelOrbit(); heading = (heading + Math.PI / 2) % (2 * Math.PI); frame(0.8); },
    recenter() { cancelOrbit(); heading = 0; frame(0.8); },
    orbit,
    get isOpen() { return open; }, get isTop() { return top; }, get isOrbiting() { return orbiting; }
  };
}
