/**
 * Shared by the AI photo routes (api/visualize, api/measure-photo). Each request walks a short chain
 * of Gateway models, so one model's outage, refusal or unusable answer falls through to the next
 * instead of failing the homeowner, and every image that comes back is checked before it is shown.
 * Only the homeowner's own upload is ever sent (Google imagery may not be analysed or modified).
 */
import { generateImage, generateText } from 'ai';

/** Width and height from a PNG, JPEG or WebP header, or null when the bytes are not one of those. */
export function imageSize(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const u16 = i => (b[i] << 8) | b[i + 1], u32 = i => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const tag = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length > 24 && tag(1, 3) === 'PNG') return { width: u32(16), height: u32(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 8 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; }
      // Start-of-frame segments (not DHT, JPG or DAC) carry the size: FF Cn length precision height width.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: u16(i + 7), height: u16(i + 5) };
      i += 2 + u16(i + 2);
    }
    return null;
  }
  if (b.length > 30 && tag(0, 4) === 'RIFF' && tag(8, 4) === 'WEBP') {
    const kind = tag(12, 4);
    if (kind === 'VP8X') return { width: 1 + (b[24] | b[25] << 8 | b[26] << 16), height: 1 + (b[27] | b[28] << 8 | b[29] << 16) };
    if (kind === 'VP8L') { const bits = (b[21] | b[22] << 8 | b[23] << 16 | b[24] << 24) >>> 0; return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) }; }
    if (kind === 'VP8 ') return { width: (b[26] | b[27] << 8) & 0x3fff, height: (b[28] | b[29] << 8) & 0x3fff };
  }
  return null;
}

/** `data:image/...;base64,...` → { mediaType, data, bytes, size }. The route schemas have already checked the form. */
export function readDataUrl(dataUrl) {
  const [, mediaType, data] = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  const bytes = Buffer.from(data, 'base64');
  return { mediaType, data, bytes, size: imageSize(bytes) };
}

/** The models to try, in order, without repeats: the primary, its fallback, then the primary once more if time allows. */
export function modelChain(primary, fallback) {
  return fallback && fallback !== primary ? [primary, fallback, primary] : [primary, primary];
}

/** Gemini image models answer through the language-model API; the others are dedicated image models. */
const answersAsText = model => model.startsWith('google/');
const IMAGE_TYPE = /^image\/(png|jpeg|webp)$/;

async function editOnce({ model, prompt, image, abortSignal, text, picture }) {
  if (answersAsText(model)) {
    const result = await text({
      model, maxRetries: 0, abortSignal,
      providerOptions: { google: { responseModalities: ['TEXT', 'IMAGE'] } },
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image', image: image.data, mediaType: image.mediaType }] }]
    });
    return result.files?.find(file => IMAGE_TYPE.test(file.mediaType));
  }
  // OpenAI's PNGs of a 1536 px photo run to 3 MB, close to Vercel's 4.5 MB response limit once encoded; JPEG is a fraction of that.
  const providerOptions = model.startsWith('openai/') ? { openai: { output_format: 'jpeg', output_compression: 90 } } : undefined;
  const result = await picture({ model, maxRetries: 0, abortSignal, providerOptions, prompt: { text: prompt, images: [image.data] } });
  return (result.images ?? [result.image]).find(file => file && IMAGE_TYPE.test(file.mediaType));
}

/**
 * The returned picture must be a real image at least 256 px a side, framed like the homeowner's photo
 * (within about 25% of its aspect ratio), so a crop, a blank or a different scene is never shown.
 */
export function usableImage(file, input) {
  if (!file?.base64 || !IMAGE_TYPE.test(file.mediaType)) return null;
  const size = imageSize(file.uint8Array ?? Buffer.from(file.base64, 'base64'));
  if (!size || size.width < 256 || size.height < 256) return null;
  if (input?.width && input?.height && Math.abs(Math.log((size.width / size.height) / (input.width / input.height))) > 0.25) return null;
  return { mediaType: file.mediaType, base64: file.base64, ...size };
}

/** Thrown when every model in the chain failed; `tried` lists each model and why, for the logs. */
export class ChainError extends Error {
  constructor(tried) { super('Every model in the chain failed.'); this.tried = tried; }
}
const reasonOf = error => error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timed out' : String(error?.statusCode || error?.name || 'error');

/**
 * Edits the photo with the first model in the chain that returns a usable image. Each attempt gets
 * at most `attemptMs`, and the chain stops before `budgetMs` so the function never outlives its
 * Vercel limit.
 */
export async function editPhoto({ models, prompt, image, budgetMs = 100000, attemptMs = 45000, text = generateText, picture = generateImage, now = Date.now, log = console.warn }) {
  const start = now(), tried = [];
  for (const model of models) {
    const left = budgetMs - (now() - start);
    if (left < 10000) break;
    try {
      const file = usableImage(await editOnce({ model, prompt, image, abortSignal: AbortSignal.timeout(Math.min(attemptMs, left)), text, picture }), image.size);
      if (file) return { ...file, model, attempts: tried.length + 1 };
      tried.push(`${model}: no usable image`);
    } catch (error) { tried.push(`${model}: ${reasonOf(error)}`); }
    log(`photo concept attempt failed (${tried.at(-1)})`);
  }
  throw new ChainError(tried);
}

/**
 * Reads the photo with the first model in the chain whose answer passes `schema` (an AI SDK Output).
 * Used for measuring: the answer is a structured reading, never free text.
 */
export async function readPhoto({ models, prompt, image, output, budgetMs = 50000, attemptMs = 25000, text = generateText, now = Date.now, log = console.warn }) {
  const start = now(), tried = [];
  for (const model of models) {
    const left = budgetMs - (now() - start);
    if (left < 6000) break;
    try {
      const result = await text({
        model, maxRetries: 0, abortSignal: AbortSignal.timeout(Math.min(attemptMs, left)), output, temperature: 0,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image', image: image.data, mediaType: image.mediaType }] }]
      });
      if (result.output) return { reading: result.output, model, attempts: tried.length + 1 };
      tried.push(`${model}: no reading`);
    } catch (error) { tried.push(`${model}: ${reasonOf(error)}`); }
    log(`photo reading attempt failed (${tried.at(-1)})`);
  }
  throw new ChainError(tried);
}
