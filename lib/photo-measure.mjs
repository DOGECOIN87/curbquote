/**
 * Turns a vision model's reading of the homeowner's photo into estimate inputs. The model only finds
 * things (the wall facing the camera, the front door, a garage door, a gable) and counts windows and
 * doors; the feet are worked out here, from standard door sizes: an entry door is 80 inches tall, a
 * garage door 7 feet. Sizes are only given when the photo allows them (a wall seen straight on, a
 * door that looks like a door) and fall inside sensible ranges; everything else is left to the
 * homeowner. Expect about ±10–15%: a photo is a guide, and Alco confirms on site.
 */
import { z } from 'zod';

export const ENTRY_DOOR_FT = 80 / 12;
export const GARAGE_DOOR_FT = 7;

// Boxes in 0–1000 image coordinates (Gemini's native form), measured from the top-left corner.
const box = z.object({ top: z.number().min(0).max(1000), left: z.number().min(0).max(1000), bottom: z.number().min(0).max(1000), right: z.number().min(0).max(1000) }).nullable();
export const READING_SCHEMA = z.object({
  houseExterior: z.boolean().describe('True only if the photo shows the outside of a house'),
  view: z.enum(['straight-on', 'angled', 'corner', 'unclear']),
  side: z.enum(['front', 'back', 'left side', 'right side', 'unclear']),
  stories: z.number().min(0).max(5),
  windows: z.number().int().min(0).max(80),
  entryDoors: z.number().int().min(0).max(12),
  garageDoors: z.number().int().min(0).max(8),
  frontGables: z.number().int().min(0).max(8),
  wall: box, entryDoor: box, garageDoor: box, gable: box,
  masonryPercent: z.number().min(0).max(100),
  currentSiding: z.enum(['vinyl', 'fiber cement', 'wood', 'aluminum', 'brick', 'stone', 'stucco', 'other', 'unclear']),
  roofShape: z.enum(['gable', 'hip', 'gambrel', 'mansard', 'flat', 'mixed', 'unclear']),
  confidence: z.enum(['high', 'medium', 'low']),
  note: z.string()
});

export const READING_PROMPT = `You are measuring a homeowner's photo of their house for an exterior renovation estimate (siding, windows, doors, roofing and gutters). Look carefully, then answer in the schema.
Boxes use 0 to 1000 image coordinates: "left" and "right" from the left edge, "top" and "bottom" from the top edge. Draw each box tightly.
- houseExterior: true only for the outside of a house (not an interior, a drawing, a screenshot or another kind of building).
- wall: the main wall that faces the camera, from the ground (or the top of the foundation) up to the eave line where the roof starts, and from one corner of that wall to the other. Leave out the roof, porch roofs, chimneys and any wall seen at a sharp angle. Null if no wall is clear.
- entryDoor: the slab of the main front door itself, not its sidelights, transom, trim or storm-door frame. Null if no door is clearly visible.
- garageDoor: one whole garage door. Null if there is none.
- gable: a triangular gable on the wall facing the camera, from its base at the eave line up to its peak. Null if the roof slopes away from the camera instead.
- windows: every window you can see in the walls of the house, dormer windows included. A group of joined windows counts as one window per sash. Do not count skylights or roof windows, or glass in doors or garage doors.
- entryDoors: doors people walk through (front, side, patio), not garage doors. garageDoors: garage doors. frontGables: gables facing the camera.
- stories: above-ground stories: 1, 1.5 (living space under the roof), 2, 2.5 or 3.
- view: "straight-on" if the camera faces the main wall squarely, "angled" if that wall is seen at an angle, "corner" if two walls show about equally.
- side: which side of the house this most likely is.
- masonryPercent: the share of the visible wall area that is brick or stone.
- currentSiding: the main wall material now. roofShape: the main roof form.
- confidence and note: one short, plain sentence for the homeowner on anything that limits this reading (trees, shadows, a steep angle, part of the house cut off), or that the photo is clear.`;

const round = (n, step = .5) => Math.round(n / step) * step;
const inRange = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
const valid = b => b && b.right > b.left && b.bottom > b.top ? b : null;

/**
 * The feet-per-pixel scales the doors in the photo offer: a door slab is about 2 to 3 times as tall as
 * it is wide, a garage door 1 to 2.6 times as wide as tall, and either must be a sensible part of the wall.
 */
