/**
 * A photo-real concept of the homeowner's own exterior photo with their chosen siding, colour, trim
 * and roof, made by an image model through the Vercel AI Gateway. Only the homeowner's upload is
 * used (Google imagery may not be modified). Nothing is stored; the picture is illustrative and never
 * feeds the estimate. GET says whether it is available here.
 */
import { generateText } from 'ai';
import { z } from 'zod';
import { hasAgentCredentials } from '../lib/agent.mjs';
import { clientKey, createRequestLimiter } from '../lib/rate-limit.mjs';

export const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image';
// About 2 MB of JPEG once encoded; the page downsizes photos to 1280 px before sending.
export const MAX_IMAGE_CHARS = 2800000;
const text = max => z.string().trim().max(max).regex(/^[\w\s,.'()&/-]*$/);
const requestSchema = z.object({
  image: z.string().max(MAX_IMAGE_CHARS).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/),
  design: z.object({ siding: text(80), color: text(40), trim: text(40).optional(), roof: text(80).optional() }).strict()
}).strict();
// Image models cost more than text: a few concepts per visitor per 10 minutes.
const limiter = createRequestLimiter({ limit: 4 });

/** The instruction for the image model: change the finishes, keep the house and the photo as they are. */
export function restylePrompt({ siding, color, trim, roof }) {
  const changes = [`the wall siding to ${color.toLowerCase()} ${siding.toLowerCase()}`, trim && `the trim to ${trim.toLowerCase()}`, roof && `the roof to ${roof.toLowerCase()}`].filter(Boolean);
  return `Edit this photo of a house exterior. Change ${changes.join(', ')}. Keep everything else exactly as it is: the same house, shape, windows, doors, camera angle, lighting, sky, landscaping and neighbours. Photorealistic, with no text, labels or watermarks.`;
}
export function createVisualizeHandler({ configured = hasAgentCredentials, allow = limiter, generate = generateText, model = process.env.AI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'GET') return res.status(200).json({ available: Boolean(configured()) });
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed.' }); }
    if (!configured()) return res.status(503).json({ code: 'AI_UNAVAILABLE', error: 'Photo concepts are not available here.' });
    let body;
    try { body = requestSchema.parse(JSON.parse(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null))); }
    catch { return res.status(400).json({ code: 'INVALID_REQUEST', error: 'This photo or design could not be read. Use a JPEG, PNG or WebP photo.' }); }
    if (!allow(clientKey(req))) { res.setHeader('Retry-After', '600'); return res.status(429).json({ code: 'RATE_LIMIT', error: 'Photo concept limit reached. Try again in a few minutes.' }); }
    try {
      const [, mediaType, data] = body.image.match(/^data:(image\/\w+);base64,(.+)$/);
      const result = await generate({
        model, maxRetries: 0, abortSignal: AbortSignal.timeout(50000),
        providerOptions: { google: { responseModalities: ['TEXT', 'IMAGE'] } },
        messages: [{ role: 'user', content: [{ type: 'text', text: restylePrompt(body.design) }, { type: 'image', image: data, mediaType }] }]
      });
      const file = result.files?.find(item => /^image\/(png|jpeg|webp)$/.test(item.mediaType));
      if (!file) throw new Error('No image');
      return res.status(200).json({ image: `data:${file.mediaType};base64,${file.base64}` });
    } catch {
      return res.status(502).json({ code: 'AI_FAILED', error: 'The photo concept could not be made right now. Your colour preview still works.' });
    }
  };
}
export default createVisualizeHandler();
