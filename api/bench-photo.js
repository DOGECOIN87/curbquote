/** Preview-only model comparison for the AI photo routes. Never merged to main. */
import { generateImage, generateText, Output } from 'ai';
import { readDataUrl, usableImage } from '../lib/image-ai.mjs';
import { READING_PROMPT, READING_SCHEMA, measureReading } from '../lib/photo-measure.mjs';
import { restylePrompt } from './visualize.js';

const ALLOWED = new Set(['google/gemini-2.5-flash-image', 'google/gemini-3.1-flash-image', 'google/gemini-nano-banana-2.1', 'google/gemini-3-pro-image', 'google/gemini-3.1-flash-lite-image', 'openai/gpt-image-2', 'openai/gpt-image-2.5-sunburst', 'openai/gpt-image-2.5-flare', 'openai/gpt-image-1.5', 'bfl/flux-kontext-pro', 'bfl/flux-2-pro', 'bfl/flux-3-image', 'bytedance/seedream-5.0-pro',
  'google/gemini-3-flash', 'google/gemini-3.5-flash', 'google/gemini-3.8-flash', 'google/gemini-3.1-flash-lite', 'google/gemini-3.1-pro-preview', 'openai/gpt-5.4-mini', 'openai/gpt-6-luna', 'openai/gpt-6-sol', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-haiku-5.5']);
export default async (req, res) => {
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  if (process.env.VERCEL_ENV !== 'preview' || req.method !== 'POST') return res.status(404).json({});
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  if (!ALLOWED.has(body?.model)) return res.status(400).json({ error: 'model' });
  const image = readDataUrl(body.image), t0 = Date.now(), abortSignal = AbortSignal.timeout(170000);
  const content = text => [{ role: 'user', content: [{ type: 'text', text }, { type: 'image', image: image.data, mediaType: image.mediaType }] }];
  try {
    if (body.kind === 'measure') {
      const r = await generateText({ model: body.model, maxRetries: 0, abortSignal, temperature: 0, output: Output.object({ schema: READING_SCHEMA }), messages: content(READING_PROMPT) });
      return res.status(200).json({ ms: Date.now() - t0, reading: r.output, measured: measureReading(r.output, image.size), usage: r.usage, gateway: r.providerMetadata?.gateway });
    }
    const prompt = restylePrompt(body.design);
    let file, usage, meta;
    if (body.model.startsWith('google/')) {
      const r = await generateText({ model: body.model, maxRetries: 0, abortSignal, providerOptions: { google: { responseModalities: ['TEXT', 'IMAGE'] } }, messages: content(prompt) });
      file = r.files?.find(f => /^image\//.test(f.mediaType)); usage = r.usage; meta = r.providerMetadata?.gateway;
    } else {
      const r = await generateImage({ model: body.model, maxRetries: 0, abortSignal, prompt: { text: prompt, images: [image.data] }, providerOptions: body.providerOptions || undefined });
      file = r.images?.[0]; usage = r.usage; meta = r.providerMetadata?.gateway ?? r.providerMetadata;
    }
    const ok = usableImage(file, image.size);
    return res.status(200).json({ ms: Date.now() - t0, image: file ? `data:${file.mediaType};base64,${file.base64}` : null, usable: Boolean(ok), size: ok && [ok.width, ok.height], usage, gateway: meta });
  } catch (error) {
    return res.status(200).json({ ms: Date.now() - t0, error: String(error?.message || error).slice(0, 500), name: error?.name, status: error?.statusCode });
  }
};
