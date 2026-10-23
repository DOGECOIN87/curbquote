/**
 * An animated measuring pass over the property view: corner points appear, the outline draws in,
 * dimension lines extend and their labels count up, then a height line rises. Dimensions come from
 * the mapped building outline when there is one (approximate); otherwise the drawing is labelled
 * illustrative. Nothing here becomes an estimate input.
 */
export const FEET_PER_METER = 3.28084;
const empty = () => ({ type: 'FeatureCollection', features: [] });
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const span = (now, start, length) => ease((now - start) / length);

/** A flat local frame in metres around a point, accurate at building scale. */
function frame([lon0, lat0]) {
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  return { to: ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky], from: ([x, y]) => [lon0 + x / kx, lat0 + y / ky] };
}
function hull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of sorted) { while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  for (const p of sorted.reverse()) { while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** The smallest rectangle around an outline ring of [lon, lat] points, with its sides in feet. */
export function measureOutline(ring) {
  const points = ring.filter(p => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite));
  if (points.length < 3) return null;
  const centre = [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
  const local = frame(centre), shape = hull(points.map(local.to));
  if (shape.length < 3) return null;
  let best = null;
  for (let i = 0; i < shape.length; i++) {
    const [x1, y1] = shape[i], [x2, y2] = shape[(i + 1) % shape.length], angle = Math.atan2(y2 - y1, x2 - x1);
    const cos = Math.cos(-angle), sin = Math.sin(-angle);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of shape) {
      const rx = x * cos - y * sin, ry = x * sin + y * cos;
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx); minY = Math.min(minY, ry); maxY = Math.max(maxY, ry);
    }
    const area = (maxX - minX) * (maxY - minY);
    if (!best || area < best.area) best = { area, angle, minX, maxX, minY, maxY };
  }
  const { angle, minX, maxX, minY, maxY } = best, cos = Math.cos(angle), sin = Math.sin(angle);
  const toWorld = ([x, y]) => local.from([x * cos - y * sin, x * sin + y * cos]);
  const along = (maxX - minX) * FEET_PER_METER, across = (maxY - minY) * FEET_PER_METER;
  if (along < 8 || across < 8 || along > 600 || across > 600) return null;
  const offset = 2.6, tick = .9;
  const side = (a, b, ticks) => ({ line: [toWorld(a), toWorld(b)], ticks: ticks.map(([p, q]) => [toWorld(p), toWorld(q)]) });
  return {
    outline: points, centre, angle,
    sides: [
      { feet: along, ...side([minX, minY - offset], [maxX, minY - offset], [[[minX, minY - offset - tick], [minX, minY - offset + tick]], [[maxX, minY - offset - tick], [maxX, minY - offset + tick]]]) },
      { feet: across, ...side([maxX + offset, minY], [maxX + offset, maxY], [[[maxX + offset - tick, minY], [maxX + offset + tick, minY]], [[maxX + offset - tick, maxY], [maxX + offset + tick, maxY]]]) }
    ]
  };
}

/**
 * Finds the roof nearest the middle of a square grid of surface heights (metres; NaN where unknown),
 * `n` samples a side and `step` metres apart, or the roof under `pick` ([column, row]) when given.
 * Roofs stand above the ground and are locally flat planes; tree canopies stand as high but are rough,
 * so they are skipped. Returns the roof's corner points in metres from the middle (x east, y north),
 * the ground height and the roof's top, or null when no roof-like surface is near enough.
 */
