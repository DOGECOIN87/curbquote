/**
 * A photo-real concept of the homeowner's own exterior photo with their Alco choices (siding product
 * and colour, CertainTeed shingles, trim, windows, entry door, gutters), made by an image model
 * through the Vercel AI Gateway. The page sends option keys, never free text, and the instruction is
 * built here from the catalog, so every request reads the same way. A chain of models (primary,
 * fallback, primary again) and a check on every returned image keep it working when one model
 * fails. Only the homeowner's upload is used (Google imagery may not be modified). Nothing is
 * stored; the picture is illustrative and never feeds the estimate. GET says whether it is available.
 */
import { z } from 'zod';
import { hasAgentCredentials } from '../lib/agent.mjs';
import { ChainError, editPhoto, modelChain, readDataUrl } from '../lib/image-ai.mjs';
import { clientKey, createRequestLimiter } from '../lib/rate-limit.mjs';
import { COLORS, PRODUCTS } from '../project.js';
import { ROOF_COLORS, TRIM_COLORS } from '../house-spec.js';

export const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image';
export const DEFAULT_FALLBACK_IMAGE_MODEL = 'openai/gpt-image-2';
// About 2 MB of JPEG once encoded; the page downsizes photos to 1280 px before sending.
export const MAX_IMAGE_CHARS = 2800000;
const keyOf = table => z.enum(Object.keys(table));
const designSchema = z.object({
  siding: z.object({ product: keyOf(PRODUCTS.siding), color: keyOf(COLORS) }).strict().optional(),
  roof: z.object({ color: keyOf(ROOF_COLORS) }).strict().optional(),
  trim: z.enum(Object.keys(TRIM_COLORS).filter(key => TRIM_COLORS[key].hex)).optional(),
  windows: z.object({ product: keyOf(PRODUCTS.windows) }).strict().optional(),
  door: z.object({ product: keyOf(PRODUCTS.doors) }).strict().optional(),
  gutters: z.literal(true).optional()
}).strict().refine(design => Object.keys(design).length > 0);
// The page before option keys sent names; still accepted while old copies stay open in browsers.
const text = max => z.string().trim().max(max).regex(/^[\w\s,.'()&/-]*$/);
const legacySchema = z.object({ siding: text(80), color: text(40), trim: text(40).optional(), roof: text(80).optional() }).strict();
const requestSchema = z.object({
  image: z.string().max(MAX_IMAGE_CHARS).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/),
  design: z.union([designSchema, legacySchema])
}).strict();
// Image models cost more than text: a few concepts per visitor per 10 minutes.
const limiter = createRequestLimiter({ limit: 4 });

// Each door's look matches the colour the 3D house shows for it (DOOR_HEX in house-spec.js).
const DOOR_LOOKS = { steel: 'a deep teal painted finish', fiberglass: 'a medium oak wood-grain finish', wood: 'a rich dark walnut stain' };
const shade = ({ name, hex }) => `${name.toLowerCase()} (${hex})`;

/** One line per change the homeowner chose, in the order a contractor would describe them. */
export function designChanges(design) {
  if (typeof design.siding === 'string') {
    return [`Wall siding: ${design.color.toLowerCase()} ${design.siding.toLowerCase()}.`, design.trim && `Trim: ${design.trim.toLowerCase()}.`, design.roof && `Roof: ${design.roof.toLowerCase()}.`].filter(Boolean);
  }
  const trim = design.trim && TRIM_COLORS[design.trim], frames = trim && ['black', 'bronze'].includes(design.trim) ? trim.name.toLowerCase() : 'white';
  return [
    design.siding && `Wall siding: replace the siding on the walls with ${PRODUCTS.siding[design.siding.product].name.replace(/ siding$/, '')} lap siding in ${shade(COLORS[design.siding.color])}. Leave any brick, stone, stucco, foundation and chimney masonry as it is.`,
    design.roof && `Roof: new CertainTeed architectural asphalt shingles in ${shade(ROOF_COLORS[design.roof.color])}, on the same roof shape.`,
    trim && `Trim: paint the window, door, corner and fascia trim ${shade(trim)}.`,
    design.windows && `Windows: new ${PRODUCTS.windows[design.windows.product].name} windows in the same openings, sizes and grid pattern, with ${frames} frames.`,
    design.door && `Front door: a new ${PRODUCTS.doors[design.door.product].name} with ${DOOR_LOOKS[design.door.product]}, in the same opening.`,
    design.gutters && `Gutters: new seamless gutters and downspouts along the eaves, in ${trim ? trim.name.toLowerCase() : 'white'}.`
  ].filter(Boolean);
}

/** The instruction for the image model: make the chosen changes, keep the house and the photo as they are. */
export function restylePrompt(design) {
  return [
    'Edit this photo of a house to show a finished exterior renovation. Make only these changes:',
    ...designChanges(design).map(line => `- ${line}`),
    'Keep everything else exactly as it is: the same house, its shape, size and proportions, every window and door opening, the camera angle and framing, the time of day and lighting, the sky, trees, landscaping, driveway, cars, people and neighbouring buildings. Do not add or remove windows, doors, rooms, porches, shutters or stories.',
    'The result must look like a real, unretouched photograph taken at the same moment, with the same framing as the original, and no text, labels, borders or watermarks.'
  ].join('\n');
}

export function createVisualizeHandler({
  configured = hasAgentCredentials, allow = limiter, edit = editPhoto,
  models = modelChain(process.env.AI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL, process.env.AI_IMAGE_FALLBACK_MODEL || DEFAULT_FALLBACK_IMAGE_MODEL)
} = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'GET') return res.status(200).json({ available: Boolean(configured()) });
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed.' }); }
    if (!configured()) return res.status(503).json({ code: 'AI_UNAVAILABLE', error: 'Photo concepts are not available here.' });
    let body, image;
    try {
      body = requestSchema.parse(JSON.parse(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null)));
      image = readDataUrl(body.image);
      if (!image.size || image.size.width < 200 || image.size.height < 200) throw new Error('Unreadable image');
    } catch { return res.status(400).json({ code: 'INVALID_REQUEST', error: 'This photo or design could not be read. Use a JPEG, PNG or WebP photo at least 200 pixels across.' }); }
    if (!allow(clientKey(req))) { res.setHeader('Retry-After', '600'); return res.status(429).json({ code: 'RATE_LIMIT', error: 'Photo concept limit reached. Try again in a few minutes.' }); }
    try {
      const result = await edit({ models, prompt: restylePrompt(body.design), image });
      return res.status(200).json({ image: `data:${result.mediaType};base64,${result.base64}`, model: result.model });
    } catch (error) {
      if (!(error instanceof ChainError)) console.warn('photo concept failed', error?.name);
      return res.status(502).json({ code: 'AI_FAILED', error: 'The photo concept could not be made right now. Try again in a minute; your colour preview still works.' });
    }
  };
}
export default createVisualizeHandler();
