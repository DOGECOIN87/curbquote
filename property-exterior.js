import { loadCesium } from './cesium-runtime.js';
import { exteriorForLocation } from './exterior-catalog.js';

/** Key-free local exterior. Closing cancels pending work and frees the GPU context. */
export function setupExterior3D({ stage, onFailure, onViewChange }) {
  const container = document.createElement('div'); container.className = 'aerial-3d exterior-3d'; container.id = 'exterior-model'; container.hidden = true;
  container.setAttribute('aria-label', 'Measured roof surface with simplified exterior walls'); stage.append(container);
  let serial = 0, open = false, widget = null, Cesium, stopWaiting, target;
  let heading = -0.65, pitch = -0.55, range = 62, top = false;
  const pointers = new Map();
  function frame() {
    if (!widget || !target) return;
    widget.scene.camera.lookAt(target, new Cesium.HeadingPitchRange(heading, pitch, range));
    widget.scene.requestRender(); onViewChange?.();
  }
  function recenter() { heading = -0.65; pitch = -0.55; range = 62; top = false; frame(); }
  function close() {
    serial++; open = false; stopWaiting?.(); stopWaiting = null; pointers.clear();
    const previous = widget; widget = null; target = null;
    try { previous?.destroy(); } catch { /* context already lost */ }
    container.replaceChildren(); container.hidden = true; container.removeAttribute('aria-busy');
  }
  function controls(canvas) {
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Exterior model. Drag or use arrow keys to orbit. Scroll, pinch, or use plus and minus to zoom. Home recenters.');
    canvas.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Home') return recenter();
      if (event.key === 'ArrowLeft') heading -= .15;
      if (event.key === 'ArrowRight') heading += .15;
      if (event.key === 'ArrowUp') pitch -= .1;
      if (event.key === 'ArrowDown') pitch += .1;
      if (event.key === '+' || event.key === '=') range /= 1.15;
      if (event.key === '-') range *= 1.15;
      constrain();
    });
    canvas.addEventListener('wheel', event => { event.preventDefault(); range *= Math.exp(Math.max(-100, Math.min(100, event.deltaY)) * .003); constrain(); }, { passive: false });
    canvas.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault(); canvas.focus({ preventScroll: true });
      pointers.set(event.pointerId, [event.clientX, event.clientY]); canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      const old = pointers.get(event.pointerId); if (!old) return;
      if (pointers.size === 1) { heading -= (event.clientX-old[0]) * .008; pitch += (event.clientY-old[1]) * .005; }
      else {
        const other = [...pointers].find(([id]) => id !== event.pointerId)[1];
        const before = Math.hypot(old[0]-other[0], old[1]-other[1]), after = Math.hypot(event.clientX-other[0], event.clientY-other[1]);
        if (before > 5 && after > 5) range *= before / after;
      }
      pointers.set(event.pointerId, [event.clientX, event.clientY]); constrain();
    });
    for (const type of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(type, event => pointers.delete(event.pointerId));
  }
  function constrain() {
    range = Math.max(28, Math.min(130, range)); pitch = Math.max(-Math.PI/2 + .01, Math.min(-.12, pitch));
    top = pitch < -1.5; frame();
  }
  async function show(location) {
    close(); const example = exteriorForLocation(location);
    if (!example) throw new Error('No reviewed exterior model for this address.');
    const request = serial; open = true; container.hidden = false; container.setAttribute('aria-busy', 'true');
    const current = () => request === serial && open;
    let timer;
    try {
      Cesium = await Promise.race([loadCesium(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('3D runtime timed out.')), 15000); })]).finally(() => clearTimeout(timer));
      if (!current()) return null;
      widget = new Cesium.CesiumWidget(container, { baseLayer: false, globe: false, skyBox: false, skyAtmosphere: false, requestRenderMode: true, showRenderLoopErrors: false, msaaSamples: 1 });
      const scene = widget.scene;
      scene.backgroundColor = Cesium.Color.fromCssColorString('#102303');
      scene.screenSpaceCameraController.enableInputs = false;
      scene.fog.enabled = false;
      // Keep the model in a local frame. Source orthometric heights are not ellipsoid heights.
      const { lon, lat } = example.coordinates;
      const transform = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(lon, lat, 0));
      target = Cesium.Matrix4.multiplyByPoint(transform, new Cesium.Cartesian3(0, 0, 4), new Cesium.Cartesian3());
      const direction = Cesium.Matrix4.multiplyByPointAsVector(transform, new Cesium.Cartesian3(.4, -.6, -1), new Cesium.Cartesian3());
      scene.light = new Cesium.DirectionalLight({ direction: Cesium.Cartesian3.normalize(direction, direction), intensity: 2.4 });
      controls(widget.canvas); recenter();
      const loadingModel = Cesium.Model.fromGltfAsync({ url: new URL(example.model, import.meta.url).href, modelMatrix: transform, incrementallyLoadTextures: false })
        .then(model => { if (!current()) model.destroy(); return model; });
      const model = await Promise.race([
        loadingModel,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Exterior model timed out.')), 15000); })
      ]).finally(() => clearTimeout(timer));
      if (!current()) return null;
      scene.primitives.add(model);
      return await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error, result) => {
          if (settled) return; settled = true; clearTimeout(deadline); stopWaiting = null;
          if (error) reject(error); else resolve(result);
        };
        const deadline = setTimeout(() => finish(new Error('Exterior render timed out.')), 15000);
        stopWaiting = () => finish(null, null);
        model.readyEvent.addEventListener(() => { if (current()) { container.removeAttribute('aria-busy'); frame(); finish(null, 'framed'); } });
        model.errorEvent.addEventListener(error => { if (current()) { if (!settled) finish(error); else { close(); onFailure?.(error); } } });
        scene.renderError.addEventListener((_, error) => { if (current()) { if (!settled) finish(error); else { close(); onFailure?.(error); } } });
        scene.requestRender();
      });
    } catch (error) { if (current()) close(); throw error; }
  }
  return { show, close, recenter, rotate() { heading += Math.PI/2; frame(); }, setTop(value) { top = value; pitch = value ? -Math.PI/2 + .01 : -.55; frame(); }, get isOpen() { return open; }, get isTop() { return top; } };
}
