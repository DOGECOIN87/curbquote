/** Preview-only model comparison for the AI photo routes (GET, JSON only). Never merged to main. */
import { generateImage, generateText, Output } from 'ai';
import { z } from 'zod';
import { imageSize, usableImage } from '../lib/image-ai.mjs';
import { READING_PROMPT, READING_SCHEMA, measureReading } from '../lib/photo-measure.mjs';
import { designChanges, restylePrompt } from './visualize.js';

const PHOTOS = { 1: 'siding_gallery_1_iorrzy0m4scxdp4xtnddr', 2: 'siding_gallery_2_uat3z0rdopnvwlf4hyy4', 3: 'siding_gallery_3_6wimfuvbiivj9xmmhwqe39', 5: 'siding_gallery_5_zgix9rqm3hsyzy1lpb2zp', 7: 'siding_gallery_7_zp6nprywfw9f6xsmhaz516' };
const DESIGNS = {
  1: { siding: { product: 'fiber', color: 'cream' }, roof: { color: 'charcoal' }, trim: 'white', windows: { product: 'fiberglass' }, door: { product: 'steel' }, gutters: true },
  2: { siding: { product: 'fiber', color: 'sage' }, roof: { color: 'weathered' }, trim: 'white', door: { product: 'fiberglass' } },
  7: { siding: { product: 'vinyl', color: 'slate' }, roof: { color: 'onyx' }, trim: 'black', windows: { product: 'vinyl' }, gutters: true }
};
const JUDGE = z.object({ changesApplied: z.number().min(0).max(10), colourAccuracy: z.number().min(0).max(10), housePreserved: z.number().min(0).max(10), sceneUnchanged: z.number().min(0).max(10), photoRealism: z.number().min(0).max(10), problems: z.string() });
const judgePrompt = changes => `Image 1 is a homeowner's original photo. Image 2 should be the same photo edited to show only these changes:\n${changes.map(l => `- ${l}`).join('\n')}\nScore image 2 strictly, 0 to 10 each: changesApplied (every requested change is visible), colourAccuracy (colours match the names and hex codes), housePreserved (same house shape, windows, doors, roofline, porch, proportions), sceneUnchanged (same framing, camera angle, sky, trees, lighting, cars, neighbours), photoRealism (looks like a real unretouched photo: no smears, warped lines, melted details, text or artifacts). In "problems", list the specific defects in under 40 words.`;
const load = async n => { const r = await fetch(`https://cdn.truspeed.io/${PHOTOS[n]}.jpg`); const bytes = Buffer.from(await r.arrayBuffer()); return { data: bytes.toString('base64'), mediaType: 'image/jpeg', bytes, size: imageSize(bytes) }; };
const msg = (text, ...images) => [{ role: 'user', content: [{ type: 'text', text }, ...images.map(i => ({ type: 'image', image: i.data, mediaType: i.mediaType }))] }];

async function concept(model, image, design) {
  const t0 = Date.now(), abortSignal = AbortSignal.timeout(150000), prompt = restylePrompt(design);
  let file, gateway;
  if (model.startsWith('google/')) {
    const r = await generateText({ model, maxRetries: 0, abortSignal, providerOptions: { google: { responseModalities: ['TEXT', 'IMAGE'] } }, messages: msg(prompt, image) });
    file = r.files?.find(f => /^image\//.test(f.mediaType)); gateway = r.providerMetadata?.gateway;
  } else {
    const r = await generateImage({ model, maxRetries: 0, abortSignal, prompt: { text: prompt, images: [image.data] } });
    file = r.images?.[0]; gateway = r.providerMetadata?.gateway;
  }
  return { ms: Date.now() - t0, file, usable: usableImage(file, image.size), cost: gateway?.cost ?? gateway?.marketCost ?? null };
}
async function judge(judgeModel, image, file, design) {
  const r = await generateText({ model: judgeModel, maxRetries: 1, abortSignal: AbortSignal.timeout(90000), temperature: 0, output: Output.object({ schema: JUDGE }), messages: msg(judgePrompt(designChanges(design)), image, { data: file.base64, mediaType: file.mediaType }) });
  return r.output;
}
export default async (req, res) => {
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  if (process.env.VERCEL_ENV !== 'preview') return res.status(404).json({});
  const q = new URL(req.url, 'http://x').searchParams, models = (q.get('models') || '').split(',').filter(Boolean);
  if (q.get('kind') === 'measure') {
    const photos = (q.get('photos') || '1,2,3,5,7').split(','), images = Object.fromEntries(await Promise.all(photos.map(async n => [n, await load(n)])));
    const rows = await Promise.all(photos.flatMap(n => models.map(async model => {
      const t0 = Date.now();
      try {
        const r = await generateText({ model, maxRetries: 0, abortSignal: AbortSignal.timeout(120000), temperature: 0, output: Output.object({ schema: READING_SCHEMA }), messages: msg(READING_PROMPT, images[n]) });
        const m = measureReading(r.output, images[n].size);
        return { photo: n, model, s: Math.round((Date.now() - t0) / 100) / 10, cost: r.providerMetadata?.gateway?.cost ?? null, view: m.view, stories: m.stories, windows: m.windows, doors: m.entryDoors, garage: m.garageDoors, scale: m.scale, wallFt: m.wallFt, storyFt: m.storyHeightFt, gableFt: m.gableRiseFt, masonry: m.masonryPercent, siding: m.currentSiding, roof: m.roofShape, conf: m.confidence, door: r.output.entryDoor, garageBox: r.output.garageDoor, wall: r.output.wall };
      } catch (error) { return { photo: n, model, s: Math.round((Date.now() - t0) / 100) / 10, error: String(error?.message || error).slice(0, 200) }; }
    })));
    return res.status(200).json(rows);
  }
  const n = q.get('photo') || '1', image = await load(n), design = DESIGNS[n], judges = (q.get('judges') || 'anthropic/claude-opus-5.5,openai/gpt-6-sol').split(',');
  const rows = await Promise.all(models.map(async model => {
    try {
      const c = await concept(model, image, design);
      const row = { model, s: Math.round(c.ms / 100) / 10, cost: c.cost, usable: Boolean(c.usable), size: c.file && imageSize(Buffer.from(c.file.base64, 'base64')), kb: c.file && Math.round(c.file.base64.length * .75 / 1024) };
      if (c.file) row.scores = await Promise.all(judges.map(j => judge(j, image, c.file, design).then(o => ({ judge: j, ...o })).catch(e => ({ judge: j, error: String(e?.message || e).slice(0, 120) }))));
      return row;
    } catch (error) { return { model, error: String(error?.message || error).slice(0, 300), status: error?.statusCode }; }
  }));
  return res.status(200).json({ photo: n, input: image.size, rows });
};
