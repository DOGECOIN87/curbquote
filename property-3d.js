/**
 * Optional Google Photorealistic 3D view. Display only: nothing it shows is measured, stored, exported
 * or sent to the estimator or assistant. CesiumJS loads on first use, and one tileset (one billed Google
 * session) is reused for the rest of the visit.
 */
const CESIUM_BASE = new URL('./vendor/cesium/', import.meta.url).href;
const HEIGHT_TIMEOUT = 15000;
// CesiumJS defaults to a 1.5 GB in-memory tile cache for Google tiles, too much for phones.
const CACHE_BYTES = 256 * 1024 * 1024;

export function webgl2Available() {
  try { return Boolean(document.createElement('canvas').getContext('webgl2')); } catch { return false; }
}
export function setupProperty3D({ stage, onFailure }) {
  const container = document.createElement('div');
  container.className = 'aerial-3d'; container.hidden = true;
  container.setAttribute('aria-label', 'Google 3D view around the approximate address location');
  stage.append(container);
  let key = null, ionToken = null, Cesium = null, widget = null, marker = null, ready = null, serial = 0, open = false;
  let target = null, heading = 0, top = false;
  const available = fetch('/api/map3d', { headers: { Accept: 'application/json' }, cache: 'no-store' })
    .then(response => response.ok ? response.json() : {})
    .then(config => {
      if (config?.configured) { key = typeof config.key === 'string' ? config.key : null; ionToken = key ? null : typeof config.ionToken === 'string' ? config.ionToken : null; }
      return Boolean(key || ionToken) && webgl2Available();
    })
    .catch(() => false);
  function destroy() {
    try { widget?.destroy(); } catch { /* already torn down */ }
    widget = marker = ready = null; container.replaceChildren();
  }
  function start() {
    ready ??= (async () => {
      globalThis.CESIUM_BASE_URL = CESIUM_BASE;
      if (!document.querySelector('link[data-cesium]')) {
        const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `${CESIUM_BASE}Widgets/CesiumWidget/CesiumWidget.css` });
        link.dataset.cesium = ''; document.head.append(link);
      }
      Cesium ??= await import(`${CESIUM_BASE}index.js`);
      widget = new Cesium.CesiumWidget(container, { baseLayer: false, globe: false, skyBox: false, requestRenderMode: true, showRenderLoopErrors: false });
      widget.scene.renderError.addEventListener((_, error) => { destroy(); close(); onFailure?.(error); });
      // Without a Google key, CesiumJS requests the same tiles through Cesium ion with the configured token.
      if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;
      widget.scene.primitives.add(await Cesium.createGooglePhotorealistic3DTileset(key ? { key } : {}, { showCreditsOnScreen: true, cacheBytes: CACHE_BYTES, maximumCacheOverflowBytes: CACHE_BYTES }));
      marker = widget.scene.primitives.add(new Cesium.PointPrimitiveCollection()).add({
        pixelSize: 14, color: Cesium.Color.fromCssColorString('#caff8c'), outlineColor: Cesium.Color.fromCssColorString('#102e35'), outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY
      });
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
    const offset = new HeadingPitchRange(heading, CesiumMath.toRadians(top ? -89.5 : -35), top ? 230 : 190);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) duration = 0;
    widget.scene.camera.flyToBoundingSphere(new BoundingSphere(target, 1), { offset, duration });
    widget.scene.requestRender();
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
    // Start above nearly all U.S. ground, then settle on the sampled surface.
    camera.setView({ destination: Cartesian3.fromDegrees(lon, lat, 4500) });
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
    serial++; open = false; container.hidden = true;
    if (widget) widget.useDefaultRenderLoop = false;
  }
  return {
    available, show, close,
    setTop(value) { top = value; frame(0.8); },
    rotate() { heading = (heading + Math.PI / 2) % (2 * Math.PI); frame(0.8); },
    recenter() { heading = 0; frame(0.8); },
    get isOpen() { return open; }, get isTop() { return top; }
  };
}
