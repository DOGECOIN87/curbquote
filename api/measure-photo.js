/**
 * "Measure my photo": a vision model reads the homeowner's own exterior photo (stories, windows,
 * doors, the wall facing the camera and its doors), and lib/photo-measure.mjs turns that into
 * estimate inputs using standard door sizes as the scale. The page shows the reading and the
 * homeowner chooses to use it; nothing is stored. Only the homeowner's upload is read (Google
 * imagery may not be analysed). GET says whether it is available here.
 */
import { Output } from 'ai';
import { z } from 'zod';
import { hasAgentCredentials } from '../lib/agent.mjs';
import { ChainError, modelChain, readDataUrl, readPhoto } from '../lib/image-ai.mjs';
import { READING_PROMPT, READING_SCHEMA, measureReading } from '../lib/photo-measure.mjs';
import { clientKey, createRequestLimiter } from '../lib/rate-limit.mjs';
import { MAX_IMAGE_CHARS } from './visualize.js';

export const DEFAULT_VISION_MODEL = 'google/gemini-3-flash';
export const DEFAULT_FALLBACK_VISION_MODEL = 'openai/gpt-5.4-mini';
const requestSchema = z.object({ image: z.string().max(MAX_IMAGE_CHARS).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/) }).strict();
// Readings cost a fraction of a cent, but each one is a model call: a handful per visitor per 10 minutes.
const limiter = createRequestLimiter({ limit: 8 });

export function createMeasurePhotoHandler({
  configured = hasAgentCredentials, allow = limiter, read = readPhoto,
  models = modelChain(process.env.AI_VISION_MODEL || DEFAULT_VISION_MODEL, process.env.AI_VISION_FALLBACK_MODEL || DEFAULT_FALLBACK_VISION_MODEL)
} = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'GET') return res.status(200).json({ available: Boolean(configured()) });
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed.' }); }
    if (!configured()) return res.status(503).json({ code: 'AI_UNAVAILABLE', error: 'Photo measuring is not available here.' });
    let image;
    try {
      image = readDataUrl(requestSchema.parse(JSON.parse(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null))).image);
      if (!image.size || image.size.width < 200 || image.size.height < 200) throw new Error('Unreadable image');
    } catch { return res.status(400).json({ code: 'INVALID_REQUEST', error: 'This photo could not be read. Use a JPEG, PNG or WebP photo at least 200 pixels across.' }); }
    if (!allow(clientKey(req))) { res.setHeader('Retry-After', '600'); return res.status(429).json({ code: 'RATE_LIMIT', error: 'Photo measuring limit reached. Try again in a few minutes.' }); }
    try {
      const { reading, model } = await read({ models, prompt: READING_PROMPT, image, output: Output.object({ schema: READING_SCHEMA }) });
      if (!reading.houseExterior) return res.status(422).json({ code: 'NOT_A_HOUSE', error: 'This photo doesn’t look like the outside of a house. Try a clear photo of one side of your home, taken from the street or yard.' });
      return res.status(200).json({ measured: measureReading(reading, image.size), model });
    } catch (error) {
      if (!(error instanceof ChainError)) console.warn('photo measuring failed', error?.name);
      return res.status(502).json({ code: 'AI_FAILED', error: 'Your photo could not be measured right now. Try again in a minute, or enter the details yourself.' });
    }
  };
}
export default createMeasurePhotoHandler();