export function findRoof(heights, n, step, { pick = null, minArea = 30, maxArea = 1500 } = {}) {
  const at = (i, j) => i < 0 || j < 0 || i >= n || j >= n ? NaN : heights[j * n + i];
  const known = heights.filter(Number.isFinite).sort((a, b) => a - b);
  if (known.length < n * n / 2) return null;
  const ground = known[Math.floor(known.length * .15)], raised = (i, j) => at(i, j) > ground + 2.4;
  // A plane fitted to the 3 × 3 neighbourhood: a roof fits it to a few centimetres, a canopy does not.
  const flat = (i, j) => {
    const zs = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const z = at(i + di, j + dj); if (!Number.isFinite(z)) return false; zs.push([di, dj, z]); }
    const a = zs.reduce((s, [, , z]) => s + z, 0) / 9, b = zs.reduce((s, [x, , z]) => s + x * z, 0) / 6, c = zs.reduce((s, [, y, z]) => s + y * z, 0) / 6;
    return Math.sqrt(zs.reduce((s, [x, y, z]) => s + (z - a - b * x - c * y) ** 2, 0) / 9) < .25;
  };
  const core = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (raised(i, j) && flat(i, j)) core[j * n + i] = 1;
  // Grow each flat patch by one sample, so ridges join their two slopes and the edge by the walls counts.
  const grown = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (!raised(i, j)) continue;
    for (let dj = -1; dj <= 1 && !grown[j * n + i]; dj++) for (let di = -1; di <= 1; di++) {
      const ni = i + di, nj = j + dj;
      if (ni >= 0 && nj >= 0 && ni < n && nj < n && core[nj * n + ni]) { grown[j * n + i] = 1; break; }
    }
  }
  const seen = new Uint8Array(n * n), parts = [];
  for (let start = 0; start < n * n; start++) {
    if (!grown[start] || seen[start]) continue;
    const cells = [], queue = [start]; seen[start] = 1;
    while (queue.length) {
      const k = queue.pop(), i = k % n, j = (k - i) / n; cells.push([i, j]);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj, nk = nj * n + ni;
        if (ni >= 0 && nj >= 0 && ni < n && nj < n && grown[nk] && !seen[nk]) { seen[nk] = 1; queue.push(nk); }
      }
    }
    // Edges and ridges are never flat, so a whole roof is about half flat; a canopy's flat specks are far fewer.
    const area = cells.length * step * step, flatCells = cells.filter(([i, j]) => core[j * n + i]).length;
    if (area >= minArea && area <= maxArea && flatCells / cells.length >= .35 && flatCells * step * step >= 12) parts.push(cells);
  }
  const middle = (n - 1) / 2, [pi, pj] = pick || [middle, middle];
  const reach = cells => Math.min(...cells.map(([i, j]) => Math.hypot(i - pi, j - pj)));
  const best = parts.map(cells => ({ cells, gap: reach(cells) })).filter(part => part.gap <= (pick ? 3 : middle)).sort((a, b) => a.gap - b.gap)[0];
  if (!best) return null;
  const tops = best.cells.map(([i, j]) => at(i, j)).sort((a, b) => a - b), half = step / 2;
  const corners = hull(best.cells.flatMap(([i, j]) => [[-half, -half], [half, -half], [half, half], [-half, half]].map(([dx, dy]) => [(i - middle) * step + dx, (j - middle) * step + dy])));
  return { corners, ground, peak: tops[Math.floor((tops.length - 1) * .95)] };
}

/** An illustrative rectangle of the given size, centred on a point and squared to north. */
export function illustrativeOutline([lon, lat], lengthFt, widthFt) {
  const local = frame([lon, lat]), x = lengthFt / FEET_PER_METER / 2, y = widthFt / FEET_PER_METER / 2;
  return [[-x, -y], [x, -y], [x, y], [-x, y], [-x, -y]].map(local.from);
}

const label = (className, text) => { const el = document.createElement('div'); el.className = className; el.textContent = text; return el; };
const feetText = feet => `≈ ${Math.round(feet)} ft`;

/**
 * Draws the measuring pass on a MapLibre map. `api` is the MapLibre module (for markers).
 * play() returns the dimensions it shows; clear() removes everything.
 */
