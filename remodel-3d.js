const THREE_BASE = new URL('./vendor/three/', import.meta.url).href;

function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

/** Lighting presets. Each changes the look of the studio only, never the estimate. */
const LIGHTS = Object.freeze({
  day: { sun: '#fff3df', sunI: 2.6, sunPos: [62, 96, 74], hemiSky: '#dbe9f6', hemiGround: '#6f7b59', hemiI: .5, zenith: '#3d7cc0', horizon: '#cfe2ec', exposure: 1, env: .5, glow: 0, shadow: 2 },
  golden: { sun: '#ffd09c', sunI: 2.7, sunPos: [-96, 40, 72], hemiSky: '#fbe3c8', hemiGround: '#6a6f4c', hemiI: .55, zenith: '#5d82b8', horizon: '#f2d3ab', exposure: 1, env: .5, glow: .3, shadow: 2 },
  overcast: { sun: '#eef1f4', sunI: .95, sunPos: [24, 110, 46], hemiSky: '#eef1f3', hemiGround: '#7d8673', hemiI: 1.05, zenith: '#9fabb6', horizon: '#dde2e5', exposure: 1.05, env: .85, glow: 0, shadow: 7 },
  dusk: { sun: '#a8b6ff', sunI: .55, sunPos: [-82, 30, -58], hemiSky: '#61729f', hemiGround: '#2e3527', hemiI: .7, zenith: '#16244a', horizon: '#e39066', exposure: 1.18, env: .35, glow: 1, shadow: 4 }
});

/**
 * Self-hosted Three.js exterior studio. Builds an orbitable house from `houseSpec()` and updates
 * live as the homeowner edits dimensions, materials, colors or additions. Roofs are real planes
 * extruded from each style's cross-section (gable, gambrel, saltbox, clerestory shed) or true hips,
 * with fascia, soffits and gutters, on a lot with a street, walk and driveway. Supports mounting its
 * single WebGL canvas in either the inline Step 3/4 dock (`previewStage`) or the Step 5 studio
 * (`stage`), rendering a real-time Before/After split comparison via WebGL scissor testing, and
 * smoothly easing camera moves and split sweeps when reduced motion is not requested.
 */
/**
 * `welcomeStage` (optional) shows the same house on Step 1 as a floating model: no sky, street or
 * distant ground. `proposalStage` shows the full scene on Step 1 while a design is previewed. A stage
 * marked data-turntable turns slowly until paused, and any stage can set its framing with
 * --frame-shift (moves the house down the view; negative moves it up) and --frame-zoom (smaller).
 */
