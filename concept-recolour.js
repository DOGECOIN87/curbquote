/**
 * Instant siding colours on an AI concept. The image model paints the siding a vivid magenta marker
 * (#ff00ff, a colour houses and gardens almost never show), keeping the boards' texture, shadows and
 * light. This module finds those pixels once (how strongly each is marker, and how bright), then
 * repaints them in any siding colour in a few milliseconds, with no further AI call. Pure pixel maths
 * on RGBA arrays, so it also runs in Node tests.
 */
export const SIDING_MARKER = '#ff00ff';

const smooth = (edge0, edge1, x) => { const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0))); return t * t * (3 - 2 * t); };

/**
 * How much of each pixel is the magenta marker (0–255) and how bright it is, from RGBA data. Magenta
 * keeps red and blue together well above green, in sun and in shade; pink flowers, red brick and white
 * trim do not. `coverage` is the marked share of the picture; `reference` the brightness of sunlit siding.
 */
export function findMarker(data, width) {
  const count = data.length / 4, alpha = new Uint8ClampedArray(count), bright = new Uint8ClampedArray(count);
  const levels = new Uint32Array(256);
  let marked = 0;
  for (let i = 0; i < count; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], top = Math.max(r, b);
    if (top < 28) continue;
    const purity = (Math.min(r, b) - g) / top, balance = Math.abs(r - b) / top;
    const a = smooth(.3, .55, purity) * (1 - smooth(.35, .6, balance));
    if (a <= 0) continue;
    alpha[i] = Math.round(a * 255); bright[i] = top;
    if (a > .5) { marked++; levels[top]++; }
  }
  // The 95th percentile of marked brightness stands for sunlit siding: it maps to the chosen colour itself.
  let reference = 255, seen = 0;
  for (let level = 255; level >= 0; level--) { seen += levels[level]; if (seen >= marked * .05) { reference = Math.max(40, level); break; } }
  return { alpha, bright, width, coverage: marked / count, reference };
}

const hexRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

/**
 * The concept with its marked siding in `hex`: the colour scaled by each pixel's light (so shade and
 * board shadows stay), blended by marker strength, and any magenta tint on the edges taken out.
 */
export function paintSiding(data, marker, hex) {
  const [tr, tg, tb] = hexRgb(hex), out = new Uint8ClampedArray(data), { alpha, bright, reference, width } = marker;
  const besideSiding = i => alpha[i - 1] > 128 || alpha[i + 1] > 128 || alpha[i - width] > 128 || alpha[i + width] > 128;
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i] / 255, p = i * 4, r = data[p], g = data[p + 1], b = data[p + 2];
    // A faint pink fringe right beside the siding (JPEG blurs colour edges) loses its magenta too.
    if (!a) { if (besideSiding(i)) { const spill = Math.max(0, Math.min(r, b) - g); out[p] = r - spill; out[p + 2] = b - spill; } continue; }
    // Edge pixels mix siding with what is next to it: take the magenta out of that part before blending.
    const spill = Math.max(0, Math.min(r, b) - g), shade = Math.min(1.15, bright[i] / reference);
    out[p] = a * tr * shade + (1 - a) * (r - spill);
    out[p + 1] = a * tg * shade + (1 - a) * g;
    out[p + 2] = a * tb * shade + (1 - a) * (b - spill);
  }
  return out;
}
