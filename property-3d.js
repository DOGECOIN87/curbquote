/**
 * Reviewed local exteriors take precedence for covered addresses. Other properties can use
 * optional Google tiles. Both views are display-only and never feed the estimator or assistant.
 * One Google tileset (one billed session) is reused for the rest of the visit.
 */
import { STATIC_SITE, STATIC_MAP3D } from './config.js';
import { loadCesium, webgl2Available } from './cesium-runtime.js';
import { exteriorForLocation } from './exterior-catalog.js';
import { setupExterior3D } from './property-exterior.js';
import { solarOutline } from './google-maps.js';
import { FEET_PER_METER, findRoof, illustrativeOutline, measureOutline, setupScreenMeasure } from './measure-overlay.js';
export { webgl2Available } from './cesium-runtime.js';

const HEIGHT_TIMEOUT = 15000;
const MEASURE_TIMEOUT = 12000;
// The roof search samples Google's surface every 1.25 m over a 50 m square around the point.
const ROOF_STEP = 1.25, ROOF_SAMPLES = 41;
const TILE_FAILURES = 6;
// Degrees per second for the turn around the building; the free 3D map turns at the same pace.
const ORBIT_SPEED = 7;
// CesiumJS defaults to a 1.5 GB in-memory tile cache for Google tiles, too much for phones.
const CACHE_BYTES = 256 * 1024 * 1024;
// The camera looks down at 42°, from far enough that the street and the neighbours frame the house.
const PITCH = -42, RANGE_MIN = 40, RANGE_MAX = 600;
// The floating panels over the view; measurement labels move out from under them.
const PANELS = '.view-dock, .instant-estimate, :is(.change-dock, .view-top-left, .view-top-right, .view-foot, .view-tools) > :not([hidden])';

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
    zoomBy: step => current.zoomBy?.(step), refit: () => current.refit?.(),
    // The reviewed exterior is already a measured model; only Google's view gets the measuring pass.
    measure: (dims, options) => current === google ? google.measure(dims, options) : Promise.resolve(null),
    get isOpen() { return current.isOpen; }, get isTop() { return current.isTop; }, get isExterior() { return current === exterior; }, get isOrbiting() { return Boolean(current.isOrbiting); }
  };
}
function setupGoogle3D({ stage, onFailure, onOrbitChange, onFramed, onPick, getPadding }) {
  const container = document.createElement('div');
  container.className = 'aerial-3d'; container.hidden = true;
  container.setAttribute('aria-label', 'Google 3D view around the approximate address location');
  stage.append(container);
  let key = null, ionToken = null, Cesium = null, widget = null, marker = null, ready = null, serial = 0, open = false;
  let target = null, place = null, heading = 0, top = false, range = 115, padding = null, paddingAt = 0;
  let orbitFrame = 0, orbiting = false, measurer = null, tileset = null, loading = 0;
  const layer = document.createElement('div');
  layer.className = 'measure-3d'; layer.hidden = true; layer.setAttribute('aria-hidden', 'true');
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
    measurer?.clear(); widget = marker = ready = measurer = tileset = null; container.replaceChildren();
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
      // The refusal's source and HTTP status let the page say what to fix (allowed URLs, asset access).
      const refused = status => Object.assign(new Error('Google 3D tiles were refused.'), { via: key ? 'google' : 'ion', status });
      let tiles;
      try { tiles = await Cesium.createGooglePhotorealistic3DTileset(key ? { key } : {}, { showCreditsOnScreen: true, cacheBytes: CACHE_BYTES, maximumCacheOverflowBytes: CACHE_BYTES }); }
      catch (error) { throw refused(error?.statusCode); }
      tileset = widget.scene.primitives.add(tiles);
      // A key that runs out of quota or is revoked mid-visit fails tile by tile; hand over to the next tier.
      let loadedTiles = 0, failedTiles = 0;
      tileset.tileLoad.addEventListener(() => { loadedTiles++; });
      tileset.tileFailed.addEventListener(() => {
        if (++failedTiles < TILE_FAILURES || loadedTiles > failedTiles * 4) return;
        const active = open; destroy(); close();
        if (active) onFailure?.(refused());
      });
      marker = widget.scene.primitives.add(new Cesium.PointPrimitiveCollection()).add({
        pixelSize: 14, color: Cesium.Color.fromCssColorString('#89C63F'), outlineColor: Cesium.Color.fromCssColorString('#102303'), outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY
      });
      // Any manual interaction should stop the locked orbit.
      widget.canvas.addEventListener('pointerdown', cancelOrbit);
      widget.canvas.addEventListener('wheel', cancelOrbit, { passive: true });
      widget.canvas.addEventListener('keydown', cancelOrbit);
      // A tap (not a drag) on a roof measures that building instead.
      let press = null;
      widget.canvas.addEventListener('pointerdown', event => { press = event.isPrimary ? { x: event.clientX, y: event.clientY } : null; });
      widget.canvas.addEventListener('pointerup', event => {
        const start = press; press = null;
        if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6 || !open || !target || !widget.scene.pickPositionSupported) return;
        const box = widget.canvas.getBoundingClientRect(), world = widget.scene.pickPosition(new Cesium.Cartesian2(event.clientX - box.left, event.clientY - box.top));
        if (!world) return;
        const spot = Cesium.Cartographic.fromCartesian(world);
        onPick?.([Cesium.Math.toDegrees(spot.longitude), Cesium.Math.toDegrees(spot.latitude)]);
      });
      // The measuring pass is drawn over the canvas and follows every rendered frame.
      container.append(layer); measurer = setupScreenMeasure(layer, { obstacles: () => [...stage.parentElement.querySelectorAll(PANELS)].filter(el => el.offsetParent).map(el => el.getBoundingClientRect()) });
      widget.scene.postRender.addEventListener(() => { measurer?.redraw(); if (target && container.dataset.loading && tileset?.tilesLoaded) loaded(); });
      widget.scene.requestRender();
    })();
    return ready;
  }
  /** Screen pixels of a [lon, lat, metres] point, or null when it is behind the camera. */
  function project([lon, lat, height]) {
    const { Cartesian3, SceneTransforms } = Cesium, camera = widget.scene.camera, world = Cartesian3.fromDegrees(lon, lat, height);
    if (Cartesian3.dot(Cartesian3.subtract(world, camera.positionWC, new Cartesian3()), camera.directionWC) <= 0) return null;
    const point = SceneTransforms.worldToWindowCoordinates(widget.scene, world);
    return point ? { x: point.x, y: point.y } : null;
  }
  /** The roof nearest a point (or under it, for a tap), found in a grid of Google's surface heights. */
  async function roofNear([lon, lat], picked) {
    if (!widget.scene.sampleHeightSupported) return null;
    const middle = (ROOF_SAMPLES - 1) / 2, kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540, points = [];
    for (let j = 0; j < ROOF_SAMPLES; j++) for (let i = 0; i < ROOF_SAMPLES; i++) points.push(Cesium.Cartographic.fromDegrees(lon + (i - middle) * ROOF_STEP / kx, lat + (j - middle) * ROOF_STEP / ky));
    const sampled = await Promise.race([widget.scene.sampleHeightMostDetailed(points).catch(() => null), new Promise(resolve => setTimeout(resolve, MEASURE_TIMEOUT, null))]);
    const roof = sampled && findRoof(sampled.map(point => Number.isFinite(point.height) ? point.height : NaN), ROOF_SAMPLES, ROOF_STEP, picked ? { pick: [middle, middle] } : {});
    return roof && { ring: [...roof.corners, roof.corners[0]].map(([x, y]) => [lon + x / kx, lat + y / ky]), ground: roof.ground, peak: roof.peak };
  }
  /**
   * Measures a building and plays the measuring pass. The outline is, in order: the mapped building
   * (OpenStreetMap), Google's Solar API building, the roof found in Google's 3D surface nearest the address point (or under a tap,
   * `at`), or an illustrative rectangle of the estimate's size. Heights come from the 3D surface when
   * it answers in time. All of it is approximate and never becomes an estimate input.
   */
  async function measure({ outline = null, lengthFt = 48, widthFt = 34, wallFt = 18, heightFt = 26 } = {}, { at = null } = {}) {
    if (!widget || !target || !place) return null;
    const request = serial, osm = outline && !at ? measureOutline(outline) : null;
    const solar = osm || at ? null : measureOutline(await solarOutline([place.lat, place.lon]) || []);
    if (request !== serial || !open) return null;
    const mapped = osm || solar, found = mapped ? null : await roofNear(at || [place.lon, place.lat], Boolean(at));
    if (request !== serial || !open) return null;
    const traced = found && measureOutline(found.ring);
    // A tap that finds no roof (a lawn, a street, a tree) leaves the current measurement as it is.
    if (at && !traced) return null;
    const shape = mapped || traced || measureOutline(illustrativeOutline(at || [place.lon, place.lat], lengthFt, widthFt));
    if (!shape) return null;
    const { Cartesian3, Cartographic } = Cesium, [cx, cy] = shape.centre;
    const around = k => shape.outline.map(([lon, lat]) => [cx + (lon - cx) * k, cy + (lat - cy) * k]);
    // Ground just outside the walls (the lowest sample, so trees and fences do not lift it); roof inside them.
    const groundPoints = around(1.6), roofPoints = mapped ? [shape.centre, ...around(.55)] : [];
    let ground = Cartographic.fromCartesian(target).height, peak = null;
    if (traced) ({ ground, peak } = found);
    else if (widget.scene.sampleHeightSupported) {
      const points = [...groundPoints, ...roofPoints].map(([lon, lat]) => Cartographic.fromDegrees(lon, lat));
      const sampled = await Promise.race([widget.scene.sampleHeightMostDetailed(points).catch(() => null), new Promise(resolve => setTimeout(resolve, MEASURE_TIMEOUT, null))]);
      if (request !== serial || !open) return null;
      const heights = list => list.map(point => point.height).filter(Number.isFinite);
      const low = sampled ? heights(sampled.slice(0, groundPoints.length)) : [], high = sampled ? heights(sampled.slice(groundPoints.length)) : [];
      if (low.length) ground = Math.min(...low);
      if (high.length) peak = Math.max(...high);
    }
    const measuredFt = peak === null ? null : (peak - ground) * FEET_PER_METER;
    const measured = measuredFt !== null && measuredFt >= 8 && measuredFt <= 80;
    if (!measured) peak = ground + heightFt / FEET_PER_METER;
    const eave = ground + Math.min(wallFt / FEET_PER_METER, (peak - ground) * .8);
    // Frame the building itself rather than the address point, close enough to fill the view.
    const across = Math.hypot(...shape.sides.map(side => side.feet)) / FEET_PER_METER;
    target = Cartesian3.fromDegrees(cx, cy, ground + (eave - ground) / 2); marker.show = false;
    range = Math.max(70, Math.min(220, across * 3 + (peak - ground) + 30));
    const resume = orbiting; cancelOrbit(); await frame(1.1);
    if (request !== serial || !open) return null;
    layer.hidden = false;
    const result = measurer.play(shape, { ground, eave, peak }, project);
    if (resume) orbit();
    return result && { ...result, centre: shape.centre, source: osm ? 'outline' : solar ? 'solar' : traced ? 'surface' : 'illustrative', measuredHeight: measured };
  }
  /** The surface height at a point once its most detailed tiles load (null if unsupported or failed). */
  function surfaceHeight(lon, lat) {
    const scene = widget.scene;
    if (!scene.sampleHeightSupported) return Promise.resolve(null);
    return scene.sampleHeightMostDetailed([Cesium.Cartographic.fromDegrees(lon, lat)])
      .then(([point]) => Number.isFinite(point?.height) ? point.height : null, () => null);
  }
  const offset = () => new Cesium.HeadingPitchRange(heading, Cesium.Math.toRadians(top ? -89.5 : PITCH), top ? range + 10 : range);
  /**
   * The point the camera looks at: the building, moved toward the camera so the building sits in the
   * middle of the open area between the floating panels rather than behind the bottom ones.
   */
  function aim() {
    const now = performance.now();
    if (getPadding && now - paddingAt > 300) { padding = getPadding(); paddingAt = now; }
    const height = widget.canvas.clientHeight, shift = padding && height ? (padding.bottom - padding.top) / 2 : 0;
    if (!shift) return target;
    const { Cartesian3, Matrix4, Transforms } = Cesium, fovy = widget.scene.camera.frustum.fovy || Math.PI / 3;
    const distance = top ? range + 10 : range, metres = shift * 2 * distance * Math.tan(fovy / 2) / height;
    const along = metres / Math.sin(Math.abs(Cesium.Math.toRadians(top ? -89.5 : PITCH)));
    return Matrix4.multiplyByPoint(Transforms.eastNorthUpToFixedFrame(target), new Cartesian3(-Math.sin(heading) * along, -Math.cos(heading) * along, 0), new Cartesian3());
  }
  /** Angled or straight-down view of the target; animated unless reduced motion is preferred. Resolves on arrival. */
  function frame(duration = 0) {
    if (!widget || !target) return Promise.resolve();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) duration = 0;
    return new Promise(resolve => {
      widget.scene.camera.flyToBoundingSphere(new Cesium.BoundingSphere(aim(), 1), { offset: offset(), duration, complete: resolve, cancel: resolve });
      widget.scene.requestRender();
    });
  }
  /** Circles the building at a steady pace until someone drags, scrolls, presses a key or a view button. */
  function orbit() {
    if (!widget || !target) return;
    if (orbiting) { cancelOrbit(); return; }
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      heading = (heading + Math.PI / 2) % (2 * Math.PI);
      cancelOrbit();
      frame(0.8);
      return;
    }
    // Circling is always the angled view, as with the 3D button on a map.
    orbiting = true; top = false;
    onOrbitChange?.(true);
    widget.useDefaultRenderLoop = true;
    let last = performance.now();
    const tick = now => {
      if (!orbiting || !open || !widget) { cancelOrbit(); return; }
      heading = (heading + Math.min(.05, (now - last) / 1000) * Cesium.Math.toRadians(ORBIT_SPEED)) % (2 * Math.PI); last = now;
      try { widget.scene.camera.lookAt(aim(), offset()); } catch { /* camera not ready */ }
      widget.scene.requestRender();
      orbitFrame = requestAnimationFrame(tick);
    };
    const begin = () => { if (orbiting && open && widget) { last = performance.now(); orbitFrame = requestAnimationFrame(tick); } };
    // From the high overview, fly in first (the Google Earth move) instead of jump-cutting to circling range.
    const distance = target ? widget.scene.camera.positionWC.distanceTo?.(target) ?? Cesium.Cartesian3.distance(widget.scene.camera.positionWC, target) : 0;
    if (distance > range * 2.5) frame(1.4).then(begin); else begin();
  }
  /** The loading note stays until the tiles around the building have arrived (or 25 s have passed). */
  function loaded() { clearTimeout(loading); delete container.dataset.loading; }
  /** Resolves 'framed' (on the address point), 'overview' (no surface height) or null if superseded. */
  async function show(location) {
    const request = ++serial; open = true; container.hidden = false; container.dataset.loading = 'true';
    clearTimeout(loading); loading = setTimeout(loaded, 45000);
    try { await start(); }
    // A failed start leaves nothing half-built, so the next attempt begins again.
    catch (error) { destroy(); if (request === serial) close(); throw error; }
    if (request !== serial) return null;
    const { lat, lon } = location.coordinates, { Cartesian3 } = Cesium, camera = widget.scene.camera;
    widget.useDefaultRenderLoop = true; marker.show = false; target = null; heading = 0; top = false; range = 115;
    place = { lon, lat }; measurer?.clear(); layer.hidden = true;
    camera.setView({ destination: Cartesian3.fromDegrees(lon, lat, 1800) });
    const point = height => { target = Cartesian3.fromDegrees(lon, lat, height); marker.position = target; marker.show = true; };
    const sampled = surfaceHeight(lon, lat);
    const height = await Promise.race([sampled, new Promise(resolve => setTimeout(resolve, HEIGHT_TIMEOUT, null))]);
    if (request !== serial) return null;
    if (height !== null) { point(height); frame(); clearTimeout(loading); loading = setTimeout(loaded, 25000); }
    // Slow connections can take longer than the deadline to load the detailed tiles: keep the overview,
    // then fly in and hand back to the page once the height arrives. The overview still gets a ground
    // target right away, so the Earth-style circling can start without waiting for the height — the
    // late answer replaces that target only if nothing else (a tap, a measurement) has claimed it.
    else {
      point(0); const overviewTarget = target;
      // Settle into the proper viewpoint right away — angled, house framed — instead of sitting
      // in the high top-down overview. This is also the fallback view when the circling is
      // unavailable (reduced motion) or stopped: the visitor still lands on a good shot.
      frame(1.6);
      sampled.then(late => {
        if (late === null || request !== serial || !open || target !== overviewTarget) return;
        point(late); frame(1.2); clearTimeout(loading); loading = setTimeout(loaded, 25000); onFramed?.();
      });
    }
    widget.scene.requestRender();
    return height === null ? 'overview' : 'framed';
  }
  function close() {
    cancelOrbit(); measurer?.clear(); layer.hidden = true;
    serial++; open = false; container.hidden = true; loaded();
    if (widget) widget.useDefaultRenderLoop = false;
  }
  return {
    available, show, close, measure,
    setTop(value) { cancelOrbit(); top = value; frame(0.8); },
    rotate() { cancelOrbit(); heading = (heading + Math.PI / 2) % (2 * Math.PI); frame(0.8); },
    recenter() { cancelOrbit(); heading = 0; frame(0.8); },
    /** Re-aims after the panels over the view change size; a circling camera re-aims on its own. */
    refit() { if (widget && target && !orbiting && !top) { paddingAt = 0; frame(0.6); } },
    /** Moves the camera in (step > 0) or out; a circling camera keeps circling at the new distance. */
    zoomBy(step) {
      if (!widget || !target) return;
      range = Math.max(RANGE_MIN, Math.min(RANGE_MAX, range * (step > 0 ? .75 : 1 / .75)));
      if (!orbiting) frame(0.4);
    },
    orbit,
    get isOpen() { return open; }, get isTop() { return top; }, get isOrbiting() { return orbiting; }
  };
}
