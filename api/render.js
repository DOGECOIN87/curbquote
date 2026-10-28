/**
 * A general ChatGPT image route for later features: generate a new image from a prompt, or edit
 * one supplied image (the homeowner's own upload — Google imagery may not be modified), through
 * the Vercel AI Gateway. Nothing is stored. Kept separate from api/visualize.js, which is the
 * fixed-design photo-concept flow; this route takes a free prompt so future tools (roof/siding
 * renders, scene mock-ups) can share one guarded, rate-limited door. GET says whether it is
 * available here.
 */
import { generateImage } from 'ai';
import { z } from 'zod';
import { hasAgentCredentials } from '../lib/agent.mjs';
import { clientKey, createRequestLimiter } from '../lib/rate-limit.mjs';

export const DEFAULT_CHATGPT_IMAGE_MODEL = 'openai/gpt-image-1';
// About 2 MB of JPEG once encoded; callers downsize photos before sending.
export const MAX_IMAGE_CHARS = 2800000;
export const RENDER_SIZES = Object.freeze(['1024x1024', '1024x1536', '1536x1024', 'auto']);
const requestSchema = z.object({
  prompt: z.string().trim().min(10).max(800).regex(/^[\w\s,.'()&/:;!?#%+-]*$/),
  image: z.string().max(MAX_IMAGE_CHARS).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/).optional(),
  size: z.enum(RENDER_SIZES).optional()
}).strict();
// Image generation is the priciest call in the app: a few renders per visitor per 10 minutes.
const limiter = createRequestLimiter({ limit: 3 });

/** The default generator: one image from the Gateway's OpenAI image model, edits included. */
async function gatewayGenerate({ model, prompt, image, size, abortSignal }) {
  const result = await generateImage({
    model, maxRetries: 0, abortSignal,
    prompt: image ? { text: prompt, images: [image.data] } : prompt,
    size: !size || size === 'auto' ? undefined : size
  });
  const file = result.images?.[0] ?? result.image ?? null;
  return { images: file ? [file] : [] };
}
export function createRenderHandler({ configured = hasAgentCredentials, allow = limiter, generate = gatewayGenerate, model = process.env.AI_CHATGPT_IMAGE_MODEL || DEFAULT_CHATGPT_IMAGE_MODEL } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'GET') return res.status(200).json({ available: Boolean(configured()) });
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed.' }); }
    if (!configured()) return res.status(503).json({ code: 'AI_UNAVAILABLE', error: 'Image rendering is not available here.' });
    let body;
    try { body = requestSchema.parse(JSON.parse(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null))); }
    catch { return res.status(400).json({ code: 'INVALID_REQUEST', error: 'This render request could not be read. Send a prompt (10-800 characters) and optionally a JPEG, PNG or WebP image.' }); }
    if (!allow(clientKey(req))) { res.setHeader('Retry-After', '600'); return res.status(429).json({ code: 'RATE_LIMIT', error: 'Render limit reached. Try again in a few minutes.' }); }
    try {
      const image = body.image ? { mediaType: body.image.match(/^data:(image\/\w+);base64,/)[1], data: body.image.split(',')[1] } : null;
      const result = await generate({ model, prompt: body.prompt, image, size: body.size || '1024x1024', abortSignal: AbortSignal.timeout(55000) });
      const file = result.images?.find(item => /^image\/(png|jpeg|webp)$/.test(item.mediaType) && item.base64);
      if (!file) throw new Error('No image');
      return res.status(200).json({ image: `data:${file.mediaType};base64,${file.base64}` });
    } catch {
      return res.status(502).json({ code: 'AI_FAILED', error: 'The render could not be made right now.' });
    }
  };
}
export default createRenderHandler();
