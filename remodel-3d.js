/**
 * Interactive 3D remodel preview. The house is built in the browser from the homeowner's own
 * measurements and choices (see house-spec.js), so siding, roofing, windows, doors and the
 * optional additions can be restyled and orbited before anything is priced. Three.js is
 * self-hosted and loaded on first use only; nothing is uploaded or measured from the render.
 */
const THREE_BASE = new URL('./vendor/three/', import.meta.url).href;

export function setupRemodel3D({ stage, previewStage = null, getSpec, onStatus, onReady, onError }) {
  const stages = [stage, previewStage].filter(Boolean);
  let activeStage = stage;
  let Three = null, renderer = null, scene = null, camera = null, sun = null, hemi = null;
  let house = null, beforeHouse = null, afterHouse = null;
  let open = false, starting = null, spec = null, beforeSpec = null, observer = null, resizer = null;
  let azimuth = .65, elevation = .38, radius = 90, fitRadius = 90, splitPercent = 100;
  const pointers = new Map(), textures = new Map(), materials = new Map();

  const views = {
    corner: { azimuth: .65, elevation: .38 },
    front: { azimuth: 0, elevation: .17 },
    top: { azimuth: .65, elevation: 1.32 }
  };
  function seeded(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  /** Grayscale canvas patterns; the material colour does the tinting, so one texture serves every colour. */
  function pattern(kind) {
    if (textures.has(kind)) return textures.get(kind);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d'), rand = seeded(kind.length * 7919);
    ctx.fillStyle = '#efefef'; ctx.fillRect(0, 0, 256, 256);
    const speckle = (n, alpha) => { for (let i = 0; i < n; i++) { ctx.fillStyle = `rgba(0,0,0,${rand() * alpha})`; ctx.fillRect(rand() * 256, rand() * 256, 2, 2); } };
    if (kind === 'lap' || kind === 'lap-wide') {
      const row = kind === 'lap' ? 32 : 42;
      for (let y = 0; y < 256; y += row) {
        ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(0, y, 256, 2);
        ctx.fillStyle = 'rgba(0,0,0,.30)'; ctx.fillRect(0, y + row - 3, 256, 3);
        ctx.fillStyle = 'rgba(0,0,0,.10)'; ctx.fillRect(0, y + row - 7, 256, 2);
      }
    } else if (kind === 'board') {
      for (let x = 0; x < 256; x += 36) {
        ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(x + 15, 0, 6, 256); ctx.fillRect(x + 34, 0, 2, 256);
        ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(x + 21, 0, 2, 256);
      }
    } else if (kind === 'shingle') {
      for (let y = 0, r = 0; y < 256; y += 28, r++) {
        ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.fillRect(0, y + 25, 256, 3);
        for (let x = (r % 2) * -32; x < 256; x += 64) { ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(x, y, 2, 26); }
      }
      speckle(900, .12);
    } else if (kind === 'brick') {
      ctx.fillStyle = '#c9c2b4'; ctx.fillRect(0, 0, 256, 256);
      for (let y = 0, r = 0; y < 256; y += 24, r++) for (let x = (r % 2) * -32; x < 256; x += 64) {
        ctx.fillStyle = `rgba(${205 + rand() * 40},${205 + rand() * 40},${205 + rand() * 40},1)`; ctx.fillRect(x + 2, y + 2, 60, 20);
      }
    } else if (kind === 'deck') {
      for (let y = 0; y < 256; y += 30) { ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(0, y + 27, 256, 3); ctx.fillStyle = 'rgba(90,60,30,.14)'; ctx.fillRect(0, y, 256, 12); }
      speckle(300, .08);
    } else { speckle(kind === 'grass' ? 2600 : 700, kind === 'grass' ? .16 : .07); }
    const texture = new Three.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = Three.RepeatWrapping; texture.colorSpace = Three.SRGBColorSpace; texture.anisotropy = 4;
    textures.set(kind, texture); return texture;
  }
  function material(key, color, kind, repeatX = 1, repeatY = 1, rough = .85) {
    const id = `${key}|${repeatX.toFixed(1)}|${repeatY.toFixed(1)}`;
    if (materials.has(id)) return materials.get(id);
    const options = { color: new Three.Color(color), roughness: rough, metalness: 0 };
    if (kind) { const map = pattern(kind).clone(); map.repeat.set(repeatX, repeatY); map.needsUpdate = true; options.map = map; }
    const created = new Three.MeshStandardMaterial(options); materials.set(id, created); return created;
  }
  function box(parent, w, h, d, mat, x, y, z, { rx = 0, ry = 0, rz = 0, shadow = true } = {}) {
    const mesh = new Three.Mesh(new Three.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); mesh.castShadow = shadow; mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  }

  function buildVariant(variantSpec) {
    const group = new Three.Group();
    const { lengthFt: L, widthFt: W, wallHeightFt: H, gableRiseFt: rise, storyHeightFt: storyH } = variantSpec;
    const base = 1, wallTop = base + H, ridge = wallTop + rise;
    const sidingX = material(`siding-${variantSpec.sidingHex}-${variantSpec.texture}-f`, variantSpec.sidingHex, variantSpec.texture, L / 4, H / 4);
    const sidingZ = material(`siding-${variantSpec.sidingHex}-${variantSpec.texture}-s`, variantSpec.sidingHex, variantSpec.texture, W / 4, H / 4);
    const trim = material('trim', '#f6f4e8', null, 1, 1, .6);
    const frame = material(`frame-${variantSpec.frameHex}`, variantSpec.frameHex, null, 1, 1, .55);
    const roofMat = material(`roof-${variantSpec.roofHex}`, variantSpec.roofHex, 'shingle', L / 5, 3, .95);
    const concrete = material('concrete', '#b9bab2', 'concrete', 3, 1, .95);
    const brick = material('brick', '#9a5a48', 'brick', L / 5, .8, .9);
    const glass = material('glass', '#93bccd', null, 1, 1, .08);
    glass.metalness = .35;

    // Lot: lawn, walk to the door, driveway to the right.
    const lawn = new Three.Mesh(new Three.CircleGeometry(Math.max(L, W) * 2.4 + 90, 48),
      material(`lawn-${variantSpec.before ? 'b' : 'a'}`, variantSpec.before ? '#77854f' : '#5c8743', 'grass', 22, 22, 1));
    lawn.rotation.x = -Math.PI / 2; lawn.receiveShadow = true; group.add(lawn);
    box(group, 4.5, .12, W * .9 + 14, concrete, 0, .06, W / 2 + (W * .9 + 14) / 2 - .5, { shadow: false });
    box(group, 11, .12, W + 26, material('drive', '#a9a9a2', 'concrete', 2, 6, .95), L / 2 + 8, .05, 6, { shadow: false });

    // Body: foundation, siding box (per-face repeats), brick/stone share as a ground-floor skirt.
    box(group, L + .5, base + .3, W + .5, concrete, 0, (base + .3) / 2 - .15, 0);
    const walls = new Three.Mesh(new Three.BoxGeometry(L, H, W), [sidingZ, sidingZ, sidingX, sidingX, sidingX, sidingX]);
    walls.position.y = base + H / 2; walls.castShadow = walls.receiveShadow = true; group.add(walls);
    if (variantSpec.masonryPercent >= 10) {
      const skirtH = Math.min(4.5, 1.5 + variantSpec.masonryPercent / 22);
      box(group, L + .24, skirtH, .24, brick, 0, base + skirtH / 2, W / 2 + .06);
      box(group, .24, skirtH, W + .24, brick, -L / 2 - .06, base + skirtH / 2, 0);
      box(group, .24, skirtH, W + .24, brick, L / 2 + .06, base + skirtH / 2, 0);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(group, .65, H, .65, trim, sx * L / 2, base + H / 2, sz * W / 2);

    // Gables and roof.
    const gableShape = new Three.Shape();
    gableShape.moveTo(-W / 2, 0); gableShape.lineTo(W / 2, 0); gableShape.lineTo(0, rise); gableShape.closePath();
    const gableMat = material(`gable-${variantSpec.sidingHex}-${variantSpec.texture}`, variantSpec.sidingHex, variantSpec.texture, .25, .25);
    for (const sx of [-1, 1]) {
      const gable = new Three.Mesh(new Three.ShapeGeometry(gableShape), gableMat);
      gable.position.set(sx * (L / 2 - .02), wallTop, 0); gable.rotation.y = sx * Math.PI / 2; gable.castShadow = true; group.add(gable);
    }
    const angle = Math.atan2(rise, W / 2), eaveZ = W / 2 + 1.6, eaveY = wallTop - 1.6 * Math.tan(angle);
    const slope = Math.hypot(eaveZ, ridge - eaveY) + .4;
    for (const sz of [-1, 1]) {
      box(group, L + 2.6, .38, slope, roofMat, 0, (ridge + eaveY) / 2 + .22, sz * eaveZ / 2, { rx: sz * angle });
      box(group, L + 2.6, .7, .3, trim, 0, eaveY + .1, sz * (eaveZ + .05));
    }
    box(group, L + 2.7, .45, 1.1, roofMat, 0, ridge + .32, 0);
    box(group, 2.6, rise + 4.5, 2.6, brick, L * .3, wallTop + (rise + 4.5) / 2 - 1, -W * .14);

    // Windows from the homeowner's count, with shutters on the street face when chosen.
    const shutter = material('shutter', '#2e4a3e', null, 1, 1, .7);
    for (const win of variantSpec.windows) {
      const winGroup = new Three.Group();
      box(winGroup, 3.2, 4.5, .4, frame, 0, 0, 0);
      box(winGroup, 2.65, 3.95, .18, glass, 0, 0, .16, { shadow: false });
      box(winGroup, .16, 3.95, .1, frame, 0, 0, .26); box(winGroup, 2.65, .16, .1, frame, 0, 0, .26);
      box(winGroup, 3.7, .3, .6, trim, 0, -2.35, .08);
      if (variantSpec.shutters && win.face === 'front') { box(winGroup, .95, 4.4, .16, shutter, -2.15, 0, 0); box(winGroup, .95, 4.4, .16, shutter, 2.15, 0, 0); }
      const y = base + win.floor * storyH + storyH * .56;
      if (win.face === 'front') winGroup.position.set((win.along - .5) * L, y, W / 2 + .12);
      if (win.face === 'back') { winGroup.position.set((win.along - .5) * L, y, -W / 2 - .12); winGroup.rotation.y = Math.PI; }
      if (win.face === 'left') { winGroup.position.set(-L / 2 - .12, y, (win.along - .5) * W); winGroup.rotation.y = -Math.PI / 2; }
      if (win.face === 'right') { winGroup.position.set(L / 2 + .12, y, (win.along - .5) * W); winGroup.rotation.y = Math.PI / 2; }
      group.add(winGroup);
    }

    // Entry: framed door in the chosen product colour, stoop and a porch light.
    const door = new Three.Group(); door.position.set(0, base, W / 2 + .1); group.add(door);
    box(door, 4.3, 7.6, .45, trim, 0, 3.8, 0);
    box(door, 3.5, 7.1, .3, material(`door-${variantSpec.doorHex}`, variantSpec.doorHex, null, 1, 1, .5), 0, 3.55, .14);
    box(door, 2.1, 1.7, .12, glass, 0, 5.9, .3, { shadow: false });
    const knob = new Three.Mesh(new Three.SphereGeometry(.14, 12, 8), material('knob', '#d8b971', null, 1, 1, .35));
    knob.position.set(1.35, 3.4, .36); door.add(knob);
    if (!variantSpec.porch) { box(group, 6.5, .55, 3.2, concrete, 0, .75, W / 2 + 1.6); box(group, 5, .5, 1.6, concrete, 0, .28, W / 2 + 3.4); }

    // Optional additions (After only): covered porch and roof dormers.
    if (variantSpec.porch) {
      const porchW = Math.min(L * .58, 28), depth = 7.5, deckY = .95, roofY = base + Math.min(storyH - .4, 8.6);
      box(group, porchW, .5, depth, material('deck', '#9a724e', 'deck', porchW / 4, 2, .8), 0, deckY, W / 2 + depth / 2);
      box(group, 5.5, .45, 1.7, concrete, 0, .55, W / 2 + depth + .8); box(group, 5.5, .4, 1.5, concrete, 0, .2, W / 2 + depth + 2.1);
      for (const sx of [-1, 1]) box(group, .65, roofY - deckY, .65, trim, sx * (porchW / 2 - .7), (roofY + deckY) / 2, W / 2 + depth - .7);
      box(group, porchW + 1.5, .55, .55, trim, 0, roofY, W / 2 + depth - .7);
      box(group, porchW + 2, .3, depth + 2.2, roofMat, 0, roofY + .75, W / 2 + depth / 2 - .4, { rx: .16 });
    }
    if (variantSpec.dormers) for (const sx of [-1, 1]) {
      const g = new Three.Group(); const z = W * .31, y = wallTop + rise * .36;
      g.position.set(sx * L * .24, y, z); group.add(g);
      box(g, 4.4, 4.6, 4, sidingZ, 0, 0, 0);
      box(g, 3, 3.4, .18, frame, 0, .2, 2.02); box(g, 2.4, 2.8, .14, glass, 0, .2, 2.12, { shadow: false });
      box(g, 3.4, .26, 4.9, roofMat, -1.22, 2.95, 0, { rz: .62 }); box(g, 3.4, .26, 4.9, roofMat, 1.22, 2.95, 0, { rz: -.62 });
      const triangle = new Three.Shape(); triangle.moveTo(-2.2, 0); triangle.lineTo(2.2, 0); triangle.lineTo(0, 1.55); triangle.closePath();
      const face = new Three.Mesh(new Three.ShapeGeometry(triangle), gableMat);
      face.position.set(0, 2.3, 2.01); face.castShadow = true; g.add(face);
    }

    // Planting: foundation shrubs and two simple shade trees.
    const rand = seeded(42), greens = ['#3f6634', '#4d7a3c', '#35602e'];
    const shrubCount = variantSpec.before ? 3 : Math.max(5, Math.round(L / 7));
    for (let i = 0; i < shrubCount; i++) {
      const x = -L / 2 + 3 + (i * (L - 6)) / Math.max(1, shrubCount - 1) + (rand() - .5) * 1.5;
      if (Math.abs(x) < 3.4) continue;
      const bush = new Three.Mesh(new Three.SphereGeometry(1.15 + rand() * .6, 10, 8), material(`bush${i % 3}`, greens[i % 3], null, 1, 1, 1));
      bush.position.set(x, .95, W / 2 + 1.7 + rand()); bush.scale.y = .72; bush.castShadow = true; group.add(bush);
    }
    for (const [tx, tz, s] of [[-L / 2 - 10, W / 2 + 11, 1], [L / 2 + 13, -W / 2 - 7, .8]]) {
      const trunk = new Three.Mesh(new Three.CylinderGeometry(.4 * s, .55 * s, 7 * s, 8), material('trunk', '#6b4e35', null, 1, 1, .95));
      trunk.position.set(tx, 3.5 * s, tz); trunk.castShadow = true; group.add(trunk);
      for (const [ox, oy, oz, r] of [[0, 8.4, 0, 3.6], [-2, 7, .8, 2.5], [2.1, 7.3, -.6, 2.7]]) {
        const crown = new Three.Mesh(new Three.SphereGeometry(r * s, 12, 10), material(`crown-${variantSpec.before ? 'b' : 'a'}`, variantSpec.before ? '#5d7346' : '#47793a', null, 1, 1, 1));
        crown.position.set(tx + ox * s, oy * s, tz + oz * s); crown.castShadow = true; group.add(crown);
      }
    }
    return group;
  }

  function applyAtmosphere(isBefore) {
    const bg = isBefore ? '#bcc5c9' : '#a9cbe4';
    scene.background = new Three.Color(bg);
    scene.fog = new Three.Fog(bg, 260, 620);
    sun.intensity = isBefore ? 1.7 : 2.9;
    hemi.intensity = isBefore ? .55 : .8;
  }

  function ensureBeforeHouse() {
    if (!beforeHouse && house && Three) {
      beforeSpec = getSpec(true);
      beforeHouse = buildVariant(beforeSpec);
      house.add(beforeHouse);
    }
  }

  function renderScene() {
    if (!renderer || !scene || !camera || !afterHouse) return;
    const effectiveSplit = spec?.before ? 0 : splitPercent;
    if (effectiveSplit < 100) ensureBeforeHouse();
    const width = activeStage?.clientWidth || 0, height = activeStage?.clientHeight || 0;
    if (effectiveSplit <= 0 || effectiveSplit >= 100 || !width || !height) {
      const showBefore = effectiveSplit <= 0;
      renderer.setScissorTest(false);
      if (beforeHouse) beforeHouse.visible = showBefore;
      afterHouse.visible = !showBefore;
      applyAtmosphere(showBefore);
      renderer.render(scene, camera);
      return;
    }
    const beforeWidth = Math.round(width * (100 - effectiveSplit) / 100);
    renderer.setScissorTest(true);
    // Left side: Before (existing dated palette, no additions).
    beforeHouse.visible = true; afterHouse.visible = false;
    applyAtmosphere(true);
    renderer.setScissor(0, 0, beforeWidth, height);
    renderer.render(scene, camera);
    // Right side: After (selected siding, roof, windows, door and additions).
    beforeHouse.visible = false; afterHouse.visible = true;
    applyAtmosphere(false);
    renderer.setScissor(beforeWidth, 0, width - beforeWidth, height);
    renderer.render(scene, camera);
    // Crisp 2px vertical split line in the canvas (no inline DOM styles needed).
    renderer.setScissor(Math.max(0, beforeWidth - 1), 0, 2, height);
    renderer.setClearColor('#102303', 1);
    renderer.clearColor();
    renderer.setScissorTest(false);
  }

  function buildHouse(next) {
    spec = next;
    beforeSpec = null;
    const afterSpec = next.before ? getSpec(false) : next;
    if (house) { house.traverse(node => node.geometry?.dispose()); scene.remove(house); }
    house = new Three.Group();
    beforeHouse = null;
    afterHouse = buildVariant(afterSpec);
    house.add(afterHouse);
    if ( next.before || splitPercent < 100 ) ensureBeforeHouse();
    scene.add(house);
    const { lengthFt: L, widthFt: W, wallHeightFt: H } = spec;
    fitRadius = Math.max(L, W) * 1.35 + H + 26;
    for (const s of stages) s.dataset.spec = spec.label;
    frameCamera();
    renderScene();
  }

  function frameCamera() {
    if (!camera || !spec) return;
    const targetY = 1 + spec.wallHeightFt * .42, r = radius;
    camera.position.set(
      r * Math.cos(elevation) * Math.sin(azimuth),
      targetY + r * Math.sin(elevation),
      r * Math.cos(elevation) * Math.cos(azimuth)
    );
    camera.lookAt(0, targetY, 0);
  }
  function setView(name) {
    const view = views[name] || views.corner;
    azimuth = view.azimuth; elevation = view.elevation; radius = fitRadius * (name === 'top' ? 1.15 : 1);
    frameCamera();
    renderScene();
  }
  function resize() {
    if (!renderer || !activeStage) return;
    const w = activeStage.clientWidth, h = activeStage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    renderScene();
  }
  function mountCanvas(targetStage) {
    if (!targetStage || !stages.includes(targetStage)) return;
    activeStage = targetStage;
    if (!renderer) return;
    if (renderer.domElement.parentElement !== activeStage) activeStage.append(renderer.domElement);
    resize();
    frameCamera();
    renderScene();
  }
  function controls(canvas) {
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '3D remodel preview. Drag or use arrow keys to look around. Scroll, pinch, or use plus and minus to zoom. Home resets the view.');
    const clampView = () => { elevation = Math.max(.06, Math.min(1.45, elevation)); radius = Math.max(26, Math.min(240, radius)); frameCamera(); renderScene(); };
    canvas.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Home') return setView('corner');
      if (event.key === 'ArrowLeft') azimuth -= .16;
      if (event.key === 'ArrowRight') azimuth += .16;
      if (event.key === 'ArrowUp') elevation += .09;
      if (event.key === 'ArrowDown') elevation -= .09;
      if (event.key === '+' || event.key === '=') radius /= 1.14;
      if (event.key === '-') radius *= 1.14;
      clampView();
    });
    canvas.addEventListener('wheel', event => { event.preventDefault(); radius *= Math.exp(Math.max(-100, Math.min(100, event.deltaY)) * .0022); clampView(); }, { passive: false });
    canvas.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      pointers.set(event.pointerId, [event.clientX, event.clientY]);
      canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true });
    });
    canvas.addEventListener('pointermove', event => {
      const old = pointers.get(event.pointerId); if (!old) return;
      if (pointers.size === 1) { azimuth -= (event.clientX - old[0]) * .008; elevation += (event.clientY - old[1]) * .005; }
      else {
        const other = [...pointers].find(([id]) => id !== event.pointerId)?.[1];
        if (other) {
          const before = Math.hypot(old[0] - other[0], old[1] - other[1]), after = Math.hypot(event.clientX - other[0], event.clientY - other[1]);
          if (before > 5 && after > 5) radius *= before / after;
        }
      }
      pointers.set(event.pointerId, [event.clientX, event.clientY]); clampView();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, event => pointers.delete(event.pointerId));
  }

  async function start() {
    Three ??= await import(`${THREE_BASE}three.module.js`);
    renderer = new Three.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = Three.PCFSoftShadowMap;
    renderer.toneMapping = Three.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.06;
    activeStage.append(renderer.domElement);
    scene = new Three.Scene();
    camera = new Three.PerspectiveCamera(42, 1, .5, 1200);
    hemi = new Three.HemisphereLight('#eaf4ff', '#5d7050', .8); scene.add(hemi);
    sun = new Three.DirectionalLight('#fff2d8', 2.9);
    sun.position.set(70, 95, 55); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 95, bottom: -95, near: 10, far: 320 });
    sun.shadow.bias = -.0004; scene.add(sun);
    controls(renderer.domElement);
    resizer = new ResizeObserver(resize);
    for (const s of stages) resizer.observe(s);
    buildHouse(getSpec()); radius = fitRadius; setView('corner'); resize();
  }
  async function openView(targetStage = activeStage) {
    if (targetStage && stages.includes(targetStage)) activeStage = targetStage;
    if (open && renderer) { mountCanvas(activeStage); return true; }
    open = true;
    for (const s of stages) s.setAttribute('aria-busy', 'true');
    onStatus?.('Building your home in 3D from the measurements and choices on this page…');
    try {
      starting ??= start().catch(error => { starting = null; throw error; });
      await starting;
    } catch {
      open = false;
      for (const s of stages) s.removeAttribute('aria-busy');
      onStatus?.('The 3D preview could not start on this device. The example home and your photo still work.');
      onError?.();
      return false;
    }
    if (!open) return false;
    mountCanvas(activeStage);
    renderScene();
    for (const s of stages) { s.removeAttribute('aria-busy'); s.dataset.ready = 'true'; }
    onStatus?.(`3D preview ready — ${spec.label}. Drag to look around, scroll or pinch to zoom.`);
    onReady?.();
    return true;
  }
  function closeView() { open = false; renderer?.setAnimationLoop(null); }
  // Runs only while a stage is actually on screen, so the runtime never downloads for
  // visitors who only use the earlier steps, and rendering pauses whenever it scrolls away.
  if ('IntersectionObserver' in globalThis) {
    const visible = new Set();
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      if (visible.size) {
        const preferred = visible.has(stage) ? stage : [...visible][0];
        openView(preferred);
      } else closeView();
    }, { threshold: .15 });
    for (const s of stages) observer.observe(s);
  }
  return {
    open: openView, close: closeView, setView,
    attach(targetStage) { mountCanvas(targetStage); },
    setSplit(percent) {
      splitPercent = Math.max(0, Math.min(100, Number(percent) || 0));
      renderScene();
    },
    get split() { return splitPercent; },
    refresh() {
      if (renderer && scene) {
        buildHouse(getSpec());
        onStatus?.(`3D preview ready — ${spec.label}. Drag to look around, scroll or pinch to zoom.`);
      }
    },
    get isOpen() { return open; },
    download() {
      if (!renderer) return;
      renderScene();
      renderer.domElement.toBlob(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = 'curbquote-3d-remodel.png'; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
    }
  };
}
