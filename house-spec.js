/**
 * Turns the homeowner's estimator answers into a deterministic description of a house for the 3D
 * remodel preview. Pure and forgiving on purpose: while someone is still typing, invalid values
 * fall back to the defaults so the preview never breaks. Nothing here feeds the estimate maths.
 */
import { DEFAULT_INPUT } from './estimate.js';
import { COLORS, DEFAULT_PROJECT } from './project.js';

export const ROOF_COLORS = Object.freeze({
  charcoal: { name: 'Charcoal shingles', hex: '#3d4148' },
  weathered: { name: 'Weathered brown', hex: '#6d5a48' },
  slate: { name: 'Slate blue', hex: '#4d6472' },
  clay: { name: 'Clay red', hex: '#8a4f3d' }
});
export const DEFAULT_DESIGN = Object.freeze({ roof: 'charcoal', porch: true, dormers: false, shutters: true, before: false });
/** The dated "existing home" palette used by Before. Additions never show in Before. */
export const BEFORE_LOOK = Object.freeze({ sidingHex: '#b3a58c', roofHex: '#6f6459', doorHex: '#5d564c', frameHex: '#d8d2c4' });
export const DOOR_HEX = Object.freeze({ steel: '#294e51', fiberglass: '#8a6844', wood: '#603c2d' });
export const SIDING_TEXTURE = Object.freeze({ vinyl: 'lap', fiber: 'lap-wide', engineered: 'board' });

const clamp = (value, min, max, fallback) => {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/**
 * Spreads the home's real window count across the four faces and floors. Front windows keep
 * clear of the entry door, and no face shows more than it can fit for its length.
 */
export function windowLayout({ lengthFt, widthFt, stories, existingWindows }) {
  const total = Math.min(28, Math.max(0, Math.round(clamp(existingWindows, 0, 150, DEFAULT_INPUT.existingWindows))));
  const floors = Math.max(1, Math.round(stories));
  const fit = span => Math.max(1, Math.floor((span - 6) / 8));
  const capacity = { front: fit(lengthFt) * floors, back: fit(lengthFt) * floors, left: fit(widthFt) * floors, right: fit(widthFt) * floors };
  const wanted = { front: Math.floor(total * .38), back: Math.floor(total * .3), left: Math.floor(total * .16), right: Math.floor(total * .16) };
  // Hand the rounding remainder to the street faces first, so the counts still add up.
  for (const face of ['front', 'back', 'left', 'right']) {
    if (wanted.front + wanted.back + wanted.left + wanted.right >= total) break;
    wanted[face]++;
  }
  const windows = [];
  for (const face of ['front', 'back', 'left', 'right']) {
    const count = Math.min(wanted[face], capacity[face]);
    const span = face === 'front' || face === 'back' ? lengthFt : widthFt;
    const perFloor = Math.min(fit(span), Math.ceil(count / floors) || 0);
    let placed = 0;
    for (let floor = floors - 1; floor >= 0 && placed < count; floor--) {
      const onFloor = Math.min(perFloor, count - placed);
      for (let i = 0; i < onFloor; i++) {
        // Spread evenly, then on the front ground floor nudge a centred window away from the door.
        let along = onFloor === 1 ? .5 : .16 + (i * .68) / (onFloor - 1);
        if (face === 'front' && floor === 0 && Math.abs(along - .5) < .13) along += along < .5 ? -.15 : .15;
        windows.push({ face, floor, along: Math.round(along * 1000) / 1000 });
        placed++;
      }
    }
  }
  return windows;
}

/** @returns a renderer-ready spec in feet; `label` describes it in plain words for the panel. */
export function houseSpec(inputs = {}, options = {}, design = {}) {
  const source = { ...DEFAULT_INPUT, ...inputs }, p = { ...DEFAULT_PROJECT, ...options }, d = { ...DEFAULT_DESIGN, ...design };
  const spec = {
    // Visual proportions stay believable even at the estimator's widest legal inputs.
    lengthFt: clamp(source.lengthFt, 18, 90, DEFAULT_INPUT.lengthFt),
    widthFt: clamp(source.widthFt, 16, 64, DEFAULT_INPUT.widthFt),
    stories: Math.round(clamp(source.stories, 1, 4, DEFAULT_INPUT.stories)),
    storyHeightFt: clamp(source.storyHeightFt, 7.5, 12, DEFAULT_INPUT.storyHeightFt),
    gableRiseFt: clamp(source.gableRiseFt, 3, 12, DEFAULT_INPUT.gableRiseFt),
    masonryPercent: clamp(source.masonryPercent, 0, 100, DEFAULT_INPUT.masonryPercent),
    sidingProduct: SIDING_TEXTURE[p.sidingProduct] ? p.sidingProduct : 'vinyl',
    doorProduct: DOOR_HEX[p.doorProduct] ? p.doorProduct : 'steel',
    windowProduct: ['vinyl', 'fiberglass', 'wood'].includes(p.windowProduct) ? p.windowProduct : 'vinyl',
    color: COLORS[p.color] ? p.color : DEFAULT_PROJECT.color,
    roof: ROOF_COLORS[d.roof] ? d.roof : DEFAULT_DESIGN.roof,
    before: Boolean(d.before),
    porch: Boolean(d.porch) && !d.before,
    dormers: Boolean(d.dormers) && !d.before,
    shutters: Boolean(d.shutters) && !d.before
  };
  spec.wallHeightFt = Math.round(spec.stories * spec.storyHeightFt * 10) / 10;
  spec.texture = SIDING_TEXTURE[spec.sidingProduct];
  spec.sidingHex = spec.before ? BEFORE_LOOK.sidingHex : COLORS[spec.color].hex;
  spec.sidingName = spec.before ? 'Existing siding' : COLORS[spec.color].name;
  spec.roofHex = spec.before ? BEFORE_LOOK.roofHex : ROOF_COLORS[spec.roof].hex;
  spec.doorHex = spec.before ? BEFORE_LOOK.doorHex : DOOR_HEX[spec.doorProduct];
  spec.frameHex = spec.before ? BEFORE_LOOK.frameHex : spec.windowProduct === 'wood' ? '#d3bc93' : spec.windowProduct === 'fiberglass' ? '#3a3f44' : '#f6f4e8';
  spec.windows = windowLayout({ ...spec, existingWindows: source.existingWindows });
  spec.label = `${Math.round(spec.lengthFt)} × ${Math.round(spec.widthFt)} ft · ${spec.stories} ${spec.stories === 1 ? 'story' : 'stories'} · ${spec.windows.length} windows shown`;
  return spec;
}

export {
  HOME_STYLES,
  HOME_STYLE_IDS,
  DEFAULT_HOME_STYLE,
  STYLE_VARIANT_BADGE,
  CONCEPT_MODEL_BADGE,
  normalizeHomeStyle,
  resolveHomeStyle,
  dimensionsFromFootprint,
  suggestStyleFromFootprint,
  modelGuardrailLabel,
  houseSpecFromStyle
} from './home-styles.js';
