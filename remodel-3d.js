const THREE_BASE = new URL('./vendor/three/', import.meta.url).href;
import { ROOF_COLORS } from './house-spec.js';

function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

/**
 * Self-hosted Three.js exterior studio. Builds an orbitable house from `houseSpec()` and updates
 * live as the homeowner edits dimensions, materials, colors or additions. Supports mounting its
 * single WebGL canvas in either the inline Step 3/4 dock (`previewStage`) or the Step 5 studio
 * (`stage`), rendering a real-time Before/After split comparison via WebGL scissor testing, and
 * smoothly easing camera orbits and split sweeps when reduced motion is not requested.
 */
export function setupRemodel3D({ stage, previewStage = null, getSpec, onStatus, onReady, onError, onSplitChange }) {
  const stages = [stage, previewStage].filter(Boolean);
  let activeStage = stage;
  let Three, renderer, scene, camera, sun, hemi, house, beforeHouse, afterHouse, spec, beforeSpec, resizer, observer, starting;
  let skyBeforeTex, skyAfterTex, contactShadowTexture;
  let open = false;
  let splitPercent = 100;
  let splitPointerId = null;
  let animFrame = 0;
  const views = {
    // Framed using Rule of Thirds & Golden Ratio: eave along upper third, porch & dormers spanning the 50/50 split.
    corner: { azimuth: .36, elevation: .28 },
    front: { azimuth: 0, elevation: .19 },
    top: { azimuth: .01, elevation: 1.32 }
  };
  let azimuth = views.corner.azimuth, elevation = views.corner.elevation, radius = 92, fitRadius = 92;
  const pointers = new Map();
  const textures = new Map(), materials = new Map();

  const prefersReducedMotion = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function makeSkyTexture(isBefore) {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    if (isBefore) {
      grad.addColorStop(0, '#7d8e99');
      grad.addColorStop(0.382, '#a7b4bc');
      grad.addColorStop(0.618, '#cfd7dc');
      grad.addColorStop(1, '#bcc5c9');
    } else {
      grad.addColorStop(0, '#5a93c4');
      grad.addColorStop(0.333, '#8fc0e3');
      grad.addColorStop(0.618, '#e3f0e5');
      grad.addColorStop(1, '#c7e2c9');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 512);
    const tex = new Three.CanvasTexture(canvas);
    tex.colorSpace = Three.SRGBColorSpace;
    return tex;
  }

  function makeContactShadowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    gradient.addColorStop(0, 'rgba(16,35,3,.42)');
    gradient.addColorStop(.48, 'rgba(16,35,3,.2)');
    gradient.addColorStop(1, 'rgba(16,35,3,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const texture = new Three.CanvasTexture(canvas);
    texture.colorSpace = Three.SRGBColorSpace;
    return texture;
  }

  function pattern(kind) {
    if (textures.has(kind)) return textures.get(kind);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const rand = seeded(kind.split('').reduce((n, ch) => n * 33 + ch.charCodeAt(0), 7));
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 256, 256);
    const speckle = (count, alpha) => {
      for (let i = 0; i < count; i++) {
        const v = rand() > .5 ? 255 : 0;
        ctx.fillStyle = `rgba(${v},${v},${v},${(rand() * alpha).toFixed(3)})`;
        ctx.fillRect(rand() * 256, rand() * 256, 2, 2);
      }
    };
    if (kind === 'glass') {
      const sky = ctx.createLinearGradient(0, 0, 256, 256);
      sky.addColorStop(0, '#547988'); sky.addColorStop(.3, '#b8d8dc'); sky.addColorStop(.52, '#e9eee2'); sky.addColorStop(.68, '#789eaa'); sky.addColorStop(1, '#385c69');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, 256, 256);
      const reflection = ctx.createLinearGradient(24, 0, 118, 256);
      reflection.addColorStop(0, 'rgba(255,255,255,.42)'); reflection.addColorStop(.45, 'rgba(255,255,255,.08)'); reflection.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = reflection; ctx.beginPath(); ctx.moveTo(24, 0); ctx.lineTo(118, 0); ctx.lineTo(44, 256); ctx.lineTo(0, 256); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(8, 8, 4, 240); ctx.fillRect(18, 8, 2, 240);
      ctx.fillStyle = 'rgba(16,35,3,.12)'; ctx.fillRect(0, 208, 256, 48);
      speckle(180, .025);
    } else if (kind === 'lap' || kind === 'fiber') {
      const step = kind === 'lap' ? 24 : 32;
      for (let y = 0; y < 256; y += step) {
        const g = ctx.createLinearGradient(0, y, 0, y + step);
        g.addColorStop(0, '#ffffff'); g.addColorStop(.82, '#f0f0f0'); g.addColorStop(1, '#c9c9c9');
        ctx.fillStyle = g; ctx.fillRect(0, y, 256, step - 2);
        ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(0, y + step - 2, 256, 2);
      }
      speckle(kind === 'fiber' ? 1100 : 400, .06);
    } else if (kind === 'board') {
      for (let x = 0; x < 256; x += 32) {
        ctx.fillStyle = 'rgba(0,0,0,.15)'; ctx.fillRect(x, 0, 4, 256);
        ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(x + 4, 0, 3, 256);
      }
      speckle(900, .08);
    } else if (kind === 'shingle') {
      for (let row = 0, y = 0; y < 256; row++, y += 16) {
        ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(0, y + 14, 256, 2);
        for (let x = (row % 2) * 16; x < 256; x += 32) {
          const shade = Math.round((rand() - .5) * 26);
          ctx.fillStyle = shade > 0 ? `rgba(255,255,255,${shade / 255})` : `rgba(0,0,0,${-shade / 255})`;
          ctx.fillRect(x, y, 30, 14);
          ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(x, y, 1, 14);
        }
      }
      speckle(1600, .12);
    } else if (kind === 'brick') {
      ctx.fillStyle = '#d7cfc2'; ctx.fillRect(0, 0, 256, 256);
      for (let row = 0, y = 0; y < 256; row++, y += 16) {
        for (let x = (row % 2) * 22 - 22; x < 256; x += 44) {
          const d = Math.round((rand() - .5) * 32);
          ctx.fillStyle = `rgb(${215 + d},${195 + d},${185 + d})`;
          ctx.fillRect(x + 2, y + 2, 40, 12);
        }
      }
      speckle(900, .1);
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
  function contactShadowMaterial() {
    if (!materials.has('contact-shadow')) {
      contactShadowTexture ??= makeContactShadowTexture();
      materials.set('contact-shadow', new Three.MeshBasicMaterial({ map: contactShadowTexture, color: '#18210f', transparent: true, opacity: .78, depthWrite: false, toneMapped: false }));
    }
    return materials.get('contact-shadow');
  }
  function box(parent, w, h, d, mat, x, y, z, { rx = 0, ry = 0, rz = 0, shadow = true } = {}) {
    const mesh = new Three.Mesh(new Three.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); mesh.castShadow = shadow; mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  }

  function buildVariant(variantSpec) {
    const group = new Three.Group();
    const { lengthFt: L, widthFt: W, wallHeightFt: H, gableRiseFt: rise, storyHeightFt: storyH } = variantSpec;
    const roofForm = variantSpec.roofForm || 'gable';
    const porchStyle = variantSpec.porchStyle || 'portico';
    const accent = variantSpec.accent || '';
    const trimColor = variantSpec.trimHex || '#f6f4e8';
    const timberColor = variantSpec.timberHex || '#4a3728';
    const overhang = variantSpec.overhangFt || 1.35;
    const base = 1, wallTop = base + H, ridge = wallTop + rise;
    const sidingX = material(`siding-${variantSpec.sidingHex}-${variantSpec.texture}-f`, variantSpec.sidingHex, variantSpec.texture, L / 4, H / 4);
    const sidingZ = material(`siding-${variantSpec.sidingHex}-${variantSpec.texture}-s`, variantSpec.sidingHex, variantSpec.texture, W / 4, H / 4);
    const trim = material(`trim-${trimColor}`, trimColor, null, 1, 1, .6);
    const timber = material(`timber-${timberColor}`, timberColor, null, 1, 1, .75);
    const frame = material(`frame-${variantSpec.frameHex}`, variantSpec.frameHex, null, 1, 1, .55);
    const roofMat = material(`roof-${variantSpec.roofHex}`, variantSpec.roofHex, 'shingle', L / 5, 3, .95);
    const concrete = material('concrete', '#b9bab2', 'concrete', 3, 1, .95);
    const brick = material('brick', '#9a5a48', 'brick', L / 5, .8, .9);
    const glass = material('glass', '#d5e9ec', 'glass', 1, 1, .2);
    glass.metalness = .12;

    const makeGableMesh = (spanW, gableH) => {
      const shape = new Three.Shape();
      shape.moveTo(-spanW / 2, 0); shape.lineTo(spanW / 2, 0); shape.lineTo(0, gableH); shape.closePath();
      const geo = new Three.ShapeGeometry(shape);
      const pos = geo.attributes.position, uvs = [];
      for (let i = 0; i < pos.count; i++) uvs.push((pos.getX(i) + spanW / 2) / 4, pos.getY(i) / 4);
      geo.setAttribute('uv', new Three.Float32BufferAttribute(uvs, 2));
      const gableMat = material(`gable-${variantSpec.sidingHex}-${variantSpec.texture}`, variantSpec.sidingHex, variantSpec.texture, 1, 1);
      gableMat.side = Three.DoubleSide;
      const mesh = new Three.Mesh(geo, gableMat);
      mesh.castShadow = mesh.receiveShadow = true;
      return mesh;
    };

    // Lot: a soft contact-shadow apron grounds the foundation and front walk in the lawn.
    const apron = new Three.Mesh(new Three.CircleGeometry(1, 64), contactShadowMaterial());
    apron.rotation.x = -Math.PI / 2; apron.scale.set(L * .78 + (porchStyle === 'wraparound' ? 4 : 0), W * .84 + 6, 1);
    apron.position.set(porchStyle === 'wraparound' ? -2 : 0, .022, variantSpec.porch ? 2 : 0); apron.renderOrder = 1; group.add(apron);
    const lawn = new Three.Mesh(new Three.CircleGeometry(Math.max(L, W) * 2.4 + 90, 48),
      material(`lawn-${variantSpec.before ? 'b' : 'a'}`, variantSpec.before ? '#77854f' : '#5c8743', 'grass', 22, 22, 1));
    lawn.rotation.x = -Math.PI / 2; lawn.receiveShadow = true; group.add(lawn);
    const walkLength = W * .9 + 14, walkCenter = W / 2 + walkLength / 2 - .5;
    const walkJoint = material('walk-joint', '#85877f', null, 1, 1, 1);
    box(group, 4.5, .12, walkLength, concrete, 0, .06, walkCenter, { shadow: false });
    for (const side of [-1, 1]) box(group, .08, .018, walkLength - .4, walkJoint, side * 2.19, .128, walkCenter, { shadow: false });
    for (let jointZ = 5; jointZ < W / 2 + walkLength - 1; jointZ += 7) box(group, 4.35, .018, .07, walkJoint, 0, .128, jointZ, { shadow: false });
    box(group, 11, .12, W + 26, material('drive', '#a9a9a2', 'concrete', 2, 6, .95), L / 2 + 8, .05, 6, { shadow: false });
    const mulch = material('mulch', '#493b2d', 'grass', 4, 1, 1);
    const bedWidth = Math.max(5, (L - 14) / 2);
    for (const side of [-1, 1]) {
      const bedX = side * (bedWidth / 2 + 3.5);
      box(group, bedWidth, .08, 3.4, mulch, bedX, .04, W / 2 + 1.8, { shadow: false });
      box(group, bedWidth, .07, .12, concrete, bedX, .075, W / 2 + 3.48, { shadow: false });
    }

    // Body: staggered split-level wings or unified main rectangular volume + masonry skirt.
    box(group, L + .5, base + .3, W + .5, concrete, 0, (base + .3) / 2 - .15, 0);
    const leftWingH = roofForm === 'split' ? Math.max(8, H * .64) : H;
    if (roofForm === 'split') {
      const halfL = L / 2;
      const wingL = new Three.Mesh(new Three.BoxGeometry(halfL, leftWingH, W), [sidingZ, sidingZ, sidingX, sidingX, sidingX, sidingX]);
      wingL.position.set(-halfL / 2, base + leftWingH / 2, 0); wingL.castShadow = wingL.receiveShadow = true; group.add(wingL);
      const wingR = new Three.Mesh(new Three.BoxGeometry(halfL + .3, H, W), [sidingZ, sidingZ, sidingX, sidingX, sidingX, sidingX]);
      wingR.position.set(halfL / 2 - .15, base + H / 2, 0); wingR.castShadow = wingR.receiveShadow = true; group.add(wingR);
      for (const sz of [-1, 1]) {
        box(group, .6, leftWingH, .6, trim, -L / 2, base + leftWingH / 2, sz * W / 2);
        box(group, .6, H, .6, trim, L / 2, base + H / 2, sz * W / 2);
        box(group, .55, H, .55, trim, 0, base + H / 2, sz * W / 2);
      }
    } else {
      const walls = new Three.Mesh(new Three.BoxGeometry(L, H, W), [sidingZ, sidingZ, sidingX, sidingX, sidingX, sidingX]);
      walls.position.y = base + H / 2; walls.castShadow = walls.receiveShadow = true; group.add(walls);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(group, .65, H, .65, trim, sx * L / 2, base + H / 2, sz * W / 2);
    }
    if (variantSpec.masonryPercent >= 10) {
      const skirtH = Math.min(4.8, 1.5 + variantSpec.masonryPercent / 20);
      box(group, L + .24, skirtH, .24, brick, 0, base + skirtH / 2, W / 2 + .06);
      box(group, .24, skirtH, W + .24, brick, -L / 2 - .06, base + skirtH / 2, 0);
      box(group, .24, skirtH, W + .24, brick, L / 2 + .06, base + skirtH / 2, 0);
    }

    // Roof & gables tailored to North-American architectural forms.
    const halfSpan = W / 2 + overhang, slopeLen = Math.hypot(halfSpan, rise), pitch = Math.atan2(rise, halfSpan);
    if (roofForm === 'flat') {
      box(group, L + overhang * 2, .95, W + overhang * 2, roofMat, 0, wallTop + .48, 0);
      box(group, L + overhang * 2 + .28, .44, W + overhang * 2 + .28, trim, 0, wallTop + .98, 0);
      box(group, L + .4, .36, W + .4, trim, 0, wallTop - .18, 0);
      const flue = new Three.Mesh(new Three.CylinderGeometry(.55, .6, 3.4, 12), trim);
      flue.position.set(L * .24, wallTop + 2.4, -W * .2); flue.castShadow = true; group.add(flue);
    } else if (roofForm === 'split') {
      const halfL = L / 2, riseLow = Math.max(2.6, rise * .82), slopeLow = Math.hypot(halfSpan, riseLow), pitchLow = Math.atan2(riseLow, halfSpan);
      const gLeft = makeGableMesh(W, riseLow); gLeft.rotation.y = -Math.PI / 2; gLeft.position.set(-L / 2 - .02, base + leftWingH, 0); group.add(gLeft);
      const gRight = makeGableMesh(W, rise); gRight.rotation.y = Math.PI / 2; gRight.position.set(L / 2 + .02, wallTop, 0); group.add(gRight);
      for (const side of [-1, 1]) {
        box(group, halfL + overhang, .4, slopeLow, roofMat, -halfL / 2 - overhang / 2 + .2, base + leftWingH + riseLow / 2 - overhang * Math.sin(pitchLow) / 2, side * halfSpan / 2, { rx: side * pitchLow });
        box(group, halfL + overhang + .3, .42, slopeLen, roofMat, halfL / 2 + overhang / 2 - .1, wallTop + rise / 2 - overhang * Math.sin(pitch) / 2, side * halfSpan / 2, { rx: side * pitch });
        box(group, halfL + overhang, .48, .34, trim, -halfL / 2 - overhang / 2 + .2, base + leftWingH - .14, side * (W / 2 + overhang));
        box(group, halfL + overhang + .3, .5, .35, trim, halfL / 2 + overhang / 2 - .1, wallTop - .15, side * (W / 2 + overhang));
      }
      box(group, halfL + overhang + .2, .32, .66, roofMat, -halfL / 2 - overhang / 2 + .2, base + leftWingH + riseLow + .08, 0);
      box(group, halfL + overhang + .4, .35, .7, roofMat, halfL / 2 + overhang / 2 - .1, ridge + .1, 0);
      box(group, 2.3, rise + 2.8, 2.3, brick, L * .28, wallTop + (rise + 2.8) / 2 - 1, -W * .2);
    } else if (roofForm === 'hip' || roofForm === 'hip-low') {
      const hipRun = Math.min(L / 2, W / 2) + overhang;
      const ridgeSpan = Math.max(2, L - W);
      const endSlope = Math.hypot(hipRun, rise), endPitch = Math.atan2(rise, hipRun);
      for (const side of [-1, 1]) {
        box(group, L + overhang * 2 - hipRun * .42, .42, slopeLen, roofMat, 0, wallTop + rise / 2 - overhang * Math.sin(pitch) / 2, side * halfSpan / 2, { rx: side * pitch });
        box(group, L + overhang * 2 + .14, .48, .36, trim, 0, wallTop - .14, side * (W / 2 + overhang));
        box(group, endSlope, .4, W + overhang * 1.35, roofMat, side * (L / 2 + overhang - hipRun / 2), wallTop + rise / 2 - overhang * Math.sin(endPitch) / 2, 0, { rz: -side * endPitch });
        box(group, .36, .48, W + overhang * 2 + .14, trim, side * (L / 2 + overhang), wallTop - .14, 0);
      }
      box(group, ridgeSpan + .6, .36, .75, roofMat, 0, ridge + .08, 0);
      box(group, 2.2, rise + 3, 2.2, brick, L * .22, wallTop + (rise + 3) / 2 - 1, -W * .2);
    } else {
      for (const side of [-1, 1]) {
        const mesh = makeGableMesh(W, rise);
        mesh.rotation.y = side * Math.PI / 2; mesh.position.set(side * (L / 2 + .02), wallTop, 0);
        group.add(mesh);
      }
      for (const side of [-1, 1]) {
        box(group, L + overhang * 2, .42, slopeLen, roofMat, 0, wallTop + rise / 2 - overhang * Math.sin(pitch) / 2, side * halfSpan / 2, { rx: side * pitch });
        box(group, L + overhang * 2 + .1, .52, .35, trim, 0, wallTop - .15, side * (W / 2 + overhang));
      }
      box(group, L + overhang * 2 + .2, .35, .7, roofMat, 0, ridge + .1, 0);
      box(group, 2.3, rise + 3.2, 2.3, brick, L * .26, wallTop + (rise + 3.2) / 2 - 1, -W * .22);
      if (accent === 'rafters') {
        for (let rx = -L / 2 + 1.5; rx <= L / 2 - 1.5; rx += 2.6) {
          for (const side of [-1, 1]) box(group, .26, .34, 1.3, timber, rx, wallTop - .34, side * (W / 2 + overhang * .62), { shadow: false });
        }
      }
      if (roofForm === 'cross-gable') {
        const gw = Math.min(L * .38, 17), gRise = rise * .92, gX = -L * .2, gZ = W / 2 + 1.25;
        box(group, gw, H, 2.5, sidingX, gX, base + H / 2, W / 2 + 1.15);
        const frontGable = makeGableMesh(gw, gRise);
        frontGable.position.set(gX, wallTop, gZ + 1.2); group.add(frontGable);
        const gHalf = gw / 2 + .85, gSlope = Math.hypot(gHalf, gRise), gPitch = Math.atan2(gRise, gHalf);
        for (const side of [-1, 1]) {
          box(group, gSlope, .38, W * .46, roofMat, gX + side * gHalf / 2, wallTop + gRise / 2, W * .35, { rz: -side * gPitch });
        }
        box(group, .62, .34, W * .47, roofMat, gX, wallTop + gRise + .06, W * .35);
        if (accent === 'half-timber') {
          box(group, gw + .16, .42, .22, timber, gX, wallTop + .1, gZ + 1.28);
          for (const tx of [-gw * .26, 0, gw * .26]) {
            const studH = Math.max(1.4, gRise * (1 - Math.abs(tx) / (gw / 2)) - .3);
            box(group, .3, studH, .18, timber, gX + tx, wallTop + studH / 2 + .2, gZ + 1.28, { shadow: false });
          }
          for (const side of [-1, 1]) {
            box(group, .26, gRise * .56, .18, timber, gX + side * gw * .16, wallTop + gRise * .3, gZ + 1.28, { rz: side * .45, shadow: false });
          }
        } else if (accent === 'gingerbread') {
          box(group, .34, 2.2, .34, trim, gX, wallTop + gRise + .9, gZ + 1.24);
          box(group, gw * .52, .3, .22, trim, gX, wallTop + gRise * .56, gZ + 1.26, { shadow: false });
        }
      }
    }

    // Front entry: steps, panel door, surround and warm lantern.
    const doorMat = material(`door-${variantSpec.doorHex}`, variantSpec.doorHex, 'deck', 1, 2, .48);
    box(group, 6.2, .5, 3.6, concrete, 0, .25, W / 2 + 1.7);
    box(group, 5.2, .5, 2.2, concrete, 0, .75, W / 2 + 1);
    box(group, 4.4, 7.6, .32, trim, 0, base + 3.8, W / 2 + .06);
    if (accent === 'pediment' && !variantSpec.porch) {
      box(group, 5.1, .45, .48, trim, 0, base + 7.75, W / 2 + .14);
    }
    box(group, 3.4, 7, .36, doorMat, 0, base + 3.5, W / 2 + .12);
    for (const py of [2.1, 4.9]) for (const px of [-.75, .75]) box(group, 1.05, 1.9, .08, doorMat, px, base + py, W / 2 + .31);
    box(group, 2.5, .95, .08, glass, 0, base + 6.1, W / 2 + .31, { shadow: false });
    box(group, .16, .42, .18, new Three.MeshStandardMaterial({ color: '#d4af37', metalness: .85, roughness: .2 }), 1.25, base + 3.3, W / 2 + .34);
    box(group, .45, .7, .45, new Three.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffbf50', emissiveIntensity: .9 }), -2.9, base + 5.6, W / 2 + .35, { shadow: false });

    // Windows: placed by `windowLayout()` so the count follows Step 3; split-level respects left-wing ceiling height.
    const shutterHex = ['#5d6f7a', '#394246', '#42494d'].includes(variantSpec.sidingHex) ? '#f6f4e8' : '#2e4a3e';
    const shutterMat = material(`shutter-${shutterHex}`, shutterHex, 'deck', 1, 2, .7);
    for (const win of variantSpec.windows) {
      const span = win.face === 'front' || win.face === 'back' ? L : W;
      const offset = (win.along - .5) * (span - 6);
      if (roofForm === 'split' && win.floor > 0 && ((win.face === 'front' || win.face === 'back') && offset < 1.5 || win.face === 'left')) continue;
      const wideFront = accent === 'picture-window' && win.face === 'front' && win.floor === 0 && offset > 4;
      const winW = wideFront ? 5.2 : 3.1, winH = 4.4;
      const g = new Three.Group();
      box(g, winW + .46, winH + .46, .22, trim, 0, 0, 0);
      box(g, winW + .76, .28, .44, trim, 0, -winH / 2 - .22, .1);
      box(g, winW + .08, winH + .08, .26, frame, 0, 0, .03);
      box(g, winW - .36, winH - .36, .16, glass, 0, 0, .1, { shadow: false });
      box(g, winW - .2, .14, .28, frame, 0, 0, .12, { shadow: false });
      box(g, .12, winH - .2, .28, frame, 0, 0, .12, { shadow: false });
      if (variantSpec.shutters && win.face === 'front') {
        for (const side of [-1, 1]) box(g, 1.05, winH + .2, .18, shutterMat, side * (winW / 2 + .78), 0, .08);
      }
      const crossZ = roofForm === 'cross-gable' && win.face === 'front' && Math.abs(offset + L * .2) < Math.min(L * .19, 8.5) ? 2.42 : .05;
      const y = base + win.floor * storyH + storyH * .54;
      if (win.face === 'front') g.position.set(offset, y, W / 2 + crossZ);
      else if (win.face === 'back') { g.position.set(offset, y, -W / 2 - .05); g.rotation.y = Math.PI; }
      else if (win.face === 'left') { g.position.set(-L / 2 - .05, y, offset); g.rotation.y = -Math.PI / 2; }
      else { g.position.set(L / 2 + .05, y, offset); g.rotation.y = Math.PI / 2; }
      group.add(g);
    }

    // Additions: style-specific front / full / wraparound / cantilever porch and roof dormers.
    if (variantSpec.porch) {
      const deckMat = material('deck', '#8b6f4e', 'deck', 5, 2, .85);
      const py = base + Math.min(storyH, leftWingH) - .15;
      if (porchStyle === 'cantilever') {
        const cw = Math.min(L * .38, 16), cd = 6.2;
        box(group, cw, .48, cd, trim, 0, py + .1, W / 2 + cd / 2);
        box(group, cw + .4, .22, cd + .4, roofMat, 0, py + .42, W / 2 + cd / 2);
        for (const sx of [-1, 1]) box(group, .34, py - .45, .34, trim, sx * (cw / 2 - .8), (py + .45) / 2, W / 2 + cd - .7);
      } else {
        const fullSpan = porchStyle === 'full' || porchStyle === 'wraparound';
        const pw = fullSpan ? Math.min(L * .94, L - 1.5) : Math.min(L * .64, 30);
        const pd = 7.5;
        box(group, pw, .55, pd, deckMat, 0, .42, W / 2 + pd / 2);
        box(group, pw + .9, .36, pd + .9, roofMat, 0, py + .6, W / 2 + pd / 2 + .2, { rx: .17 });
        box(group, pw + .6, .38, .35, trim, 0, py, W / 2 + pd);
        if (accent === 'gingerbread') {
          for (let fx = -pw / 2 + 1; fx <= pw / 2 - 1; fx += 1.35) box(group, .16, .68, .16, trim, fx, py - .52, W / 2 + pd - .55, { shadow: false });
        }
        const postXs = fullSpan
          ? [-pw / 2 + .8, -pw / 4, -4.2, 4.2, pw / 4, pw / 2 - .8].filter((x, i, a) => a.findIndex(v => Math.abs(v - x) < 2) === i)
          : [-pw / 2 + .8, -4.2, 4.2, pw / 2 - .8].filter((x, i, a) => a.findIndex(v => Math.abs(v - x) < 1.6) === i);
        for (const x of postXs) {
          if (accent === 'rafters') {
            box(group, 1.32, 2.3, 1.32, brick, x, 1.65, W / 2 + pd - .55);
            box(group, .72, Math.max(2, py - 2.9), .72, trim, x, 2.8 + Math.max(2, py - 2.9) / 2, W / 2 + pd - .55);
          } else {
            box(group, .58, py - .5, .58, trim, x, (py + .5) / 2, W / 2 + pd - .55);
            box(group, .78, .6, .78, trim, x, .9, W / 2 + pd - .55);
          }
        }
        for (const side of [-1, 1]) {
          const span = pw / 2 - 4.8;
          if (span <= 2) continue;
          const cx = side * (4.2 + span / 2 + .3);
          box(group, span, .2, .2, trim, cx, 3.05, W / 2 + pd - .55);
          box(group, span, .18, .18, trim, cx, 1.05, W / 2 + pd - .55);
          for (let bx = -span / 2 + .5; bx <= span / 2 - .5; bx += .95) box(group, .12, 1.9, .12, trim, cx + bx, 2.05, W / 2 + pd - .55);
        }
        if (porchStyle === 'wraparound') {
          const sideLen = W * .78 + pd, sideCenterZ = W / 2 + pd - sideLen / 2;
          box(group, pd, .55, sideLen, deckMat, -L / 2 - pd / 2 + .3, .42, sideCenterZ);
          box(group, pd + .9, .36, sideLen + .6, roofMat, -L / 2 - pd / 2 + .2, py + .58, sideCenterZ, { rz: .17 });
          box(group, .35, .38, sideLen + .4, trim, -L / 2 - pd + .3, py, sideCenterZ);
          for (let sz = W / 2 + pd - .6; sz >= W / 2 + pd - sideLen + 1; sz -= 7.2) {
            box(group, .56, py - .5, .56, trim, -L / 2 - pd + .85, (py + .5) / 2, sz);
          }
          box(group, .2, .2, sideLen - 1.4, trim, -L / 2 - pd + .85, 3.05, sideCenterZ);
          box(group, .18, .18, sideLen - 1.4, trim, -L / 2 - pd + .85, 1.05, sideCenterZ);
        }
      }
    }
    if (variantSpec.dormers && roofForm !== 'flat') {
      const dormerXs = roofForm === 'cross-gable' ? [L * .24] : [-L * .24, L * .24];
      const dormerMat = material(`gable-${variantSpec.sidingHex}-${variantSpec.texture}`, variantSpec.sidingHex, variantSpec.texture, 1, 1);
      dormerMat.side = Three.DoubleSide;
      for (const dx of dormerXs) {
        const g = new Three.Group(); const z = W * .31, y = wallTop + rise * .36;
        g.position.set(dx, y, z); group.add(g);
        box(g, 4.4, 4.6, 4, sidingZ, 0, 0, 0);
        box(g, 3, 3.4, .18, frame, 0, .2, 2.02); box(g, 2.4, 2.8, .14, glass, 0, .2, 2.12, { shadow: false });
        box(g, 3.4, .26, 4.9, roofMat, -1.22, 2.95, 0, { rz: .62 }); box(g, 3.4, .26, 4.9, roofMat, 1.22, 2.95, 0, { rz: -.62 });
        const triangle = new Three.Shape(); triangle.moveTo(-2.2, 0); triangle.lineTo(2.2, 0); triangle.lineTo(0, 1.55); triangle.closePath();
        const face = new Three.Mesh(new Three.ShapeGeometry(triangle), dormerMat);
        face.position.set(0, 2.3, 2.01); face.castShadow = true; g.add(face);
      }
    }

    // Planting: foundation shrubs and two simple shade trees.
    const rand = seeded(42), greens = ['#3f6634', '#4d7a3c', '#35602e'];
    const shrubCount = variantSpec.before ? 3 : Math.max(5, Math.round(L / 7));
    for (let i = 0; i < shrubCount; i++) {
      const x = -L / 2 + 3 + (i * (L - 6)) / Math.max(1, shrubCount - 1) + (rand() - .5) * 1.5;
      if (Math.abs(x) < 3.4) continue;
      const bushZ = W / 2 + 1.7 + rand();
      const bush = new Three.Mesh(new Three.SphereGeometry(1.15 + rand() * .6, 12, 10), material(`bush${i % 3}`, greens[i % 3], null, 1, 1, 1));
      bush.position.set(x, .86, bushZ); bush.scale.y = .72; bush.castShadow = true; group.add(bush);
      for (const [dx, dy, dz, radius] of [[-.56, .16, .06, .69], [.52, .24, -.12, .74], [0, .44, .2, .67]]) {
        const leaf = new Three.Mesh(new Three.SphereGeometry(radius, 10, 8), material(`bush${(i + 1) % 3}`, greens[(i + 1) % 3], null, 1, 1, 1));
        leaf.position.set(x + dx, .68 + dy, bushZ + dz); leaf.scale.y = .8; leaf.castShadow = true; group.add(leaf);
      }
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
    skyBeforeTex ??= makeSkyTexture(true);
    skyAfterTex ??= makeSkyTexture(false);
    scene.background = isBefore ? skyBeforeTex : skyAfterTex;
    scene.fog = new Three.Fog(isBefore ? '#bcc5c9' : '#c8e0cb', 250, 620);
    sun.intensity = isBefore ? 1.7 : 2.95;
    hemi.intensity = isBefore ? .55 : .82;
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
    const effectiveSplit = splitPercent;
    const splitActive = effectiveSplit > 0 && effectiveSplit < 100;
    for (const currentStage of stages) {
      if (splitActive) currentStage.dataset.splitActive = 'true';
      else delete currentStage.dataset.splitActive;
    }
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
    // Crisp architectural split seam + Golden-Ratio (61.8% from bottom / 38.2% from top) handle badge in WebGL scissor space.
    renderer.setScissor(Math.max(0, beforeWidth - 2), 0, 4, height);
    renderer.setClearColor('#89c63f', 1);
    renderer.clearColor();
    renderer.setScissor(Math.max(0, beforeWidth - 1), 0, 2, height);
    renderer.setClearColor('#102303', 1);
    renderer.clearColor();
    const handleY = Math.round(height * 0.618);
    renderer.setScissor(Math.max(0, beforeWidth - 13), Math.max(0, handleY - 13), 26, 26);
    renderer.setClearColor('#102303', 1);
    renderer.clearColor();
    renderer.setScissor(Math.max(0, beforeWidth - 11), Math.max(0, handleY - 11), 22, 22);
    renderer.setClearColor('#89c63f', 1);
    renderer.clearColor();
    renderer.setScissor(Math.max(0, beforeWidth - 2), Math.max(0, handleY - 6), 4, 12);
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
    if (next.before || splitPercent < 100) ensureBeforeHouse();
    scene.add(house);
    const { lengthFt: L, widthFt: W, wallHeightFt: H } = spec;
    fitRadius = Math.max(L, W) * 1.32 + H + 25;
    for (const s of stages) s.dataset.spec = spec.label;
    frameCamera();
    renderScene();
  }

  function frameCamera() {
    if (!camera || !spec) return;
    // Target slightly above Golden Minor wall height and toward the front facade so the house
    // sits on the Rule-of-Thirds lines and the 50/50 split slices cleanly across the front porch.
    const targetY = 1 + spec.wallHeightFt * .44, targetZ = spec.widthFt * .14, r = radius;
    camera.position.set(
      r * Math.cos(elevation) * Math.sin(azimuth),
      targetY + r * Math.sin(elevation),
      targetZ + r * Math.cos(elevation) * Math.cos(azimuth)
    );
    camera.lookAt(0, targetY, targetZ);
  }

  function cancelTransition() {
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = 0; }
  }

  function animateValues(durationMs, stepFn) {
    cancelTransition();
    if (prefersReducedMotion() || !open || !renderer) {
      stepFn(1);
      return;
    }
    const start = performance.now();
    const tick = now => {
      const raw = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - raw, 3);
      stepFn(eased);
      if (raw < 1 && open) animFrame = requestAnimationFrame(tick);
      else animFrame = 0;
    };
    animFrame = requestAnimationFrame(tick);
  }

  function microResponse() {
    if (!open || !renderer) return;
    const startAzimuth = azimuth, startElevation = elevation;
    animateValues(260, t => {
      const pulse = Math.sin(Math.PI * t);
      azimuth = startAzimuth + .014 * pulse;
      elevation = startElevation + .006 * pulse;
      frameCamera();
      renderScene();
    });
  }

  function setView(name) {
    const view = views[name] || views.corner;
    const targetAz = view.azimuth;
    const targetEl = view.elevation;
    const targetRad = fitRadius * (name === 'top' ? 1.15 : 1);
    const startAz = azimuth, startEl = elevation, startRad = radius;
    for (const btn of document.querySelectorAll('[data-remodel-view], [data-step3-view]')) {
      const btnView = btn.dataset.remodelView || btn.dataset.step3View;
      btn.setAttribute('aria-pressed', String(btnView === name));
    }
    animateValues(420, t => {
      azimuth = startAz + (targetAz - startAz) * t;
      elevation = startEl + (targetEl - startEl) * t;
      radius = startRad + (targetRad - startRad) * t;
      frameCamera();
      renderScene();
    });
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
    const clampView = () => { cancelTransition(); elevation = Math.max(.06, Math.min(1.45, elevation)); radius = Math.max(26, Math.min(240, radius)); frameCamera(); renderScene(); };
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
    const splitIsActive = () => splitPercent > 0 && splitPercent < 100;
    const splitSeamX = rect => rect.left + rect.width * (100 - splitPercent) / 100;
    const updateSplitHover = clientX => {
      if (splitPointerId !== null) return;
      const rect = canvas.getBoundingClientRect();
      const near = splitIsActive() && rect.width > 0 && Math.abs(clientX - splitSeamX(rect)) <= 18;
      canvas.classList.toggle('is-split-hit', near);
    };
    const updateSplitFromPointer = event => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      const position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const next = Math.round((1 - position) * 100);
      if (next === splitPercent) return;
      splitPercent = next;
      renderScene();
      onSplitChange?.(splitPercent, { commit: false });
    };
    const endPointer = event => {
      pointers.delete(event.pointerId);
      if (splitPointerId === event.pointerId) {
        splitPointerId = null;
        canvas.classList.remove('is-split-dragging', 'is-split-hit');
        if (activeStage) delete activeStage.dataset.splitDragging;
        onSplitChange?.(splitPercent, { commit: true });
      }
      if (!pointers.size && splitPointerId === null) {
        canvas.classList.remove('is-orbiting');
        if (activeStage) delete activeStage.dataset.interacting;
      }
      updateSplitHover(event.clientX);
    };
    canvas.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      cancelTransition();
      const rect = canvas.getBoundingClientRect();
      const canGrabSplit = !pointers.size && splitPointerId === null && splitIsActive() && rect.width > 0 && Math.abs(event.clientX - splitSeamX(rect)) <= 18;
      if (canGrabSplit) {
        splitPointerId = event.pointerId;
        canvas.classList.remove('is-split-hit', 'is-orbiting');
        canvas.classList.add('is-split-dragging');
        if (activeStage) { activeStage.dataset.splitDragging = 'true'; activeStage.dataset.interacting = 'true'; }
        canvas.setPointerCapture(event.pointerId);
        canvas.focus({ preventScroll: true });
        updateSplitFromPointer(event);
        return;
      }
      pointers.set(event.pointerId, [event.clientX, event.clientY]);
      canvas.classList.add('is-orbiting');
      if (activeStage) activeStage.dataset.interacting = 'true';
      canvas.setPointerCapture(event.pointerId);
      canvas.focus({ preventScroll: true });
    });
    canvas.addEventListener('pointermove', event => {
      if (splitPointerId === event.pointerId) { updateSplitFromPointer(event); return; }
      const old = pointers.get(event.pointerId);
      if (!old) { updateSplitHover(event.clientX); return; }
      canvas.classList.remove('is-split-hit');
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
    canvas.addEventListener('pointerleave', () => {
      if (splitPointerId === null) canvas.classList.remove('is-split-hit');
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, endPointer);
  }

  async function start() {
    Three ??= await import(`${THREE_BASE}three.module.js`);
    renderer = new Three.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = Three.PCFSoftShadowMap;
    renderer.toneMapping = Three.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.06;
    activeStage.append(renderer.domElement);
    scene = new Three.Scene();
    camera = new Three.PerspectiveCamera(40, 1, .5, 1200);
    hemi = new Three.HemisphereLight('#eaf4ff', '#5d7050', .82); scene.add(hemi);
    sun = new Three.DirectionalLight('#fff2d8', 2.95);
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
  function closeView() {
    cancelTransition(); open = false; renderer?.setAnimationLoop(null);
    pointers.clear(); splitPointerId = null;
    renderer?.domElement.classList.remove('is-orbiting', 'is-split-hit', 'is-split-dragging');
    for (const currentStage of stages) { delete currentStage.dataset.interacting; delete currentStage.dataset.splitDragging; }
  }
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
    setSplit(percent, { animate = false } = {}) {
      const target = Math.max(0, Math.min(100, Number(percent) || 0));
      const startVal = splitPercent;
      if (animate && Math.abs(target - startVal) > 4) {
        animateValues(380, t => {
          splitPercent = Math.round(startVal + (target - startVal) * t);
          renderScene();
        });
      } else {
        cancelTransition();
        splitPercent = target;
        renderScene();
      }
    },
    get split() { return splitPercent; },
    refresh({ microResponse: respond = false } = {}) {
      if (renderer && scene) {
        buildHouse(getSpec());
        if (respond) microResponse();
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