export function setupMapMeasure(map, api) {
  let frameId = 0, markers = [], height = null;
  map.addSource('measure', { type: 'geojson', data: empty() });
  const only = kind => ['==', ['get', 'kind'], kind];
  map.addLayer({ id: 'measure-glow', type: 'line', source: 'measure', filter: only('outline'), layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#4fe3cf', 'line-width': 12, 'line-blur': 9, 'line-opacity': .5 } });
  map.addLayer({ id: 'measure-outline', type: 'line', source: 'measure', filter: only('outline'), layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#b6fff3', 'line-width': 2.6 } });
  map.addLayer({ id: 'measure-dims', type: 'line', source: 'measure', filter: only('dim'), paint: { 'line-color': '#e9fffb', 'line-width': 1.8, 'line-dasharray': [3, 2] } });
  map.addLayer({ id: 'measure-ticks', type: 'line', source: 'measure', filter: only('tick'), paint: { 'line-color': '#e9fffb', 'line-width': 2 } });
  map.addLayer({ id: 'measure-corners', type: 'circle', source: 'measure', filter: only('corner'), paint: { 'circle-radius': 4.5, 'circle-color': '#ffffff', 'circle-stroke-color': '#22c7b0', 'circle-stroke-width': 2.2 } });
  const feature = (kind, geometry) => ({ type: 'Feature', properties: { kind }, geometry });
  const partial = (line, t) => {
    if (t >= 1) return line;
    const lengths = line.slice(1).map((p, i) => Math.hypot(p[0] - line[i][0], (p[1] - line[i][1]) * 1.3));
    let left = lengths.reduce((a, b) => a + b, 0) * t; const out = [line[0]];
    for (let i = 0; i < lengths.length && left > 0; i++) {
      const k = Math.min(1, left / (lengths[i] || 1)); left -= lengths[i];
      out.push([line[i][0] + (line[i + 1][0] - line[i][0]) * k, line[i][1] + (line[i + 1][1] - line[i][1]) * k]);
    }
    return out.length > 1 ? out : [line[0], line[0]];
  };
  const grow = ([a, b], t) => { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; return [[m[0] + (a[0] - m[0]) * t, m[1] + (a[1] - m[1]) * t], [m[0] + (b[0] - m[0]) * t, m[1] + (b[1] - m[1]) * t]]; };
  function placeHeight() {
    if (!height) return;
    const metresPerPixel = 40075016.686 * Math.cos(height.centre[1] * Math.PI / 180) / (512 * 2 ** map.getZoom());
    height.px = Math.max(0, height.metres / metresPerPixel * Math.sin(map.getPitch() * Math.PI / 180));
    height.el.style.setProperty('--rise', `${Math.round(height.px * height.t)}px`);
  }
  function clear() {
    cancelAnimationFrame(frameId); frameId = 0;
    for (const marker of markers) marker.remove(); markers = []; height = null;
    map.getSource('measure')?.setData(empty());
  }
  /** `shape` from measureOutline(); `heightFt` optional. */
  function play(shape, { heightFt = null } = {}) {
    clear();
    if (!shape) return null;
    const ring = shape.outline.at(-1)[0] === shape.outline[0][0] && shape.outline.at(-1)[1] === shape.outline[0][1] ? shape.outline : [...shape.outline, shape.outline[0]];
    const labels = shape.sides.map(side => {
      const el = label('measure-label', '≈ 0 ft');
      markers.push(new api.Marker({ element: el, anchor: 'center' }).setLngLat([(side.line[0][0] + side.line[1][0]) / 2, (side.line[0][1] + side.line[1][1]) / 2]).addTo(map));
      return { el, feet: side.feet };
    });
    if (Number.isFinite(heightFt) && heightFt > 6 && heightFt < 140) {
      const el = document.createElement('div'); el.className = 'measure-height';
      const text = label('measure-label', '≈ 0 ft'); el.append(Object.assign(document.createElement('span'), { className: 'measure-rise' }), text);
      markers.push(new api.Marker({ element: el, anchor: 'bottom' }).setLngLat(shape.centre).addTo(map));
      height = { el, text, feet: heightFt, metres: heightFt / FEET_PER_METER, centre: shape.centre, t: 0 };
    }
    const start = performance.now(), still = reducedMotion();
    const render = now => {
      const t = still ? Infinity : now - start;
      const corners = ring.slice(0, -1).filter((_, i) => t >= i * 90);
      const features = [
        ...corners.map(p => feature('corner', { type: 'Point', coordinates: p })),
        feature('outline', { type: 'LineString', coordinates: partial(ring, span(t, 250, 1100)) })
      ];
      const reach = span(t, 1250, 650);
      if (reach > 0) for (const side of shape.sides) {
        features.push(feature('dim', { type: 'LineString', coordinates: grow(side.line, reach) }));
        if (reach >= 1) for (const tick of side.ticks) features.push(feature('tick', { type: 'LineString', coordinates: tick }));
      }
      map.getSource('measure')?.setData({ type: 'FeatureCollection', features });
      const count = span(t, 1500, 700);
      for (const item of labels) { item.el.classList.toggle('is-shown', count > 0); item.el.textContent = feetText(item.feet * count); }
      if (height) {
        height.t = span(t, 2000, 800); height.el.classList.toggle('is-shown', height.t > 0);
        height.text.textContent = feetText(height.feet * height.t); placeHeight();
      }
      frameId = t < 2900 ? requestAnimationFrame(render) : 0;
    };
    frameId = requestAnimationFrame(render);
    return { sides: shape.sides.map(side => Math.round(side.feet)), heightFt: height ? Math.round(height.feet) : null };
  }
  map.on('move', placeHeight);
  return { play, clear };
}

const SVG = 'http://www.w3.org/2000/svg';
const node = (name, className, parent) => { const el = document.createElementNS(SVG, name); el.setAttribute('class', className); parent.append(el); return el; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/**
 * The same measuring pass drawn over a 3D scene that has no layers of its own (Google tiles in
 * CesiumJS): the outline at ground level, walls rising to the eaves, dimension lines with counting
 * labels and a height line, all projected to the screen on every frame so they follow the camera.
 * `project([lon, lat, metres])` returns screen pixels or null when the point is off camera.
 */
export function setupScreenMeasure(layer) {
  const svg = node('svg', 'measure-3d-lines', layer);
  const glow = node('path', 'measure-3d-glow', svg), base = node('path', 'measure-3d-outline', svg), walls = node('path', 'measure-3d-walls', svg);
  const dims = node('path', 'measure-3d-dims', svg), ticks = node('path', 'measure-3d-ticks', svg), rise = node('path', 'measure-3d-rise', svg);
  for (const path of [glow, base]) path.setAttribute('pathLength', '1');
  let model = null, project = null, labels = [], heightLabel = null, corners = [], start = 0, frameId = 0;
  const toPath = rings => rings.map(points => {
    let d = '', open = false;
    for (const p of points) { if (!p) { open = false; continue; } d += `${open ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`; open = true; }
    return d;
  }).join('');
  const place = (el, p) => { el.hidden = !p; if (p) el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`; };
  function draw(now = performance.now()) {
    if (!model || !project) return;
    const t = reducedMotion() ? Infinity : now - start, at = h => p => project([p[0], p[1], h]);
    const { ring, ground, eave, peak } = model, ringAt = h => ring.map(at(h));
    const drawn = span(t, 250, 1100), rising = span(t, 900, 900), reach = span(t, 1250, 650), count = span(t, 1500, 700), lift = span(t, 2000, 800);
    const outline = toPath([ringAt(ground)]);
    for (const path of [glow, base]) { path.setAttribute('d', outline); path.style.strokeDashoffset = String(1 - drawn); }
    const top = ground + (eave - ground) * rising;
    walls.setAttribute('d', rising > 0 ? toPath([ringAt(top), ...ring.slice(0, -1).map(p => [at(ground)(p), at(top)(p)])]) : '');
    corners.forEach((dot, i) => { const p = t >= i * 90 ? at(ground)(ring[i]) : null; dot.style.display = p ? '' : 'none'; if (p) { dot.setAttribute('cx', p.x.toFixed(1)); dot.setAttribute('cy', p.y.toFixed(1)); } });
    const grown = model.sides.map(side => { const m = lerp(side.line[0], side.line[1], .5); return [lerp(m, side.line[0], reach), lerp(m, side.line[1], reach)].map(at(ground)); });
    dims.setAttribute('d', reach > 0 ? toPath(grown) : '');
    ticks.setAttribute('d', reach >= 1 ? toPath(model.sides.flatMap(side => side.ticks.map(tick => tick.map(at(ground))))) : '');
    labels.forEach((label, i) => {
      label.el.classList.toggle('is-shown', count > 0); label.el.textContent = feetText(label.feet * count);
      place(label.el, at(ground)(lerp(model.sides[i].line[0], model.sides[i].line[1], .5)));
    });
    if (heightLabel) {
      const height = ground + (peak - ground) * lift, foot = at(ground)(model.centre), head = at(height)(model.centre);
      rise.setAttribute('d', lift > 0 ? toPath([[foot, head]]) : '');
      heightLabel.el.classList.toggle('is-shown', lift > 0); heightLabel.el.textContent = feetText(heightLabel.feet * lift);
      place(heightLabel.el, head && { x: head.x, y: head.y - 16 });
    }
    frameId = t < 2900 ? requestAnimationFrame(draw) : 0;
  }
  function clear() {
    cancelAnimationFrame(frameId); frameId = 0; model = null;
    for (const el of [...labels.map(label => label.el), heightLabel?.el, ...corners]) el?.remove();
    labels = []; heightLabel = null; corners = [];
    for (const path of [glow, base, walls, dims, ticks, rise]) path.setAttribute('d', '');
  }
  /**
   * `shape` from measureOutline(); heights in metres above the ellipsoid: `ground`, `eave` (top of the
   * walls) and `peak` (top of the roof). Returns the rounded sides and height in feet.
   */
  function play(shape, { ground, eave, peak }, projector) {
    clear();
    if (!shape) return null;
    const first = shape.outline[0], last = shape.outline.at(-1);
    model = { ring: first[0] === last[0] && first[1] === last[1] ? shape.outline : [...shape.outline, first], sides: shape.sides, centre: shape.centre, ground, eave, peak };
    project = projector;
    corners = model.ring.slice(0, -1).map(() => node('circle', 'measure-3d-corner', svg));
    corners.forEach(dot => dot.setAttribute('r', '4.5'));
    labels = shape.sides.map(side => { const el = label('measure-label', '≈ 0 ft'); layer.append(el); return { el, feet: side.feet }; });
    const heightFt = (peak - ground) * FEET_PER_METER;
    if (heightFt > 6 && heightFt < 140) { const el = label('measure-label', '≈ 0 ft'); layer.append(el); heightLabel = { el, feet: heightFt }; }
    start = performance.now(); cancelAnimationFrame(frameId); frameId = requestAnimationFrame(draw);
    return { sides: shape.sides.map(side => Math.round(side.feet)), heightFt: heightLabel ? Math.round(heightFt) : null };
  }
  /** Re-projects after the camera moves; cheap enough to call on every rendered frame. */
  const redraw = () => { if (model && !frameId) draw(); };
  return { play, clear, redraw };
}
