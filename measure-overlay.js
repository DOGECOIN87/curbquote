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