export function setupRemodel3D({ stage, previewStage = null, welcomeStage = null, proposalStage = null, getSpec, onStatus, onReady, onError, onSplitChange, onOrbitChange }) {
  const stages = [stage, previewStage, welcomeStage, proposalStage].filter(Boolean);
  let activeStage = stage;
  let Three, renderer, scene, camera, sun, hemi, house, beforeHouse, afterHouse, spec, beforeSpec, resizer, observer, starting, pmrem, welcomeLawn;
  let skyBefore, skyAfter, sceneName = '', lights = LIGHTS.day;
  let open = false, splitPercent = 100, splitPointerId = null, animFrame = 0, orbitFrame = 0, mountedMode = null, turntablePaused = false;
  const isWelcome = () => Boolean(welcomeStage) && activeStage === welcomeStage;
  const isTurntable = () => activeStage?.dataset.turntable === 'true';
  const frameVar = name => parseFloat(getComputedStyle(activeStage).getPropertyValue(name)) || 0;
  const views = {
    corner: { azimuth: .62, elevation: .3 },
    front: { azimuth: 0, elevation: .14 },
    side: { azimuth: 1.32, elevation: .17 },
    back: { azimuth: Math.PI - .62, elevation: .3 },
    top: { azimuth: .01, elevation: 1.32, zoom: 1.12 },
    street: { azimuth: .2, elevation: .045, zoom: .8 }
  };
  let azimuth = views.corner.azimuth, elevation = views.corner.elevation, radius = 92, fitRadius = 92;
  const target = { x: 0, y: 10, z: 0 };
  const pointers = new Map();
  const textures = new Map(), materials = new Map(), envMaps = new Map();

  const prefersReducedMotion = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Procedural textures (grayscale unless the finish carries its own color) ----------
  function pattern(kind) {
    if (textures.has(kind)) return textures.get(kind);
    const size = 256, canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const rand = seeded(kind.split('').reduce((n, ch) => n * 33 + ch.charCodeAt(0), 7));
    const fill = (color, x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
    const speckle = (count, alpha, s = 2) => {
      for (let i = 0; i < count; i++) {
        const v = rand() > .5 ? 255 : 0;
        fill(`rgba(${v},${v},${v},${(rand() * alpha).toFixed(3)})`, rand() * size, rand() * size, s, s);
      }
    };
    fill('#ffffff', 0, 0, size, size);
    if (kind === 'glass') {
      const sky = ctx.createLinearGradient(0, 0, size, size);
      sky.addColorStop(0, '#4e7384'); sky.addColorStop(.32, '#b4d3da'); sky.addColorStop(.52, '#e6ece3'); sky.addColorStop(.7, '#7097a4'); sky.addColorStop(1, '#2f5260');
      fill(sky, 0, 0, size, size);
      const sheen = ctx.createLinearGradient(24, 0, 118, size);
      sheen.addColorStop(0, 'rgba(255,255,255,.4)'); sheen.addColorStop(.45, 'rgba(255,255,255,.07)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen; ctx.beginPath(); ctx.moveTo(24, 0); ctx.lineTo(118, 0); ctx.lineTo(44, size); ctx.lineTo(0, size); ctx.closePath(); ctx.fill();
      fill('rgba(16,35,3,.14)', 0, 200, size, 56);
    } else if (kind === 'lap' || kind === 'fiber') {
      const rows = kind === 'lap' ? 10 : 7, step = size / rows;
      for (let i = 0; i < rows; i++) {
        const y = i * step, g = ctx.createLinearGradient(0, y, 0, y + step);
        g.addColorStop(0, '#ffffff'); g.addColorStop(.7, '#f1f1f1'); g.addColorStop(.92, '#d6d6d6'); g.addColorStop(1, '#9c9c9c');
        fill(g, 0, y, size, step);
      }
      speckle(kind === 'fiber' ? 1400 : 420, .05);
    } else if (kind === 'board') {
      for (let x = 0; x < size; x += size / 3) {
        fill('rgba(0,0,0,.22)', x, 0, 3, size); fill('rgba(0,0,0,.08)', x + 3, 0, 3, size);
        fill('rgba(255,255,255,.55)', x + 6, 0, 10, size); fill('rgba(0,0,0,.16)', x + 16, 0, 3, size);
      }
      speckle(1100, .06);
    } else if (kind === 'shingle') {
      for (let row = 0, y = 0; y < size; row++, y += 16) {
        let x = -rand() * 30;
        while (x < size) {
          const w = 18 + rand() * 26, shade = 185 + Math.round(rand() * 70);
          fill(`rgb(${shade},${shade},${shade})`, x, y, w - 2, 15);
          fill('rgba(0,0,0,.18)', x + w - 3, y, 2, 15);
          x += w;
        }
        fill('rgba(0,0,0,.45)', 0, y + 13, size, 3);
      }
      speckle(2600, .16);
    } else if (kind === 'shake') {
      for (let row = 0, y = 0; y < size; row++, y += 21) {
        let x = -rand() * 20;
        while (x < size) {
          const w = 12 + rand() * 30, shade = 165 + Math.round(rand() * 85);
          const g = ctx.createLinearGradient(0, y, 0, y + 21);
          g.addColorStop(0, `rgb(${shade - 30},${shade - 30},${shade - 30})`); g.addColorStop(1, `rgb(${shade},${shade},${shade})`);
          fill(g, x, y, w - 2, 20);
          for (let k = 0; k < 3; k++) fill('rgba(0,0,0,.08)', x + rand() * w, y, 1, 20);
          x += w;
        }
        fill('rgba(0,0,0,.5)', 0, y + 18, size, 3);
      }
      speckle(900, .1);
    } else if (kind === 'metal') {
      fill('#e9e9e9', 0, 0, size, size);
      for (let x = 0; x < size; x += size / 6) {
        fill('rgba(0,0,0,.35)', x, 0, 3, size); fill('rgba(255,255,255,.95)', x + 3, 0, 3, size); fill('rgba(0,0,0,.08)', x + 6, 0, 6, size);
      }
      speckle(260, .03);
    } else if (kind === 'tile') {
      const cols = 8, rows = 8, cw = size / cols, rh = size / rows;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const x = c * cw + (r % 2) * cw / 2, y = r * rh, g = ctx.createLinearGradient(x, 0, x + cw, 0);
        g.addColorStop(0, '#8f8f8f'); g.addColorStop(.35, '#ffffff'); g.addColorStop(.7, '#d0d0d0'); g.addColorStop(1, '#707070');
        for (const dx of [0, -size]) fill(g, x + dx, y, cw, rh);
        fill('rgba(0,0,0,.42)', 0, y + rh - 4, size, 4);
      }
      speckle(700, .08);
    } else if (kind === 'brick' || kind === 'whitewash') {
      const white = kind === 'whitewash';
      fill(white ? '#d9d5cc' : '#b9b2a6', 0, 0, size, size);
      for (let row = 0, y = 0; y < size; row++, y += 14.2) {
        for (let x = (row % 2) * 21 - 21; x < size; x += 42) {
          const d = Math.round((rand() - .5) * (white ? 18 : 46));
          fill(white ? `rgb(${238 + d / 3},${235 + d / 3},${228 + d / 3})` : `rgb(${150 + d},${78 + d / 2},${60 + d / 2})`, x + 1.5, y + 1.5, 39, 11.2);
        }
      }
      speckle(1600, white ? .05 : .12);
    } else if (kind === 'stone') {
      fill('#6e6a62', 0, 0, size, size);
      for (let i = 0; i < 70; i++) {
        const x = rand() * size, y = rand() * size, w = 22 + rand() * 30, h = 14 + rand() * 18, t = rand();
        const c = [[164, 156, 141], [133, 128, 119], [178, 168, 150], [120, 112, 100], [150, 142, 124]][Math.floor(t * 5)];
        ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        for (const [dx, dy] of [[0, 0], [-size, 0], [0, -size], [-size, -size]]) { ctx.beginPath(); ctx.ellipse(x + dx, y + dy, w / 2, h / 2, rand() * .4, 0, Math.PI * 2); ctx.fill(); }
      }
      speckle(1600, .12);
    } else if (kind === 'deck') {
      for (let y = 0; y < size; y += 32) { fill('rgba(0,0,0,.3)', 0, y + 29, size, 3); fill('rgba(90,60,30,.12)', 0, y, size, 12); }
      speckle(400, .08);
    } else if (kind === 'garage') {
      for (let y = 0; y < size; y += 64) {
        fill('rgba(0,0,0,.28)', 0, y + 60, size, 4); fill('rgba(255,255,255,.6)', 0, y, size, 3);
        for (let x = 0; x < size; x += 64) { fill('rgba(0,0,0,.1)', x + 8, y + 10, 48, 3); fill('rgba(0,0,0,.08)', x + 8, y + 46, 48, 3); fill('rgba(0,0,0,.1)', x + 8, y + 10, 3, 39); fill('rgba(255,255,255,.4)', x + 53, y + 10, 3, 39); }
      }
    } else if (kind === 'louver') {
      for (let y = 0; y < size; y += 16) { fill('rgba(0,0,0,.28)', 0, y + 12, size, 4); fill('rgba(255,255,255,.4)', 0, y, size, 3); }
    } else if (kind === 'asphalt') {
      fill('#bdbdbd', 0, 0, size, size); speckle(5200, .22, 1.5);
    } else if (kind === 'grass') {
      speckle(6400, .14, 1.5); for (let i = 0; i < 26; i++) fill(`rgba(${rand() > .5 ? '255,255,190' : '0,40,0'},.025)`, rand() * size, rand() * size, 40 + rand() * 60, 30 + rand() * 50);
    } else speckle(kind === 'concrete' ? 900 : 700, .07);
    const texture = new Three.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = Three.RepeatWrapping; texture.colorSpace = Three.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer?.capabilities.getMaxAnisotropy() || 4);
    textures.set(kind, texture); return texture;
  }
  /** Cached material. `tile` is the texture size in feet; geometry UVs are in feet, so one material fits any wall. */
  function material(key, color, kind = null, { tile = 4, rough = .85, metal = 0, bump = 0, side = Three.DoubleSide, emissive = null, glow = 0 } = {}) {
    if (materials.has(key)) return materials.get(key);
    const options = { color: new Three.Color(color), roughness: rough, metalness: metal, side };
    if (kind) {
      const map = pattern(kind).clone(); map.repeat.set(1 / tile, 1 / tile); map.needsUpdate = true; options.map = map;
      if (bump) { options.bumpMap = map; options.bumpScale = bump; }
    }
    if (emissive) { options.emissive = new Three.Color(emissive); options.emissiveIntensity = glow; }
    const created = new Three.MeshStandardMaterial(options); materials.set(key, created); return created;
  }
  const V = (x, y, z) => new Three.Vector3(x, y, z);
  function add(parent, geometry, mat, shadow = true) {
    const mesh = new Three.Mesh(geometry, mat); mesh.castShadow = shadow; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  /** Box with UVs in feet, so textured walls, decks and paving tile at true scale. */
  function box(parent, w, h, d, mat, x, y, z, { rx = 0, ry = 0, rz = 0, shadow = true } = {}) {
    const geometry = new Three.BoxGeometry(w, h, d), uv = geometry.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]); }
    const mesh = add(parent, geometry, mat, shadow); mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); return mesh;
  }
  function beam(parent, a, b, w, h, mat, shadow = true) {
    const mesh = add(parent, new Three.BoxGeometry(a.distanceTo(b), h, w), mat, shadow);
    mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(V(1, 0, 0), b.clone().sub(a).normalize());
    return mesh;
  }
  function planeBasis(pts) {
    const n = V(0, 0, 0);
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y); }
    n.normalize();
    const u = pts[1].clone().sub(pts[0]); u.addScaledVector(n, -u.dot(n)).normalize();
    return { n, u, v: V(0, 0, 0).crossVectors(n, u) };
  }
  /** Triangulated planar polygon pushed into position/uv arrays, wound to face `facing`. */
  function pushPolygon(pos, uvs, pts, basis, facing) {
    const o = pts[0], flat = pts.map(p => { const d = p.clone().sub(o); return new Three.Vector2(d.dot(basis.u), d.dot(basis.v)); });
    for (const tri of Three.ShapeUtils.triangulateShape(flat, [])) {
      let [a, b, c] = tri;
      const cross = V(0, 0, 0).crossVectors(pts[b].clone().sub(pts[a]), pts[c].clone().sub(pts[a]));
      if (cross.dot(facing) < 0) [b, c] = [c, b];
      for (const i of [a, b, c]) { pos.push(pts[i].x, pts[i].y, pts[i].z); uvs.push(flat[i].x, flat[i].y); }
    }
  }
  function geometryFrom(groups) {
    const pos = [], uvs = [], geometry = new Three.BufferGeometry();
    groups.forEach((build, index) => { const start = pos.length / 3; build(pos, uvs); geometry.addGroup(start, pos.length / 3 - start, index); });
    geometry.setAttribute('position', new Three.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new Three.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
  }
  /** A flat wall or gable panel from any simple polygon. */
  function panel(parent, pts, mat, shadow = true) {
    const basis = planeBasis(pts);
    return add(parent, geometryFrom([(pos, uvs) => pushPolygon(pos, uvs, pts, basis, basis.n)]), mat, shadow);
  }
  /** A roof plane with thickness: covering on top, fascia on the edges, soffit underneath. List the eave edge first. */
  function slab(parent, pts, thickness, top, edge, under) {
    let basis = planeBasis(pts);
    if (basis.n.y < 0) { pts = [pts[1], pts[0], ...pts.slice(2).reverse()]; basis = planeBasis(pts); }
    const low = pts.map(p => p.clone().addScaledVector(basis.n, -thickness));
    const centre = pts.reduce((sum, p) => sum.add(p), V(0, 0, 0)).multiplyScalar(1 / pts.length);
    const geometry = geometryFrom([
      (pos, uvs) => pushPolygon(pos, uvs, pts, basis, basis.n),
      (pos, uvs) => {
        for (let i = 0; i < pts.length; i++) {
          const j = (i + 1) % pts.length, quad = [pts[i], pts[j], low[j], low[i]];
          const out = pts[i].clone().add(pts[j]).multiplyScalar(.5).sub(centre); out.addScaledVector(basis.n, -out.dot(basis.n));
          pushPolygon(pos, uvs, quad, planeBasis(quad), out);
        }
      },
      (pos, uvs) => pushPolygon(pos, uvs, low, basis, basis.n.clone().negate())
    ]);
    return add(parent, geometry, [top, edge, under]);
  }

  // ---------- Architecture ----------
  /** Cross-section (z, y) from the front wall top to the back wall top for the profile-extruded roof forms. */
  function profile(form, W, y0, rise, storyH, stories) {
    if (form === 'gambrel') { const ki = W * .14, yk = y0 + rise * .6; return [[W / 2, y0], [W / 2 - ki, yk], [0, y0 + rise], [-(W / 2 - ki), yk], [-W / 2, y0]]; }
    if (form === 'saltbox') { const zr = W * .14; return [[W / 2, y0], [zr, y0 + rise], [-W / 2, Math.max(y0 - (stories > 1 ? storyH * .9 : 2.5), 4.5)]]; }
    if (form === 'shed-modern') {
      const zr = -W * .1, clere = 2.6, k = rise / (W / 2 - zr);
      return [[W / 2, y0], [zr, y0 + rise], [zr, y0 + rise + clere], [-W / 2, Math.max(y0 + .5, y0 + rise + clere - (W / 2 + zr) * k)]];
    }
    return [[W / 2, y0], [0, y0 + rise], [-W / 2, y0]];
  }
  /** Height of a profile's top line at z, used to seat dormers and chimneys on the roof. */
  function roofY(chain, z) {
    for (let i = 0; i < chain.length - 1; i++) {
      const [z0, y0] = chain[i], [z1, y1] = chain[i + 1];
      if (z0 === z1) continue;
      if ((z - z0) * (z - z1) <= 0) return y0 + (y1 - y0) * (z - z0) / (z1 - z0);
    }
    return chain[0][1];
  }
  /**
   * Extrudes a profile along local x between `x0` and `x1`: end walls, front and back walls and the roof
   * slabs with eave overhang and rake. `caps` chooses which end walls exist and which ends get a rake.
   */
  function prism(g, { x0, x1, chain, base, overhang, rake = overhang, m, caps = [true, true], frontWall = true, backWall = true, gutters = true }) {
    const zf = chain[0][0], zb = chain.at(-1)[0], xa = x0 - (caps[0] ? rake : 0), xb = x1 + (caps[1] ? rake : 0);
    if (frontWall) box(g, x1 - x0, chain[0][1] - base, .5, m.siding, (x0 + x1) / 2, (chain[0][1] + base) / 2, zf - .25);
    if (backWall) box(g, x1 - x0, chain.at(-1)[1] - base, .5, m.siding, (x0 + x1) / 2, (chain.at(-1)[1] + base) / 2, zb + .25);
    const outline = [[zf, base], ...chain, [zb, base]];
    for (const [cap, x] of [[caps[0], x0], [caps[1], x1]]) if (cap) panel(g, outline.map(([z, y]) => V(x, y, z)), m.siding);
    for (const [cap, x, s] of [[caps[0], x0, -1], [caps[1], x1, 1]]) if (cap) {
      for (const z of [zf, zb]) box(g, .55, (z === zf ? chain[0][1] : chain.at(-1)[1]) - base, .55, m.trim, x - s * .2, (base + (z === zf ? chain[0][1] : chain.at(-1)[1])) / 2, z - Math.sign(z) * .2);
    }
    const eaves = [];
    for (let i = 0; i < chain.length - 1; i++) {
      let [za, ya] = chain[i], [zc, yc] = chain[i + 1];
      if (Math.abs(za - zc) < .01) { box(g, x1 - x0, Math.abs(yc - ya), .3, m.glass, (x0 + x1) / 2, (ya + yc) / 2, za, { shadow: false }); for (let x = x0 + 3; x < x1 - 1; x += 4) box(g, .3, Math.abs(yc - ya), .4, m.trim, x, (ya + yc) / 2, za, { shadow: false }); continue; }
      const extend = (p, q, amount) => { const dz = p[0] - q[0], dy = p[1] - q[1], s = amount / Math.abs(dz); return [p[0] + dz * s, p[1] + dy * s]; };
      const prevVertical = i > 0 && Math.abs(chain[i - 1][0] - za) < .01, nextVertical = i < chain.length - 2 && Math.abs(chain[i + 2][0] - zc) < .01;
      const startExt = i === 0 ? overhang : prevVertical && ya > chain[i - 1][1] ? 1 : 0;
      const endExt = i === chain.length - 2 ? overhang : nextVertical && yc > chain[i + 2][1] ? 1 : 0;
      [za, ya] = extend([za, ya], [zc, yc], startExt); [zc, yc] = extend([zc, yc], [za, ya], endExt);
      // Eave edge first so the covering runs along the eave.
      const lowFirst = ya <= yc;
      const [e, r] = lowFirst ? [[za, ya], [zc, yc]] : [[zc, yc], [za, ya]];
      slab(g, [V(xa, e[1], e[0]), V(xb, e[1], e[0]), V(xb, r[1], r[0]), V(xa, r[1], r[0])], .5, m.roof, m.trim, m.soffit);
      if (i === 0) eaves.push([za, ya, 1]);
      if (i === chain.length - 2) eaves.push([zc, yc, -1]);
    }
    // Ridge caps on peaks; gutters along low eaves.
    for (let i = 1; i < chain.length - 1; i++) {
      const [z, y] = chain[i];
      if (y >= chain[i - 1][1] && y >= chain[i + 1][1] && Math.abs(chain[i - 1][0] - z) > .01 && Math.abs(chain[i + 1][0] - z) > .01) box(g, xb - xa + .1, .3, .7, m.ridge, (xa + xb) / 2, y + .08, z);
    }
    for (const [z, y, s] of gutters ? eaves : []) {
      const gutter = add(g, new Three.CylinderGeometry(.24, .24, xb - xa, 10, 1, false, 0, Math.PI), m.trim);
      gutter.rotation.set(0, 0, Math.PI / 2); gutter.position.set((xa + xb) / 2, y - .42, z + s * .12);
    }
    return { eaves };
  }
  function hipRoof(g, { x0, x1, z0, z1, y0, rise, overhang: o, m }) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, alongX = x1 - x0 >= z1 - z0;
    const a = (alongX ? x1 - x0 : z1 - z0) / 2 + o, b = (alongX ? z1 - z0 : x1 - x0) / 2 + o;
    const k = rise / (b - o), ye = y0 - o * k, yr = y0 + rise, r = Math.max(0, a - b);
    const P = (s, t, y) => alongX ? V(cx + s, y, cz + t) : V(cx + t, y, cz + s);
    const planes = r > .05
      ? [[P(-a, b, ye), P(a, b, ye), P(r, 0, yr), P(-r, 0, yr)], [P(a, -b, ye), P(-a, -b, ye), P(-r, 0, yr), P(r, 0, yr)], [P(a, b, ye), P(a, -b, ye), P(r, 0, yr)], [P(-a, -b, ye), P(-a, b, ye), P(-r, 0, yr)]]
      : [[P(-a, b, ye), P(a, b, ye), P(0, 0, yr)], [P(a, -b, ye), P(-a, -b, ye), P(0, 0, yr)], [P(a, b, ye), P(a, -b, ye), P(0, 0, yr)], [P(-a, -b, ye), P(-a, b, ye), P(0, 0, yr)]];
    for (const pts of planes) slab(g, pts, .5, m.roof, m.trim, m.soffit);
    for (const [s, t] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) beam(g, P(s * a, t * b, ye + .2), P(s * r, 0, yr + .15), .5, .26, m.ridge);
    if (r > .05) beam(g, P(-r - .2, 0, yr + .1), P(r + .2, 0, yr + .1), .7, .3, m.ridge);
    for (const t of [-1, 1]) {
      const gutter = add(g, new Three.CylinderGeometry(.24, .24, 2 * a, 10, 1, false, 0, Math.PI), m.trim);
      gutter.position.copy(P(0, t * (b + .12), ye - .42)); gutter.rotation.set(0, alongX ? 0 : Math.PI / 2, Math.PI / 2);
    }
    return { ye, yr, chain: [[z1, y0], [cz, yr], [z0, y0]] };
  }
  function walls(g, { x0, x1, z0, z1, base, top, m }) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, h = top - base, y = base + h / 2;
    box(g, x1 - x0, h, .5, m.siding, cx, y, z1 - .25); box(g, x1 - x0, h, .5, m.siding, cx, y, z0 + .25);
    box(g, .5, h, z1 - z0, m.siding, x0 + .25, y, cz); box(g, .5, h, z1 - z0, m.siding, x1 - .25, y, cz);
    for (const x of [x0, x1]) for (const z of [z0, z1]) box(g, .6, h, .6, m.trim, x + (x === x0 ? .2 : -.2), y, z + (z === z0 ? .2 : -.2));
  }
  function skirt(g, { x0, x1, z0, z1, h, m, sides = [true, true, true, true] }) {
    if (h <= 0) return;
    const y = 1 + h / 2;
    if (sides[0]) box(g, x1 - x0 + .5, h, .3, m.masonry, (x0 + x1) / 2, y, z1 + .1);
    if (sides[1]) box(g, x1 - x0 + .5, h, .3, m.masonry, (x0 + x1) / 2, y, z0 - .1);
    if (sides[2]) box(g, .3, h, z1 - z0 + .5, m.masonry, x0 - .1, y, (z0 + z1) / 2);
    if (sides[3]) box(g, .3, h, z1 - z0 + .5, m.masonry, x1 + .1, y, (z0 + z1) / 2);
    for (const [w, d, x, z] of [[x1 - x0 + .7, .55, (x0 + x1) / 2, z1 + .22], [x1 - x0 + .7, .55, (x0 + x1) / 2, z0 - .22], [.55, z1 - z0 + .7, x0 - .22, (z0 + z1) / 2], [.55, z1 - z0 + .7, x1 + .22, (z0 + z1) / 2]].filter((_, i) => sides[i])) box(g, w, .18, d, m.trim, x, 1 + h + .05, z, { shadow: false });
  }
  /** A gable dormer seated on a front roof slope described by `chain`, running back until the main roof buries it. */
  function gableDormer(g, { x, chain, m, frame, glassMat }) {
    const peak = chain.reduce((best, p) => p[1] > best[1] ? p : best, chain[0]);
    const zf = chain[0][0] - (chain[0][0] - peak[0]) * .3, yb = roofY(chain, zf) - .25, avail = peak[1] - yb;
    const wallH = Math.min(4.3, avail * .52), dRise = Math.min(2.1, avail - wallH - .5);
    if (wallH < 2.6 || dRise < .8) return false;
    const d = new Three.Group(); d.position.set(x, 0, 0); d.rotation.y = -Math.PI / 2; g.add(d);
    const dw = 4.8, top = yb + wallH;
    prism(d, { x0: peak[0] - .4, x1: zf, chain: [[dw / 2, top], [0, top + dRise], [-dw / 2, top]], base: yb, overhang: .45, rake: .45, m, caps: [false, true], gutters: false });
    const win = windowUnit({ w: 2.6, h: Math.min(3.2, wallH - .8), frame, glassMat, m, grid: 'double' });
    win.position.set(x, yb + wallH * .52, zf + .3); g.add(win);
    return true;
  }
  /** A long shed dormer (Dutch Colonial) whose roof climbs gently until it meets the upper slope. */
  function shedDormer(g, { x0, x1, chain, m, frame, glassMat }) {
    const zf = chain[0][0] - 1.2, yb = roofY(chain, zf) - .3, knee = chain[1][1], top = knee + .6;
    let depth = 1;
    while (depth < chain[0][0] && top + depth * .12 > roofY(chain, zf - depth)) depth += .25;
    const yEnd = top + depth * .12, zEnd = zf - depth - .3;
    box(g, x1 - x0, top - yb, .45, m.siding, (x0 + x1) / 2, (top + yb) / 2, zf - .2);
    for (const x of [x0, x1]) panel(g, [V(x, yb, zf), V(x, top, zf), V(x, yEnd, zEnd), V(x, yb - 1, zEnd)], m.siding);
    slab(g, [V(x0 - .5, top, zf + .6), V(x1 + .5, top, zf + .6), V(x1 + .5, yEnd + .2, zEnd), V(x0 - .5, yEnd + .2, zEnd)], .4, m.roof, m.trim, m.soffit);
    const count = Math.max(2, Math.min(4, Math.round((x1 - x0) / 7)));
    for (let i = 0; i < count; i++) {
      const win = windowUnit({ w: 2.8, h: Math.min(3.4, top - yb - 1), frame, glassMat, m, grid: 'double' });
      win.position.set(x0 + (x1 - x0) * (i + .5) / count, (top + yb) / 2 + .1, zf + .12); g.add(win);
    }
  }
  /** Window: casing, frame, glass and a grille that reads as the chosen window product. */
  function windowUnit({ w, h, frame, glassMat, m, grid = 'double', shutters = null }) {
    const g = new Three.Group();
    box(g, w + .9, .42, .3, m.trim, 0, h / 2 + .32, 0); box(g, w + 1.1, .2, .55, m.trim, 0, -h / 2 - .2, .12);
    for (const s of [-1, 1]) box(g, .34, h + .3, .26, m.trim, s * (w / 2 + .3), 0, 0);
    box(g, w + .12, h + .12, .24, frame, 0, 0, .02, { shadow: false });
    box(g, w - .3, h - .3, .1, glassMat, 0, 0, .1, { shadow: false });
    const bar = (bw, bh, x, y) => box(g, bw, bh, .16, frame, x, y, .16, { shadow: false });
    if (grid === 'casement') bar(.16, h - .2, 0, 0);
    else {
      bar(w - .2, .2, 0, 0);
      if (grid === 'colonial') { for (const s of [-1, 1]) bar(.1, h - .3, s * (w - .3) / 6, 0); for (const y of [-h / 4, h / 4]) bar(w - .3, .1, 0, y); }
    }
    if (shutters) for (const s of [-1, 1]) box(g, Math.min(1.25, w * .4), h + .3, .16, shutters, s * (w / 2 + .3 + Math.min(1.25, w * .4) / 2 + .18), 0, .02);
    return g;
  }
  function doorUnit(g, { x, z, base, spec, m, glassMat, light }) {
    const doorMat = material(`door-${spec.doorHex}`, spec.doorHex, 'deck', { tile: 6, rough: .45 });
    const panelMat = material(`door-panel-${spec.doorHex}`, new Three.Color(spec.doorHex).multiplyScalar(.82), null, { rough: .5 });
    const wide = !spec.before && spec.doorProduct === 'wood';
    box(g, wide ? 7.4 : 4.6, 8.1, .32, m.trim, x, base + 4.05, z + .06);
    box(g, wide ? 6.6 : 3.7, .5, .5, m.trim, x, base + 8.15, z + .14);
    box(g, 3.2, 6.9, .3, doorMat, x, base + 3.45, z + .14);
    if (spec.doorProduct === 'fiberglass' && !spec.before) {
      box(g, 2.4, 1.6, .08, glassMat, x, base + 5.6, z + .32, { shadow: false });
      for (const px of [-.62, .62]) box(g, .95, 3.2, .06, panelMat, x + px, base + 2.4, z + .31);
    } else if (wide) {
      for (const s of [-1, 1]) box(g, 1.25, 6.4, .1, glassMat, x + s * 2.55, base + 3.45, z + .22, { shadow: false });
      for (let px = -1.2; px <= 1.21; px += .6) box(g, .07, 6.6, .05, panelMat, x + px, base + 3.45, z + .31);
    } else for (const py of [1.7, 3.8, 5.8]) for (const px of [-.72, .72]) box(g, 1.05, py === 3.8 ? 1.7 : 1.5, .06, panelMat, x + px, base + py, z + .31);
    box(g, .16, .42, .18, material('brass', '#c9a23a', null, { rough: .25, metal: .85 }), x + 1.25, base + 3.3, z + .38, { shadow: false });
    for (const s of wide ? [-1, 1] : [-1]) box(g, .5, .75, .5, light, x + s * (wide ? 4.3 : 2.95), base + 5.8, z + .45, { shadow: false });
  }
  function railing(g, a, b, y, m, mat = m.trim, gaps = []) {
    const len = a.distanceTo(b), dir = b.clone().sub(a).normalize(), count = Math.floor(len / .62);
    const keep = [];
    for (let i = 1; i < count; i++) { const p = a.clone().addScaledVector(dir, i * len / count); if (!gaps.some(([g0, g1]) => (dir.x ? p.x : p.z) > g0 && (dir.x ? p.x : p.z) < g1)) keep.push(p); }
    const segments = [[a, b]];
    for (const [g0, g1] of gaps) {
      const s = segments.pop(), key = dir.x ? 'x' : 'z';
      const left = s[0].clone(), right = s[1].clone(), mid1 = left.clone(), mid2 = left.clone();
      mid1[key] = Math.min(g0, g1); mid2[key] = Math.max(g0, g1);
      if (dir[key] < 0) segments.push([left, mid2], [mid1, right]); else segments.push([left, mid1], [mid2, right]);
    }
    for (const [p, q] of segments) if (p.distanceTo(q) > .5) {
      beam(g, p.clone().setY(y + 3.05), q.clone().setY(y + 3.05), .3, .22, mat);
      beam(g, p.clone().setY(y + .45), q.clone().setY(y + .45), .2, .16, mat, false);
    }
    if (!keep.length) return;
    const spindles = new Three.InstancedMesh(new Three.BoxGeometry(.14, 2.5, .14), mat, keep.length);
    const mx = new Three.Matrix4();
    keep.forEach((p, i) => spindles.setMatrixAt(i, mx.makeTranslation(p.x, y + 1.75, p.z)));
    spindles.castShadow = true; g.add(spindles);
  }
  function column(g, x, z, y0, y1, m, { style = 'square', mat = m.trim } = {}) {
    const h = y1 - y0;
    if (style === 'round') { const c = add(g, new Three.CylinderGeometry(.36, .44, h, 16), mat); c.position.set(x, y0 + h / 2, z); box(g, 1.1, .3, 1.1, mat, x, y1 - .15, z); box(g, 1.1, .3, 1.1, mat, x, y0 + .15, z); }
    else if (style === 'craftsman') { box(g, 1.5, 2.6, 1.5, m.masonry, x, y0 + 1.3, z); const c = add(g, new Three.CylinderGeometry(.4, .62, h - 2.6, 4), mat); c.rotation.y = Math.PI / 4; c.position.set(x, y0 + 2.6 + (h - 2.6) / 2, z); }
    else if (style === 'steel') box(g, .3, h, .3, mat, x, y0 + h / 2, z);
    else { box(g, .6, h, .6, mat, x, y0 + h / 2, z); box(g, .85, .5, .85, mat, x, y0 + .25, z); box(g, .85, .35, .85, mat, x, y1 - .2, z); }
  }
  function porch(g, ctx) {
    const { spec, L, W, base, storyH, frontEave, front2, m } = ctx;
    const style = spec.porchStyle || 'portico', accent = spec.accent || '';
    const deckY = base + .1, py = base + storyH - .35;
    const wallTop = Math.min(front2 - .5, frontEave - .3, py + 2), postStyle = accent === 'rafters' ? 'craftsman' : accent === 'gingerbread' ? 'square' : ['modern-fascia', 'parapet', 'banded', 'black-frames'].includes(accent) ? 'steel' : 'square';
    if (style === 'portico') {
      const pw = 9.6, pd = 6.2, zf = W / 2 + pd, beamY = base + Math.min(storyH, 9.4);
      box(g, pw + 1, .5, pd + .8, m.concrete, 0, .5, W / 2 + pd / 2 + .2);
      const p = new Three.Group(); p.rotation.y = -Math.PI / 2; g.add(p);
      prism(p, { x0: W / 2 - .4, x1: zf, chain: [[pw / 2, beamY + .9], [0, beamY + 4], [-pw / 2, beamY + .9]], base: beamY, overhang: .5, rake: .55, m: { ...m, siding: m.trim }, caps: [false, true], frontWall: false, backWall: false, gutters: false });
      box(g, pw + .2, .9, pd, m.trim, 0, beamY + .45, W / 2 + pd / 2);
      for (const s of [-1, 1]) { column(g, s * (pw / 2 - .7), zf - .7, deckY + .65, beamY, m, { style: 'round' }); box(g, .8, beamY - base, .3, m.trim, s * (pw / 2 - .7), (beamY + base) / 2, W / 2 + .2); }
      return;
    }
    if (style === 'cantilever') {
      const cw = Math.min(L * .4, 17), cd = 6.5, y = Math.min(py + .4, frontEave - .4);
      slab(g, [V(-cw / 2, y, W / 2 + cd), V(cw / 2, y, W / 2 + cd), V(cw / 2, y + .15, W / 2), V(-cw / 2, y + .15, W / 2)], .6, m.roof, m.trim, m.soffit);
      for (const s of [-1, 1]) column(g, s * (cw / 2 - .8), W / 2 + cd - .7, base, y - .6, m, { style: 'steel' });
      box(g, cw + 1, .35, cd + 1, m.concrete, 0, .35, W / 2 + cd / 2);
      return;
    }
    const full = style === 'full' || style === 'wraparound';
    let x0 = full ? -L / 2 + .2 : -Math.min(L * .3, 13), x1 = full ? L / 2 - .2 : -x0;
    if (ctx.turret) x1 = Math.min(x1, ctx.turret.x - ctx.turret.r - .6);
    const pd = 7.5, zf = W / 2 + pd, deck = material('deck', '#8b6f4e', 'deck', { tile: 5 });
    box(g, x1 - x0, .7, pd, deck, (x0 + x1) / 2, deckY + .3, W / 2 + pd / 2);
    box(g, x1 - x0 + .2, .9, .25, m.trim, (x0 + x1) / 2, deckY + .1, zf + .05);
    const eaveY = Math.min(py, wallTop - .9);
    slab(g, [V(x0 - .6, eaveY, zf + .7), V(x1 + .6, eaveY, zf + .7), V(x1 + .6, wallTop, W / 2), V(x0 - .6, wallTop, W / 2)], .45, m.roof, m.trim, m.soffit);
    box(g, x1 - x0 + .4, .75, .45, m.trim, (x0 + x1) / 2, eaveY - .45, zf - .35);
    const posts = [];
    const n = Math.max(2, Math.round((x1 - x0) / 9));
    for (let i = 0; i <= n; i++) posts.push(x0 + .6 + (x1 - x0 - 1.2) * i / n);
    if (!posts.some(x => Math.abs(x + 3.4) < 1.5)) posts.push(-3.4, 3.4);
    const kept = posts.filter(x => x < x1 - .3 && x > x0 + .3 && !(Math.abs(x) < 2.6)).sort((a, b) => a - b);
    for (const x of kept) column(g, x, zf - .55, deckY + .65, eaveY - .8, m, { style: postStyle, mat: postStyle === 'steel' ? m.timber : m.trim });
    railing(g, V(x0 + .6, 0, zf - .55), V(x1 - .6, 0, zf - .55), deckY + .65, m, m.trim, [[-2.6, 2.6]]);
    if (accent === 'gingerbread') {
      const spindles = new Three.InstancedMesh(new Three.BoxGeometry(.1, .8, .1), m.trim, Math.floor((x1 - x0) / .55));
      const mx = new Three.Matrix4();
      for (let i = 0; i < spindles.count; i++) spindles.setMatrixAt(i, mx.makeTranslation(x0 + .3 + i * .55, eaveY - 1.25, zf - .55));
      g.add(spindles);
    }
    box(g, 5.6, .45, 2.6, m.concrete, 0, .3, zf + 1.1);
    if (style === 'wraparound') {
      const sz0 = -W * .2, xs = -L / 2 - pd;
      box(g, pd, .7, W / 2 - sz0 + pd, deck, -L / 2 - pd / 2, deckY + .3, (W / 2 + pd + sz0) / 2);
      slab(g, [V(xs - .7, eaveY, sz0 - .6), V(xs - .7, eaveY, zf + .7), V(-L / 2, wallTop, zf + .7), V(-L / 2, wallTop, sz0 - .6)], .45, m.roof, m.trim, m.soffit);
      for (let z = zf - .55; z > sz0; z -= 8.5) column(g, xs + .55, z, deckY + .65, eaveY - .8, m, { style: postStyle, mat: postStyle === 'steel' ? m.timber : m.trim });
      column(g, xs + .55, sz0 + .5, deckY + .65, eaveY - .8, m, { style: postStyle, mat: postStyle === 'steel' ? m.timber : m.trim });
      railing(g, V(xs + .55, 0, zf - .55), V(xs + .55, 0, sz0 + .5), deckY + .65, m);
    }
  }
  function garage(g, { L, W, base, rise, m, spec, glassMat }) {
    const gw = 22, gd = Math.min(24, W), x0 = L / 2 - .2, x1 = x0 + gw, z1 = W / 2 - 3, z0 = z1 - gd, wallTop = base + 9.5;
    walls(g, { x0, x1, z0, z1, base, top: wallTop, m });
    const p = new Three.Group(); p.position.set((x0 + x1) / 2, 0, 0); p.rotation.y = -Math.PI / 2; g.add(p);
    prism(p, { x0: z0, x1: z1, chain: [[gw / 2, wallTop], [0, wallTop + Math.min(rise, 6.5)], [-gw / 2, wallTop]], base: wallTop - .01, overhang: 1.1, rake: 1.1, m, caps: [true, true], frontWall: false, backWall: false });
    const doorMat = material(`garage-${spec.trimHex}`, spec.trimHex === '#26282a' || spec.trimHex === '#2f3437' ? '#3a3d40' : '#f2f1ec', 'garage', { tile: 8, rough: .55 });
    box(g, 16.8, 8.3, .3, m.trim, (x0 + x1) / 2, base + 4.1, z1 + .08);
    box(g, 16, 7.6, .3, doorMat, (x0 + x1) / 2, base + 3.8, z1 + .16);
    for (let i = 0; i < 4; i++) box(g, 3.3, .9, .1, glassMat, (x0 + x1) / 2 - 5.85 + i * 3.9, base + 6.6, z1 + .33, { shadow: false });
    return { x0, x1, z1 };
  }
  function turret(g, { x, z, base, H, m, spec, frame, glassMat, storyH }) {
    const r = 4.4, h = H + 3, body = add(g, new Three.CylinderGeometry(r, r, h, 8), m.siding);
    body.position.set(x, base + h / 2, z); body.rotation.y = Math.PI / 8;
    const cone = add(g, new Three.ConeGeometry(r + 1, 11, 8), m.roof); cone.position.set(x, base + h + 5.5, z); cone.rotation.y = Math.PI / 8;
    box(g, .35, 2.2, .35, m.trim, x, base + h + 11.6, z);
    const band = add(g, new Three.CylinderGeometry(r + .25, r + .25, .5, 8), m.trim); band.position.set(x, base + h, z); band.rotation.y = Math.PI / 8;
    for (let f = 0; f < Math.round(H / storyH); f++) for (const a of [0, Math.PI / 4, Math.PI / 2]) {
      const win = windowUnit({ w: 2.4, h: Math.min(4.2, storyH * .48), frame, glassMat, m, grid: spec.windowProduct === 'fiberglass' ? 'casement' : 'double' });
      const d = r * Math.cos(Math.PI / 8) + .05;
      win.position.set(x + Math.sin(a) * d, base + f * storyH + storyH * .55, z + Math.cos(a) * d); win.rotation.y = a; g.add(win);
    }
    return { x, z, r };
  }
  function tree(g, x, z, s, crownMat, trunkMat, kind = 'leafy') {
    const trunk = add(g, new Three.CylinderGeometry(.35 * s, .55 * s, (kind === 'leafy' ? 7 : 4) * s, 7), trunkMat);
    trunk.position.set(x, (kind === 'leafy' ? 3.5 : 2) * s, z);
    if (kind === 'conifer') {
      for (const [y, r, h] of [[5, 4.2, 7], [8.5, 3.3, 6], [11.5, 2.3, 5]]) { const c = add(g, new Three.ConeGeometry(r * s, h * s, 9), crownMat); c.position.set(x, y * s, z); }
      return;
    }
    const rand = seeded(Math.round(x * 13 + z * 7));
    for (const [ox, oy, oz, r] of [[0, 9.2, 0, 4], [-2.4, 7.6, .9, 2.9], [2.3, 7.9, -.7, 3.1], [.4, 7.4, 2.3, 2.6], [-.6, 11.3, -.4, 2.6]]) {
      const c = add(g, new Three.IcosahedronGeometry(r * s, 1), crownMat);
      c.position.set(x + ox * s, oy * s, z + oz * s); c.rotation.set(rand() * 3, rand() * 3, 0); c.scale.set(1, .86 + rand() * .2, 1);
    }
  }
  function site(g, ctx) {
    const { spec, L, W, m, drive } = ctx, before = spec.before;
    const S = 30, walkZ1 = W / 2 + S, curbZ = walkZ1 + 9.5, lot = Math.max(L, W) * 3.5 + 140;
    const far = mesh => { mesh.userData.far = true; return mesh; };
    const lawn = far(add(g, new Three.CircleGeometry(1400, 64), material(`lawn-${before ? 'b' : 'a'}`, before ? '#7d8656' : '#66884c', 'grass', { tile: 16, rough: 1, side: Three.FrontSide }), false));
    lawn.rotation.x = -Math.PI / 2;
    const uv = lawn.geometry.attributes.uv, p = lawn.geometry.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i), p.getY(i));
    const asphalt = material('asphalt', '#55585a', 'asphalt', { tile: 10, rough: .95 });
    far(box(g, lot * 2, .1, 30, asphalt, 0, .05, curbZ + 15.3, { shadow: false }));
    far(box(g, lot * 2, .5, .6, m.concrete, 0, .25, curbZ + .3, { shadow: false }));
    far(box(g, lot * 2, .14, 5, m.concrete, 0, .07, walkZ1 + 2.5, { shadow: false }));
    for (let x = -lot; x < lot; x += 5) far(box(g, .06, .02, 5, m.joint, x, .15, walkZ1 + 2.5, { shadow: false }));
    // Front walk from the steps to the sidewalk.
    const walkLen = S - 1.2;
    box(g, 4.4, .14, walkLen, m.concrete, 0, .08, W / 2 + 1.2 + walkLen / 2, { shadow: false });
    for (let z = W / 2 + 5; z < walkZ1; z += 4.4) box(g, 4.3, .02, .06, m.joint, 0, .16, z, { shadow: false });
    // Driveway: to the garage door when there is one, otherwise beside the house.
    const dx = drive ? (drive.x0 + drive.x1) / 2 : L / 2 + 9, dw = drive ? 18 : 11, dz0 = drive ? drive.z1 : -W / 2 + 4;
    far(box(g, dw, .12, curbZ - dz0 + 1, material('drive', '#b2b0a8', 'concrete', { tile: 8, rough: .92 }), dx, .06, (dz0 + curbZ) / 2 + .5, { shadow: false }));
    for (let z = dz0 + 10; z < curbZ; z += 10) far(box(g, dw - .1, .02, .07, m.joint, dx, .13, z, { shadow: false }));
    // Foundation beds and shrubs (fuller in After).
    const mulch = material('mulch', '#4a3a2b', 'grass', { tile: 4, rough: 1 }), greens = ['#3e6633', '#4b7a3a', '#33602c'];
    const bedW = Math.max(4, L / 2 - 4);
    for (const s of [-1, 1]) box(g, bedW, .1, 3.6, mulch, s * (bedW / 2 + 3), .05, W / 2 + 2, { shadow: false });
    const shrubs = before ? 4 : Math.max(6, Math.round(L / 5)), rand = seeded(42);
    for (let i = 0; i < shrubs; i++) {
      const x = -L / 2 + 2.5 + (i * (L - 5)) / Math.max(1, shrubs - 1);
      if (Math.abs(x) < 3.6) continue;
      const bush = add(g, new Three.IcosahedronGeometry(1.1 + rand() * .5, 1), material(`bush${i % 3}`, greens[i % 3], null, { rough: 1 }));
      bush.position.set(x, .9, W / 2 + 2 + rand() * .6); bush.scale.y = .8;
      if (!before && i % 2) { const bloom = add(g, new Three.IcosahedronGeometry(.55, 0), material(`bloom${i % 4}`, ['#d9667a', '#f2c14e', '#f4f1ea', '#b27ac9'][i % 4], null, { rough: .9 }), false); bloom.position.set(x + .9, .6, W / 2 + 3.3); }
    }
    const crown = material(`crown-${before ? 'b' : 'a'}`, before ? '#5f7547' : '#47793a', null, { rough: 1, side: Three.FrontSide });
    const pine = material('pine', '#2f5532', null, { rough: 1, side: Three.FrontSide }), trunk = material('trunk', '#6b4e35', null, { rough: .95 });
    tree(g, -L / 2 - 14, W / 2 + 14, 1, crown, trunk); tree(g, L / 2 + (drive ? 34 : 20), W / 2 + 18, .8, crown, trunk);
    tree(g, -L / 2 - 12, -W / 2 - 12, 1.15, pine, trunk, 'conifer'); tree(g, L / 2 + 10, -W / 2 - 20, 1, pine, trunk, 'conifer'); tree(g, -6, -W / 2 - 30, 1.3, crown, trunk);
    // A distant tree line gives the horizon depth; fog fades it into the sky.
    const ring = new Three.InstancedMesh(new Three.IcosahedronGeometry(1, 1), material('treeline', '#4a7342', null, { rough: 1, side: Three.FrontSide }), 120);
    const mx = new Three.Matrix4(), rr = seeded(7);
    for (let i = 0; i < ring.count; i++) {
      const a = (i / ring.count) * Math.PI * 2, d = 520 + rr() * 260, s = 12 + rr() * 12;
      mx.makeScale(s, s * (1.1 + rr() * .6), s).setPosition(Math.cos(a) * d, s * .8, Math.sin(a) * d);
      ring.setMatrixAt(i, mx);
    }
    g.add(far(ring));
    if (spec.fence) {
      const fz = walkZ1 - 1.4, span = Math.max(L, W) + 40, gaps = [[-2.8, 2.8], [dx - dw / 2 - .6, dx + dw / 2 + .6]];
      const xs = [];
      for (let x = -span; x <= span; x += .5) if (!gaps.some(([a, b]) => x > a && x < b)) xs.push(x);
      const picket = new Three.InstancedMesh(new Three.BoxGeometry(.3, 3.2, .1), m.fence, xs.length);
      xs.forEach((x, i) => picket.setMatrixAt(i, mx.makeTranslation(x, 1.6, fz)));
      picket.castShadow = true; g.add(picket);
      for (const [a, b] of [[-span, gaps[0][0]], [gaps[0][1], gaps[1][0]], [gaps[1][1], span]]) if (b > a) for (const y of [.9, 2.5]) box(g, b - a, .3, .14, m.fence, (a + b) / 2, y, fz - .12);
    }
  }

  /** panel() faces along its winding's normal; flip the winding when that faces the given inside point. */
  function panelOut(parent, pts, mat, inside) {
    const basis = planeBasis(pts);
    const c = pts.reduce((s, p) => s.add(p), V(0, 0, 0)).multiplyScalar(1 / pts.length);
    if (basis.n.dot(c.clone().sub(inside)) < 0) pts = [...pts].reverse();
    return panel(parent, pts, mat);
  }
  /** The measured plan's usable edges, each with its outward normal (pointing away from the centre). */
  function outlineEdges(spec) {
    const pts = spec.outline.points, edges = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 2.5) continue;
      let nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
      edges.push({ a, b, len, mx, mz, nx, nz });
    }
    return edges;
  }
  function edgeSide(e, spec) {
    const nx = e.mx / (spec.outline.lengthFt / 2), nz = e.mz / (spec.outline.widthFt / 2);
    return Math.abs(nz) >= Math.abs(nx) ? (nz > 0 ? 'front' : 'back') : (nx > 0 ? 'right' : 'left');
  }
  const planArea = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length]; a += x1 * z2 - x2 * z1; } return a / 2; };
  const pointInPlan = (pts, x, z) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, zi] = pts[i], [xj, zj] = pts[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  const pointOnPlanEdge = (pts, x, z, tol = .1) => {
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
      const dx = x2 - x1, dz = z2 - z1, len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / len2));
      if (Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t)) <= tol) return true;
    }
    return false;
  };
  /**
   * An axis-aligned L plan (a hexagon with one reflex corner) splits into two rectangles at
   * that corner: a full-length strip and a full-depth strip. Roofing each strip with its own
   * gable gives the cross-gable real L-shaped houses wear, instead of one roof floating over
   * the notch. Returns the two bars, or null for any other plan shape.
   */
  function decomposeL(pts) {
    if (pts.length !== 6) return null;
    for (let i = 0; i < 6; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % 6];
      if (Math.abs(x2 - x1) > .35 && Math.abs(z2 - z1) > .35) return null;
    }
    const crosses = pts.map((p, i) => {
      const a = pts[(i + 5) % 6], b = pts[(i + 1) % 6];
      return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]);
    });
    const majority = crosses.filter(c => c > 0).length >= 3 ? 1 : -1;
    const reflex = crosses.findIndex(c => Math.sign(c) !== majority && Math.abs(c) > .01);
    if (reflex < 0) return null;
    const [rx, rz] = pts[reflex];
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const area = Math.abs(planArea(pts));
    const rect = (ax0, ax1, az0, az1) => ({ x0: ax0, x1: ax1, z0: az0, z1: az1 });
    const combos = [
      [rect(x0, x1, z0, rz), rect(rx, x1, z0, z1)], [rect(x0, x1, z0, rz), rect(x0, rx, z0, z1)],
      [rect(x0, x1, rz, z1), rect(rx, x1, z0, z1)], [rect(x0, x1, rz, z1), rect(x0, rx, z0, z1)]
    ];
    for (const [a, b] of combos) {
      const overlap = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));
      const union = (a.x1 - a.x0) * (a.z1 - a.z0) + (b.x1 - b.x0) * (b.z1 - b.z0) - overlap;
      if (Math.abs(union - area) > Math.max(2, area * .02)) continue;
      const inside = r => [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1], [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2]]
        .every(([x, z]) => pointInPlan(pts, x, z) || pointOnPlanEdge(pts, x, z));
      if (!inside(a) || !inside(b)) continue;
      const bars = [a, b].map(r => {
        const sx = r.x1 - r.x0, sz = r.z1 - r.z0, alongX = sx >= sz;
        return { cx: (r.x0 + r.x1) / 2, cz: (r.z0 + r.z1) / 2, len: Math.max(sx, sz), wid: Math.min(sx, sz), alongX };
      });
      if (bars.some(bar => bar.wid < 6 || bar.len < 8)) return null;
      return bars;
    }
    return null;
  }
  /**
   * The measured shell: walls on the real footprint plan; the roof follows the plan too — a
   * cross-gable over the two bars of an L plan, otherwise one plain gable over the containing
   * rectangle at the measured rise, with gable infill fitted to the plan's actual ends.
   * Returns the roof chain plus a chimney anchor seated on the primary roof bar.
   */
  function measuredBody(building, { spec, m, base, y0, rise, storyH, overhang }) {
    const pts = spec.outline.points, oL = spec.outline.lengthFt, oW = spec.outline.widthFt;
    panelOut(building, pts.map(([x, z]) => V(x, base + .14, z)), m.concrete, V(0, base - 1, 0));
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
      if (Math.hypot(x2 - x1, z2 - z1) < .5) continue;
      panelOut(building, [V(x1, base, z1), V(x2, base, z2), V(x2, y0, z2), V(x1, y0, z1)], m.siding, V(0, (base + y0) / 2, 0));
    }
    const chain = profile('gable', oW, y0, rise, storyH, spec.stories);
    const bars = decomposeL(pts);
    if (!bars) {
      prism(building, { x0: -oL / 2, x1: oL / 2, chain, base, overhang, m, caps: [false, false], frontWall: false, backWall: false });
      for (const s of [-1, 1]) {
        const end = pts.filter(([x]) => Math.abs(x - s * oL / 2) < 2.5).map(([, z]) => z);
        const zs = end.length ? end : [-oW / 2, oW / 2];
        panelOut(building, [V(s * oL / 2, y0, Math.min(...zs)), V(s * oL / 2, y0 + rise, 0), V(s * oL / 2, y0, Math.max(...zs))], m.siding, V(0, y0, 0));
      }
      return { chain, chimney: { x: oL * .27, z: -1.8, ridgeY: y0 + rise } };
    }
    const slope = rise / (oW / 2);
    let primary = null;
    for (const bar of bars) {
      const barRise = slope * bar.wid / 2, barChain = profile('gable', bar.wid, y0, barRise, storyH, spec.stories);
      if (bar.alongX) {
        prism(building, { x0: bar.cx - bar.len / 2, x1: bar.cx + bar.len / 2, chain: barChain.map(([z, y]) => [z + bar.cz, y]), base, overhang, m, caps: [false, false], frontWall: false, backWall: false });
      } else {
        const sub = new Three.Group();
        sub.position.set(bar.cx, 0, bar.cz); sub.rotation.y = Math.PI / 2; building.add(sub);
        prism(sub, { x0: -bar.len / 2, x1: bar.len / 2, chain: barChain, base, overhang, m, caps: [false, false], frontWall: false, backWall: false });
      }
      for (const s of [-1, 1]) {
        const corners = bar.alongX
          ? [[bar.cx + s * bar.len / 2, bar.cz - bar.wid / 2], [bar.cx + s * bar.len / 2, bar.cz + bar.wid / 2]]
          : [[bar.cx - bar.wid / 2, bar.cz + s * bar.len / 2], [bar.cx + bar.wid / 2, bar.cz + s * bar.len / 2]];
        if (!corners.every(([x, z]) => pointOnPlanEdge(pts, x, z))) continue;
        if (bar.alongX) {
          const x = bar.cx + s * bar.len / 2;
          panelOut(building, [V(x, y0, bar.cz - bar.wid / 2), V(x, y0 + barRise, bar.cz), V(x, y0, bar.cz + bar.wid / 2)], m.siding, V(bar.cx, y0, bar.cz));
        } else {
          const z = bar.cz + s * bar.len / 2;
          panelOut(building, [V(bar.cx - bar.wid / 2, y0, z), V(bar.cx, y0 + barRise, z), V(bar.cx + bar.wid / 2, y0, z)], m.siding, V(bar.cx, y0, bar.cz));
        }
      }
      if (!primary || bar.len * bar.wid > primary.len * primary.wid) primary = { ...bar, barRise };
    }
    const off = spec.accent === 'center-chimney' ? 0 : primary.len * .27;
    const chimney = primary.alongX
      ? { x: primary.cx + off, z: primary.cz - 1.8, ridgeY: y0 + primary.barRise }
      : { x: primary.cx - 1.8, z: primary.cz + off, ridgeY: y0 + primary.barRise };
    return { chain, chimney };
  }
  /** Windows redistributed onto the plan's real edges, longest edge per face and floor. */
  function measuredOpenings(building, { spec, m, frame, base, y0, storyH, grid, shutterMat }) {
    const edges = outlineEdges(spec);
    const groups = new Map();
    for (const win of spec.windows) {
      const key = `${win.face}|${win.floor}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(win);
    }
    for (const [key, wins] of groups) {
      const [face, floorRaw] = key.split('|'), floor = Number(floorRaw);
      const candidates = edges.filter(e => edgeSide(e, spec) === face).sort((a, b) => b.len - a.len);
      if (!candidates.length) continue;
      const e = candidates[0];
      const winH = Math.min(4.6, storyH * .5), y = base + floor * storyH + storyH * .55;
      if (y + winH / 2 > y0 - .6) continue;
      wins.forEach((win, i) => {
        const t = Math.min(1, Math.max(0, (1.5 + (i + .5) / wins.length * (e.len - 3)) / e.len));
        const u = windowUnit({ w: 3, h: winH, frame, glassMat: m.glass, m, grid, shutters: face !== 'back' ? shutterMat : null });
        u.position.set(e.a[0] + (e.b[0] - e.a[0]) * t + e.nx * .08, y, e.a[1] + (e.b[1] - e.a[1]) * t + e.nz * .08);
        u.rotation.y = Math.atan2(e.nx, e.nz);
        building.add(u);
      });
    }
  }
  /** The entry door on the plan's longest front edge, turned to face out of that edge. */
  function measuredEntry(building, { spec, m, base, glassMat, lamp, light }) {
    const front = outlineEdges(spec).filter(e => edgeSide(e, spec) === 'front').sort((a, b) => b.len - a.len)[0];
    if (!front) return;
    const sub = new Three.Group();
    sub.position.set(front.mx, 0, front.mz);
    sub.rotation.y = Math.atan2(front.nx, front.nz);
    building.add(sub);
    box(sub, 6.4, .5, 3.4, m.concrete, 0, .25, 1.7);
    box(sub, 5.4, .5, 2, m.concrete, 0, .75, 1);
    doorUnit(sub, { x: 0, z: 0, base, spec, m, glassMat, light: lamp });
    if (light.glow > .5) { const p = new Three.PointLight('#ffc070', 22 * light.glow, 22, 1.6); p.position.set(0, base + 7, 3); sub.add(p); }
  }

  function buildVariant(variantSpec) {
    const group = new Three.Group(), building = new Three.Group(); group.add(building);
    const { lengthFt: L, widthFt: W, wallHeightFt: H, gableRiseFt: rise, storyHeightFt: storyH, stories } = variantSpec;
    const form = variantSpec.roofForm || 'gable', accent = variantSpec.accent || '', before = variantSpec.before;
    const overhang = variantSpec.overhangFt || 1.35, base = 1, y0 = base + H;
    const light = LIGHTS[variantSpec.scene] || LIGHTS.day;
    const trimHex = variantSpec.trimHex || '#f6f4e8', dark = new Three.Color(trimHex).getHSL({}).l < .3;
    const roofKind = variantSpec.roofMaterial || 'shingle';
    const roofTile = { shingle: 8, shake: 8, metal: 8, tile: 6 }[roofKind] || 8;
    const masonryKind = variantSpec.masonry === 'stone' ? 'stone' : variantSpec.masonry === 'whitewash' ? 'whitewash' : 'brick';
    const frameHex = accent === 'black-frames' && !before && variantSpec.windowProduct !== 'wood' ? '#26282a' : variantSpec.frameHex;
    const m = {
      siding: material(`siding-${variantSpec.sidingHex}-${variantSpec.texture}`, variantSpec.sidingHex, variantSpec.texture === 'lap-wide' ? 'fiber' : variantSpec.texture, { tile: 4, rough: .82, bump: .4 }),
      trim: material(`trim-${trimHex}`, trimHex, null, { rough: .55 }),
      timber: material(`timber-${variantSpec.timberHex}`, variantSpec.timberHex || '#4a3728', null, { rough: .7 }),
      soffit: material(`soffit-${trimHex}`, dark ? trimHex : new Three.Color(trimHex).multiplyScalar(.9), null, { rough: .8 }),
      roof: material(`roof-${variantSpec.roofHex}-${roofKind}`, variantSpec.roofHex, roofKind, { tile: roofTile, rough: roofKind === 'metal' ? .42 : .92, metal: roofKind === 'metal' ? .45 : 0, bump: roofKind === 'metal' ? .2 : .7 }),
      ridge: material(`ridge-${variantSpec.roofHex}`, new Three.Color(variantSpec.roofHex).multiplyScalar(.82), null, { rough: .9 }),
      masonry: material(`masonry-${masonryKind}`, '#ffffff', masonryKind, { tile: masonryKind === 'stone' ? 6 : 4, rough: .95, bump: .8 }),
      concrete: material('concrete', '#c3c3bb', 'concrete', { tile: 6, rough: .95 }),
      joint: material('joint', '#8e9089', null, { rough: 1 }),
      fence: material('fence', '#f4f3ee', null, { rough: .6 })
    };
    const frame = material(`frame-${frameHex}`, frameHex, null, { rough: .5 });
    m.glass = material(`glass-${light.glow}`, '#cfe4ea', 'glass', { tile: 4, rough: .12, metal: .2, emissive: '#ffcf8a', glow: light.glow * .9 });
    const lamp = material(`lamp-${light.glow}`, '#fff3c4', null, { rough: .4, emissive: '#ffbf50', glow: .6 + light.glow * 1.6 });
    const shutterHex = new Three.Color(variantSpec.sidingHex).getHSL({}).l < .38 ? '#f2f1ea' : variantSpec.sidingHex === '#2e3133' ? '#f2f1ea' : '#2e4a3e';
    const shutterMat = variantSpec.shutters ? material(`shutter-${shutterHex}`, shutterHex, 'louver', { tile: 1.2, rough: .6 }) : null;
    const grid = variantSpec.windowProduct === 'fiberglass' ? 'casement' : variantSpec.windowProduct === 'wood' ? 'colonial' : 'double';

    // Foundation and masonry skirt.
    const skirtH = variantSpec.masonryPercent >= 10 ? Math.min(4.8, 1.5 + variantSpec.masonryPercent / 20) : 0;
    box(building, L + .7, base + .25, W + .7, m.concrete, 0, (base + .25) / 2 - .12, 0);

    // Body and roof. A measured outline (from a confirmed public footprint) replaces the plain
    // rectangle for plain-gable homes: walls follow the real plan and the roof keeps the
    // measured rise. Porches, dormers and other additions stay with the standard model.
    const measured = form === 'gable' && variantSpec.outline?.points?.length >= 4 && variantSpec.outline.coverage >= .55 ? variantSpec.outline : null;
    let chain = profile('gable', W, y0, rise, storyH, stories), wing = null, leftWingTop = y0, faces = { front: y0, back: y0 }, measuredChimney = null;
    if (measured) {
      const built = measuredBody(building, { spec: variantSpec, m, base, y0, rise, storyH, overhang });
      chain = built.chain; measuredChimney = built.chimney;
    } else if (form === 'hip' || form === 'hip-low') {
      walls(building, { x0: -L / 2, x1: L / 2, z0: -W / 2, z1: W / 2, base, top: y0, m });
      chain = hipRoof(building, { x0: -L / 2, x1: L / 2, z0: -W / 2, z1: W / 2, y0, rise, overhang, m }).chain;
    } else if (form === 'flat') {
      walls(building, { x0: -L / 2, x1: L / 2, z0: -W / 2, z1: W / 2, base, top: y0, m });
      const o = overhang, y = y0 + 1.1;
      slab(building, [V(-L / 2 - o, y, W / 2 + o), V(L / 2 + o, y, W / 2 + o), V(L / 2 + o, y + .25, -W / 2 - o), V(-L / 2 - o, y + .25, -W / 2 - o)], 1.1, m.roof, m.trim, m.soffit);
      box(building, L - 1, 1.1, .4, m.glass, 0, y0 + .5, W / 2 - .2, { shadow: false });
      chain = [[W / 2, y0], [0, y0 + .6], [-W / 2, y0]];
    } else if (form === 'split') {
      const mid = 0, lowTop = base + Math.max(8, H * .62), lowRise = Math.max(2.6, rise * .8);
      leftWingTop = lowTop;
      prism(building, { x0: -L / 2, x1: mid, chain: profile('gable', W, lowTop, lowRise), base, overhang, m, caps: [true, false] });
      prism(building, { x0: mid, x1: L / 2, chain: profile('gable', W, y0, rise), base, overhang, m, caps: [true, true] });
    } else {
      chain = profile(form, W, y0, rise, storyH, stories);
      faces = { front: chain[0][1], back: chain.at(-1)[1] };
      prism(building, { x0: -L / 2, x1: L / 2, chain, base, overhang, m });
      if (form === 'cross-gable') {
        const gw = Math.min(L * .38, 17), gX = -L * .2, dp = 2.6, gRise = Math.min(rise * 1.05, rise + 1);
        const w = new Three.Group(); w.position.set(gX, 0, 0); w.rotation.y = -Math.PI / 2; building.add(w);
        prism(w, { x0: 0, x1: W / 2 + dp, chain: [[gw / 2, y0], [0, y0 + gRise], [-gw / 2, y0]], base, overhang: overhang * .8, rake: overhang * .9, m, caps: [false, true] });
        wing = { x0: gX - gw / 2, x1: gX + gw / 2, z: W / 2 + dp, gX, gw, gRise };
        skirt(building, { x0: wing.x0, x1: wing.x1, z0: W / 2, z1: wing.z, h: skirtH, m, sides: [true, false, true, true] });
        const zf = wing.z + .3;
        if (accent === 'half-timber') {
          beam(building, V(gX - gw / 2 + .4, y0 + .15, zf), V(gX + gw / 2 - .4, y0 + .15, zf), .2, .45, m.timber, false);
          for (const t of [-.3, 0, .3]) { const hgt = gRise * (1 - Math.abs(t) * 2) - .5; if (hgt > .8) beam(building, V(gX + t * gw, y0 + .3, zf), V(gX + t * gw, y0 + .3 + hgt, zf), .18, .3, m.timber, false); }
          for (const s of [-1, 1]) beam(building, V(gX + s * gw * .3, y0 + .3, zf), V(gX + s * gw * .08, y0 + gRise * .72, zf), .18, .26, m.timber, false);
          for (const t of [-.42, -.14, .14, .42]) beam(building, V(gX + t * gw, base + storyH + .2, zf), V(gX + t * gw, y0, zf), .18, .3, m.timber, false);
          beam(building, V(gX - gw / 2 + .3, base + storyH, zf), V(gX + gw / 2 - .3, base + storyH, zf), .2, .35, m.timber, false);
        } else if (accent === 'gingerbread') {
          box(building, .3, 2.6, .3, m.trim, gX, y0 + gRise + .9, zf);
          beam(building, V(gX - gw * .3, y0 + gRise * .45, zf), V(gX + gw * .3, y0 + gRise * .45, zf), .2, .3, m.trim, false);
          beam(building, V(gX, y0 + gRise * .45, zf), V(gX, y0 + gRise - .3, zf), .2, .26, m.trim, false);
        }
      }
    }
    if (!measured && (form === 'hip' || form === 'hip-low' || form === 'flat')) skirt(building, { x0: -L / 2, x1: L / 2, z0: -W / 2, z1: W / 2, h: skirtH, m });
    else if (!measured) skirt(building, { x0: -L / 2, x1: L / 2, z0: -W / 2, z1: W / 2, h: form === 'split' ? Math.min(skirtH, leftWingTop - base - 1) : skirtH, m });
    for (const z of [W / 2, -W / 2]) if (!measured && form !== 'split') box(building, L - .4, .45, .2, m.trim, 0, (z > 0 ? faces.front : faces.back) - .3, z + Math.sign(z) * .1, { shadow: false });
    if (!measured && accent === 'banded' && stories > 1) for (const z of [W / 2, -W / 2]) box(building, L + .4, .55, .3, m.timber, 0, base + storyH, z + Math.sign(z) * .15, { shadow: false });
    // Craftsman knee braces under the gable rakes.
    if (!measured && accent === 'rafters' && !['hip', 'hip-low', 'flat'].includes(form)) for (const sx of [-1, 1]) for (const z of [-W * .3, 0, W * .3]) {
      const yRoof = roofY(chain, z) - .55;
      beam(building, V(sx * (L / 2 + .15), yRoof - 2.6, z), V(sx * (L / 2 + overhang * .85), yRoof, z), .3, .3, m.timber, false);
      box(building, overhang * .9, .3, .3, m.timber, sx * (L / 2 + overhang * .45), yRoof, z, { shadow: false });
    }

    const turretInfo = !measured && accent === 'gingerbread' ? turret(building, { x: L / 2 - 2.6, z: W / 2 - .6, base, H, m, spec: variantSpec, frame, glassMat: m.glass, storyH }) : null;
    if (turretInfo) turretInfo.r += .2;

    // Chimney seated behind the ridge, rising above it.
    if (measuredChimney) {
      const size = accent === 'center-chimney' ? 3.4 : 2.5, topY = measuredChimney.ridgeY + 2.8;
      box(building, size, topY - (y0 - 2), size, m.masonry, measuredChimney.x, (topY + y0 - 2) / 2, measuredChimney.z);
      box(building, size + .5, .45, size + .5, m.concrete, measuredChimney.x, topY + .2, measuredChimney.z);
    } else if (form === 'flat' || form === 'shed-modern') {
      const flue = add(building, new Three.CylinderGeometry(.5, .55, 4, 12), material('flue', '#8d9196', null, { rough: .35, metal: .7 }));
      flue.position.set(L * .26, (form === 'flat' ? y0 + 2.6 : chain[2][1] + 1.2), -W * .25);
    } else {
      const peak = chain.reduce((best, p) => p[1] > best[1] ? p : best, chain[0]);
      const cx = accent === 'center-chimney' ? 0 : form === 'split' ? L * .3 : L * .27, cz = peak[0] - 1.8, size = accent === 'center-chimney' ? 3.4 : 2.5;
      const topY = (form === 'split' ? y0 + rise : peak[1]) + 2.8;
      box(building, size, topY - (y0 - 2), size, m.masonry, cx, (topY + y0 - 2) / 2, cz);
      box(building, size + .5, .45, size + .5, m.concrete, cx, topY + .2, cz);
    }

    // Dormers.
    if (!measured && variantSpec.dormers && form !== 'flat' && form !== 'shed-modern') {
      if (form === 'gambrel') shedDormer(building, { x0: -L * .3, x1: L * .3, chain, m, frame, glassMat: m.glass });
      else {
        const dChain = form === 'split' ? profile('gable', W, y0, rise) : chain;
        const xs = form === 'cross-gable' ? [L * .24] : form === 'hip' || form === 'hip-low' ? [0] : form === 'split' ? [L * .25] : [-L * .24, L * .24];
        for (const x of xs) gableDormer(building, { x, chain: dChain, m, frame, glassMat: m.glass });
      }
    }

    if (measured) {
      measuredOpenings(building, { spec: variantSpec, m, frame, base, y0, storyH, grid, shutterMat });
      measuredEntry(building, { spec: variantSpec, m, base, glassMat: m.glass, lamp, light });
    } else {
    // Windows placed by `windowLayout()` so the count follows Step 3.
    const span = face => face === 'front' || face === 'back' ? L : W;
    for (const win of variantSpec.windows) {
      const offset = (win.along - .5) * (span(win.face) - 6);
      const banded = accent === 'banded', picture = accent === 'picture-window' && win.face === 'front' && win.floor === 0 && Math.abs(offset) > 5;
      const winW = picture ? 5.6 : banded ? 4.4 : 3, winH = Math.min(banded ? 3.6 : 4.6, storyH * .5);
      const y = base + win.floor * storyH + storyH * .55;
      if (form === 'split' && win.floor > 0 && ((win.face === 'front' || win.face === 'back') && offset < 1.5 || win.face === 'left')) continue;
      const top = win.face === 'back' ? faces.back : win.face === 'front' ? faces.front : Math.min(faces.front, faces.back);
      if (y + winH / 2 > top - .6) continue;
      if (turretInfo && ((win.face === 'front' && offset > turretInfo.x - turretInfo.r - 2) || (win.face === 'right' && offset > turretInfo.z - turretInfo.r - 2))) continue;
      const u = windowUnit({ w: winW, h: winH, frame, glassMat: m.glass, m, grid: banded ? 'casement' : grid, shutters: win.face !== 'back' && !picture && !banded ? shutterMat : null });
      const inWing = wing && win.face === 'front' && offset > wing.x0 + 1.6 && offset < wing.x1 - 1.6;
      if (win.face === 'front') u.position.set(offset, y, (inWing ? wing.z : W / 2) + .08);
      else if (win.face === 'back') { u.position.set(offset, y, -W / 2 - .08); u.rotation.y = Math.PI; }
      else if (win.face === 'left') { u.position.set(-L / 2 - .08, y, offset); u.rotation.y = -Math.PI / 2; }
      else { u.position.set(L / 2 + .08, y, offset); u.rotation.y = Math.PI / 2; }
      building.add(u);
    }

    // Entry: steps, door, lanterns.
    box(building, 6.4, .5, 3.4, m.concrete, 0, .25, W / 2 + 1.7);
    box(building, 5.4, .5, 2, m.concrete, 0, .75, W / 2 + 1);
    doorUnit(building, { x: 0, z: W / 2, base, spec: variantSpec, m, glassMat: m.glass, light: lamp });
    if (light.glow > .5) { const p = new Three.PointLight('#ffc070', 22 * light.glow, 22, 1.6); p.position.set(0, base + 7, W / 2 + 3); building.add(p); }
    }

    const frontEave = (form === 'hip' || form === 'hip-low') ? y0 - overhang * rise / (W / 2) : form === 'flat' ? y0 + .1 : faces.front - overhang * Math.abs(roofY(chain, W / 2 - 1) - faces.front);
    if (variantSpec.porch && !measured) porch(building, { spec: variantSpec, L, W, base, storyH: Math.min(storyH, leftWingTop - base), frontEave, front2: stories > 1 ? base + storyH * 1.55 - Math.min(4.6, storyH * .5) / 2 : 99, m, turret: turretInfo });
    const drive = variantSpec.garage && !measured ? garage(building, { L, W, base, rise, m, spec: variantSpec, glassMat: m.glass }) : null;
    site(group, { spec: variantSpec, L, W, m, drive });
    group.userData.building = building;
    return group;
  }

  // ---------- Sky, light and environment ----------
  function skyDome(colors) {
    const geometry = new Three.SphereGeometry(1800, 32, 20), pos = geometry.attributes.position, col = [];
    const zenith = new Three.Color(colors.zenith), horizon = new Three.Color(colors.horizon), c = new Three.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / 1800);
      c.copy(horizon).lerp(zenith, Math.min(1, Math.pow(t, .5) * 1.15)); col.push(c.r, c.g, c.b);
    }
    geometry.setAttribute('color', new Three.Float32BufferAttribute(col, 3));
    const sky = new Three.Mesh(geometry, new Three.MeshBasicMaterial({ vertexColors: true, side: Three.BackSide, fog: false, depthWrite: false, toneMapped: false }));
    sky.renderOrder = -1; return sky;
  }
  function muted(preset) {
    const grey = new Three.Color('#b9c0c4');
    return { ...preset, zenith: '#' + new Three.Color(preset.zenith).lerp(grey, .55).getHexString(), horizon: '#' + new Three.Color(preset.horizon).lerp(grey, .45).getHexString() };
  }
  function applyScene(name) {
    if (name === sceneName && skyAfter) return;
    sceneName = name; lights = LIGHTS[name] || LIGHTS.day;
    for (const sky of [skyBefore, skyAfter]) if (sky) { scene.remove(sky); sky.geometry.dispose(); sky.material.dispose(); }
    skyAfter = skyDome(lights); skyBefore = skyDome(muted(lights)); scene.add(skyAfter, skyBefore);
    sun.color.set(lights.sun); sun.position.set(...lights.sunPos); sun.shadow.radius = lights.shadow;
    hemi.color.set(lights.hemiSky); hemi.groundColor.set(lights.hemiGround);
    renderer.toneMappingExposure = lights.exposure;
    if (!envMaps.has(name)) {
      try {
        pmrem ??= new Three.PMREMGenerator(renderer);
        const envScene = new Three.Scene(); envScene.add(skyDome(lights));
        const ground = new Three.Mesh(new Three.CircleGeometry(1500, 24), new Three.MeshBasicMaterial({ color: '#5f7d4a', side: Three.DoubleSide }));
        ground.rotation.x = -Math.PI / 2; ground.position.y = -2; envScene.add(ground);
        envMaps.set(name, pmrem.fromScene(envScene, .02).texture);
      } catch { envMaps.set(name, null); }
    }
    scene.environment = envMaps.get(name); scene.environmentIntensity = lights.env;
  }
  function applyAtmosphere(isBefore) {
    const welcome = isWelcome();
    skyAfter.visible = !isBefore && !welcome; skyBefore.visible = isBefore && !welcome;
    const fogColor = isBefore ? muted(lights).horizon : lights.horizon;
    if (welcome) scene.fog = null;
    else if (scene.fog) scene.fog.color.set(fogColor); else scene.fog = new Three.Fog(fogColor, 260, 1100);
    sun.intensity = lights.sunI * (isBefore ? .82 : 1);
    hemi.intensity = lights.hemiI * (isBefore ? .9 : 1);
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
      if (isWelcome()) renderer.setClearColor(0x000000, 0);
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
    // A crisp seam with a handle at the golden section of the height.
    const handleY = Math.round(height * 0.618);
    for (const [x, y, w, h, color] of [
      [beforeWidth - 2, 0, 4, height, '#ffffff'], [beforeWidth - 1, 0, 2, height, '#102303'],
      [beforeWidth - 14, handleY - 14, 28, 28, '#102303'], [beforeWidth - 12, handleY - 12, 24, 24, '#ffffff'], [beforeWidth - 4, handleY - 6, 2, 12, '#102303'], [beforeWidth + 2, handleY - 6, 2, 12, '#102303']
    ]) { renderer.setScissor(Math.max(0, x), Math.max(0, y), w, h); renderer.setClearColor(color, 1); renderer.clearColor(); }
    renderer.setScissorTest(false);
  }

  function buildHouse(next) {
    spec = next;
    beforeSpec = null;
    const afterSpec = next.before ? getSpec(false) : next;
    applyScene(afterSpec.scene || 'day');
    if (house) { house.traverse(node => { node.geometry?.dispose(); if (node.isInstancedMesh) node.dispose(); }); scene.remove(house); }
    house = new Three.Group();
    beforeHouse = null;
    afterHouse = buildVariant(afterSpec);
    house.add(afterHouse);
    if (next.before || splitPercent < 100) ensureBeforeHouse();
    scene.add(house);
    // Frame the building (not the lot) so every style and addition fits the view.
    const bounds = new Three.Box3().setFromObject(afterHouse.userData.building), sphere = bounds.getBoundingSphere(new Three.Sphere());
    target.x = sphere.center.x; target.y = Math.max(6, bounds.min.y + (bounds.max.y - bounds.min.y) * .42); target.z = sphere.center.z + 2;
    const aspect = camera.aspect || 1.6, vfov = camera.fov * Math.PI / 180, hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    fitRadius = sphere.radius / Math.sin(Math.min(vfov, hfov) / 2) * .9;
    const reach = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) / 2 + 45;
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 10, far: 420 });
    sun.target.position.set(target.x, 0, target.z); sun.position.set(target.x + lights.sunPos[0], lights.sunPos[1], target.z + lights.sunPos[2]);
    sun.shadow.camera.updateProjectionMatrix();
    const span = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
    welcomeLawn?.position.set(sphere.center.x, .03, sphere.center.z + 6); welcomeLawn?.scale.setScalar(span * .5 + 44);
    applyStageMode();
    for (const s of stages) s.dataset.spec = spec.label;
    frameCamera();
    renderScene();
  }

  /** The welcome model hides the street and distant ground, and stays out of the tab order. */
  function applyStageMode() {
    if (!renderer || !house) return;
    const welcome = isWelcome();
    house.traverse(node => { if (node.userData.far) node.visible = !welcome; });
    if (welcomeLawn) welcomeLawn.visible = welcome;
    renderer.domElement.tabIndex = welcome ? -1 : 0;
    if (welcome) renderer.domElement.setAttribute('aria-hidden', 'true'); else renderer.domElement.removeAttribute('aria-hidden');
  }

  function frameCamera() {
    if (!camera || !spec) return;
    const r = radius;
    camera.position.set(
      target.x + r * Math.cos(elevation) * Math.sin(azimuth),
      target.y + r * Math.sin(elevation),
      target.z + r * Math.cos(elevation) * Math.cos(azimuth)
    );
    camera.lookAt(target.x, target.y, target.z);
  }

  function cancelTransition() {
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = 0; }
  }
  function stopOrbit() {
    if (!orbitFrame) return;
    cancelAnimationFrame(orbitFrame); orbitFrame = 0; onOrbitChange?.(false);
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
    if (!open || !renderer || orbitFrame) return;
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
    stopOrbit();
    const view = views[name] || views.corner;
    const targetRad = fitRadius * (view.zoom || 1);
    // Take the short way round from wherever the camera was dragged to.
    let startAz = azimuth; const turns = Math.round((startAz - view.azimuth) / (Math.PI * 2)); startAz -= turns * Math.PI * 2;
    const startEl = elevation, startRad = radius;
    for (const btn of document.querySelectorAll('[data-remodel-view], [data-step3-view]')) {
      const btnView = btn.dataset.remodelView || btn.dataset.step3View;
      btn.setAttribute('aria-pressed', String(btnView === name));
    }
    animateValues(480, t => {
      azimuth = startAz + (view.azimuth - startAz) * t;
      elevation = startEl + (view.elevation - startEl) * t;
      radius = startRad + (targetRad - startRad) * t;
      frameCamera();
      renderScene();
    });
  }
  /** A slow turntable around the house; any drag, key or view button stops it. */
  function orbit() {
    if (orbitFrame) { stopOrbit(); return false; }
    if (!open || !renderer || prefersReducedMotion()) { azimuth += Math.PI / 2; frameCamera(); renderScene(); return false; }
    cancelTransition(); onOrbitChange?.(true);
    let last = performance.now();
    const tick = now => {
      azimuth += Math.min(.05, (now - last) / 1000) * (isTurntable() ? .2 : .32); last = now;
      frameCamera(); renderScene();
      orbitFrame = open ? requestAnimationFrame(tick) : 0;
      if (!orbitFrame) onOrbitChange?.(false);
    };
    orbitFrame = requestAnimationFrame(tick);
    return true;
  }

  function resize() {
    if (!renderer || !activeStage) return;
    const w = activeStage.clientWidth, h = activeStage.clientHeight;
    if (!w || !h) return;
    const aspectChanged = Math.abs(camera.aspect - w / h) > .01;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    const shift = frameVar('--frame-shift');
    if (shift) camera.setViewOffset(w, h, 0, -Math.round(h * shift), w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    if (aspectChanged && spec) {
      const ratio = radius / fitRadius;
      const vfov = camera.fov * Math.PI / 180, hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
      const sphere = new Three.Box3().setFromObject(afterHouse.userData.building).getBoundingSphere(new Three.Sphere());
      fitRadius = sphere.radius / Math.sin(Math.min(vfov, hfov) / 2) * .9; radius = fitRadius * ratio; frameCamera();
    }
    renderScene();
  }
  function mountCanvas(targetStage) {
    if (!targetStage || !stages.includes(targetStage)) return;
    activeStage = targetStage;
    if (!renderer) return;
    if (renderer.domElement.parentElement !== activeStage) activeStage.append(renderer.domElement);
    // Moving between the studio, the welcome model and the proposal resets the camera to that stage's framing;
    // moving between Steps 3 and 5 keeps the view the person left.
    const mode = isWelcome() ? 'welcome' : isTurntable() ? 'turntable' : 'studio', switched = mode !== mountedMode;
    if (switched) { mountedMode = mode; cancelTransition(); stopOrbit(); azimuth = views.corner.azimuth; elevation = views.corner.elevation; }
    applyStageMode();
    resize();
    if (switched) radius = fitRadius * (frameVar('--frame-zoom') || 1);
    frameCamera();
    renderScene();
    if (isTurntable() && !turntablePaused && !orbitFrame && !prefersReducedMotion()) orbit();
  }
  function controls(canvas) {
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '3D remodel preview. Drag or use arrow keys to look around. Scroll, pinch, or use plus and minus to zoom. Home resets the view.');
    const clampView = () => { cancelTransition(); elevation = Math.max(.03, Math.min(1.45, elevation)); radius = Math.max(fitRadius * .35, Math.min(fitRadius * 2.6, radius)); frameCamera(); renderScene(); };
    canvas.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(event.key)) return;
      event.preventDefault(); stopOrbit();
      if (event.key === 'Home') return setView('corner');
      if (event.key === 'ArrowLeft') azimuth -= .16;
      if (event.key === 'ArrowRight') azimuth += .16;
      if (event.key === 'ArrowUp') elevation += .09;
      if (event.key === 'ArrowDown') elevation -= .09;
      if (event.key === '+' || event.key === '=') radius /= 1.14;
      if (event.key === '-') radius *= 1.14;
      clampView();
    });
    canvas.addEventListener('wheel', event => { if (isWelcome() || (isTurntable() && !event.ctrlKey)) return; event.preventDefault(); stopOrbit(); radius *= Math.exp(Math.max(-100, Math.min(100, event.deltaY)) * .0022); clampView(); }, { passive: false });
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
      if (isTurntable() && orbitFrame) turntablePaused = true;
      cancelTransition(); stopOrbit();
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
    renderer = new Three.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = Three.PCFShadowMap;
    // Neutral tone mapping keeps the homeowner's chosen colors true instead of shifting their hue.
    renderer.toneMapping = Three.NeutralToneMapping; renderer.toneMappingExposure = 1;
    activeStage.append(renderer.domElement);
    scene = new Three.Scene();
    camera = new Three.PerspectiveCamera(34, 1, .5, 4000);
    hemi = new Three.HemisphereLight('#dbe9f6', '#6f7b59', .5); scene.add(hemi);
    sun = new Three.DirectionalLight('#fff3df', 2.6);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0004; sun.shadow.normalBias = .04;
    scene.add(sun, sun.target);
    if (welcomeStage) {
      // A lawn that fades out at the edge, so the welcome model floats on the page.
      const fade = document.createElement('canvas'); fade.width = fade.height = 128;
      const ctx = fade.getContext('2d'), gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, '#fff'); gradient.addColorStop(.55, '#fff'); gradient.addColorStop(1, '#000');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
      welcomeLawn = new Three.Mesh(new Three.CircleGeometry(1, 64), new Three.MeshStandardMaterial({ color: '#6f9a52', roughness: 1, alphaMap: new Three.CanvasTexture(fade), transparent: true, depthWrite: false }));
      welcomeLawn.rotation.x = -Math.PI / 2; welcomeLawn.receiveShadow = true; welcomeLawn.visible = false; scene.add(welcomeLawn);
    }
    controls(renderer.domElement);
    resizer = new ResizeObserver(resize);
    for (const s of stages) resizer.observe(s);
    const w = activeStage.clientWidth, h = activeStage.clientHeight;
    if (w && h) camera.aspect = w / h;
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
    cancelTransition(); stopOrbit(); open = false; renderer?.setAnimationLoop(null);
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
    for (const s of stages) if (s !== welcomeStage) observer.observe(s);
    // The welcome model waits for an idle moment so it never competes with the first paint, and is
    // skipped when the visitor has asked to save data.
    if (welcomeStage && !navigator.connection?.saveData) (globalThis.requestIdleCallback ?? (run => setTimeout(run, 400)))(() => observer.observe(welcomeStage), { timeout: 2500 });
  }
  return {
    open: openView, close: closeView, setView, orbit,
    /** Pauses or resumes a turntable stage's turn; returns whether it is turning. */
    toggleTurntable() {
      if (orbitFrame) { turntablePaused = true; stopOrbit(); return false; }
      turntablePaused = false;
      return isTurntable() ? orbit() : false;
    },
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
    get isOrbiting() { return Boolean(orbitFrame); },
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