export function doorScales(reading, { width, height }) {
  const size = b => b && { w: (b.right - b.left) / 1000 * width, h: (b.bottom - b.top) / 1000 * height };
  const door = size(valid(reading.entryDoor)), garage = size(valid(reading.garageDoor)), wall = size(valid(reading.wall));
  return [
    door && inRange(door.h / door.w, 1.7, 3.4) && (!wall || inRange(door.h / wall.h, .08, .85)) && { by: 'front door', ftPerPx: ENTRY_DOOR_FT / door.h },
    garage && inRange(garage.w / garage.h, 1, 2.6) && (!wall || inRange(garage.h / wall.h, .1, .95)) && { by: 'garage door', ftPerPx: GARAGE_DOOR_FT / garage.h }
  ].filter(Boolean);
}

/**
 * The scale the sizes use. A scale must give the wall a sensible height per story (7 to 13 ft), which
 * catches a door box drawn around its frame or a door far behind the wall. Two doors that agree confirm
 * each other; when they disagree (one stands nearer the camera than the other) the one that gives the
 * more usual story height is used, and the wall's length is not read, since parts of it sit at different depths.
 */
export function photoScale(reading, size) {
  const wall = valid(reading.wall), stories = Math.min(4, Math.max(1, Math.round(reading.stories || 1)));
  const storyFt = scale => wall ? (wall.bottom - wall.top) / 1000 * size.height * scale.ftPerPx / stories : 9;
  const all = doorScales(reading, size), scales = all.filter(scale => inRange(storyFt(scale), 7, 13));
  const depthsDiffer = all.length === 2 && Math.abs(Math.log(all[0].ftPerPx / all[1].ftPerPx)) >= .2;
  if (!scales.length) return null;
  if (scales.length === 2 && !depthsDiffer) return { ftPerPx: (scales[0].ftPerPx + scales[1].ftPerPx) / 2, by: 'front and garage doors', depthsDiffer };
  const best = scales.reduce((a, b) => Math.abs(storyFt(a) - 9) <= Math.abs(storyFt(b) - 9) ? a : b);
  return { ...best, depthsDiffer };
}

/** The estimate inputs a reading supports, plus the boxes (0–1) the page outlines on the photo. */
export function measureReading(reading, size) {
  const stories = Math.min(4, Math.max(1, Math.round(reading.stories || 1)));
  const result = {
    side: reading.side, view: reading.view, confidence: reading.confidence, note: String(reading.note || '').trim().slice(0, 240),
    stories, windows: reading.windows, entryDoors: reading.entryDoors, garageDoors: reading.garageDoors,
    masonryPercent: Math.round(reading.masonryPercent / 5) * 5, currentSiding: reading.currentSiding, roofShape: reading.roofShape,
    scale: null, depthsDiffer: false, wallFt: null, storyHeightFt: null, gableRiseFt: null,
    boxes: Object.fromEntries(['wall', 'entryDoor', 'garageDoor', 'gable'].map(key => [key, valid(reading[key]) && Object.fromEntries(Object.entries(reading[key]).map(([side, v]) => [side, Math.round(v) / 1000]))]))
  };
  const scale = reading.view !== 'unclear' && photoScale(reading, size), wall = valid(reading.wall), gable = valid(reading.gable);
  if (!scale) return result;
  result.scale = scale.by; result.depthsDiffer = scale.depthsDiffer;
  if (wall) {
    result.storyHeightFt = round((wall.bottom - wall.top) / 1000 * size.height * scale.ftPerPx / stories);
    // Widths shrink when a wall is seen at an angle, so only a straight-on wall at one depth gives its length.
    const wallFt = (wall.right - wall.left) / 1000 * size.width * scale.ftPerPx;
    if (reading.view === 'straight-on' && !scale.depthsDiffer && inRange(wallFt, 12, 200)) result.wallFt = round(wallFt);
  }
  // A roof gable spans a good part of the wall and starts at its top; a dormer's small gable is not the roof's.
  const roofGable = gable && (!wall || ((gable.right - gable.left) >= .3 * (wall.right - wall.left) && Math.abs(gable.bottom - wall.top) <= 60));
  if (roofGable && reading.frontGables > 0) {
    const riseFt = (gable.bottom - gable.top) / 1000 * size.height * scale.ftPerPx;
    if (inRange(riseFt, 2, 20)) result.gableRiseFt = round(riseFt);
  }
  return result;
}
