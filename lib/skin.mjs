/**
 * Everything the server and the build make from the skin in use: the colour stylesheet, the app
 * manifest, the page with the company's names filled in, the service worker's file list and the
 * brand images. A skin is one folder in `skins/`; `brand.js` names the one in use (docs/26-skins.md).
 */
import { createHash } from 'node:crypto';
import { access, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { BRAND, possessive } from '../brand.js';
import { colorProblems, rgbList, themeTokens } from '../skin-theme.js';

const root = fileURLToPath(new URL('../', import.meta.url));
/** Drawn for each skin by `npm run build:icons`. */
export const ICON_FILES = Object.freeze(['favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']);
/** Where the page finds the skin's images, whatever the skin: the folder is copied here by the build. */
export const BRAND_PREFIX = 'assets/brand/';
/** The product choices the studio is built around: a skin names and prices each one. */
export const PRODUCT_KEYS = Object.freeze({ siding: ['fiber', 'vinyl'], windows: ['fiberglass', 'wood', 'vinyl'], doors: ['fiberglass', 'steel', 'wood'], roofing: ['architectural'], gutters: ['seamless'] });
// Each trade's rate fields in the estimate form: [trade, field prefix, unit suffix]. The first choice of each trade is its default.
const RATE_FIELDS = Object.freeze([['siding', 'siding', 'PerSqFt'], ['windows', 'window', 'Each'], ['doors', 'door', 'Each'], ['roofing', 'roof', 'PerSquare'], ['gutters', 'gutter', 'PerFt']]);
const DESCRIPTION = 'Plan siding, windows and doors on a 3D view of your home and get an illustrative estimate. No account required.';
const escapeHtml = value => String(value).replace(/[&<>"]/g, mark => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[mark]);

/** The skin's images and fonts, by file name in its folder. */
export function brandFiles(skin = BRAND) {
  const { src, webp, onDark } = skin.logo;
  return [...new Set([src, webp, onDark, ...ICON_FILES, ...(skin.fonts?.faces ?? []).map(face => face.file)].filter(Boolean))];
}
/** Every public path that comes from the skin rather than from a file of the same name. */
export function skinPublicPaths(skin = BRAND) {
  return ['brand.js', 'skin-theme.js', 'skin.css', `skins/${skin.id}/skin.js`, ...brandFiles(skin).map(file => BRAND_PREFIX + file)];
}

/** The colour tokens, logo shape and fonts as a stylesheet, loaded after styles.css. */
export function skinCss(skin = BRAND) {
  const { logo, fonts } = skin;
  const colours = Object.entries(themeTokens(skin)).map(([name, value]) => `${name}:${value};${name}-rgb:${rgbList(value)}`);
  const faces = (fonts?.faces ?? []).map(face => `@font-face{font-family:'${face.family}';src:url(${BRAND_PREFIX}${face.file}) format('woff2');font-weight:${face.weight ?? 400};font-style:${face.style ?? 'normal'};font-display:swap}\n`).join('');
  const rest = [`--logo-crop:${logo.compactCrop ?? 1}`, `--logo-shine:${logo.shine ?? 'none'}`, fonts?.body && `--font:${fonts.body}`, fonts?.accent && `--serif:${fonts.accent}`].filter(Boolean);
  return `/* Made from skins/${skin.id}/skin.js by lib/skin.mjs. Change the skin, not this file. */\n${faces}:root{${[...colours, ...rest].join(';')}}\n${logo.shine ? '' : '.brand-swoosh{display:none}\n'}`;
}

/** The installable app's manifest. Its URLs are relative, so it also works from a GitHub Pages sub-path. */
export function skinManifest(skin = BRAND) {
  const colour = themeTokens(skin)['--forest'], icon = (file, sizes, purpose) => ({ src: BRAND_PREFIX + file, sizes, type: 'image/png', purpose });
  return `${JSON.stringify({
    id: './', name: skin.app.name, short_name: skin.app.shortName, description: skin.app.description ?? DESCRIPTION,
    start_url: './', scope: './', display: 'standalone', orientation: 'any', background_color: colour, theme_color: colour,
    categories: ['lifestyle', 'productivity', 'utilities'],
    icons: [icon('icon-192.png', '192x192', 'any'), icon('icon-512.png', '512x512', 'any'), icon('icon-maskable-512.png', '512x512', 'maskable')]
  }, null, 2)}\n`;
}

/**
 * What index.html's `{{name}}` marks stand for. `{{color:lime}}` gives a colour token's hex value,
 * `{{product:siding.fiber}}` a product's name (`{{short:…}}` its short name, where room is tight) and
 * `{{rate:sidingLowPerSqFt}}` a default product's standard rate.
 */
export function pageValues(skin = BRAND) {
  const { company, app, logo, offices } = skin, theme = themeTokens(skin), products = skin.catalog.products;
  const lines = Object.entries(products).flatMap(([trade, choices]) => Object.entries(choices).flatMap(([key, line]) => [[`product:${trade}.${key}`, line.name], [`short:${trade}.${key}`, line.short ?? line.name]]));
  const rates = RATE_FIELDS.flatMap(([trade, prefix, unit]) => { const [low, high] = products[trade][PRODUCT_KEYS[trade][0]].rates; return [[`rate:${prefix}Low${unit}`, low], [`rate:${prefix}High${unit}`, high]]; });
  return {
    id: skin.id, company: company.name, companyOwner: possessive(company.name), short: company.short, shortOwner: possessive(company.short),
    legalName: company.legalName ?? company.name, website: company.website, websiteLabel: new URL(company.website).host.replace(/^www\./, ''),
    terms: company.terms, privacy: company.privacy, trust: company.trust ?? '', trustSentence: company.trustSentence ?? '',
    appTitle: app.title, appShortName: app.shortName, themeColor: theme['--forest'],
    phone: offices[0].phone, tel: offices[0].tel,
    logo: BRAND_PREFIX + logo.src, logoOnDark: BRAND_PREFIX + (logo.onDark ?? logo.src), logoWidth: logo.width, logoHeight: logo.height,
    // What the "try this" chip asks the photo concept for: the default siding, named as siding.
    sidingChange: `${products.siding.fiber.name.replace(/ siding$/i, '')} siding`,
    ...Object.fromEntries([...lines, ...rates]),
    ...Object.fromEntries(Object.entries(theme).map(([name, value]) => [`color:${name.slice(2)}`, value]))
  };
}
/** index.html with the skin's names, links, logo and colours filled in. An unknown mark is an error, not a blank. */
export function renderPage(html, skin = BRAND) {
  const values = pageValues(skin);
  // `{{{logoWebp}}}` is the one mark that stands for markup: the smaller WebP logo, when the skin has one.
  const markup = { logoWebp: skin.logo.webp ? `<source srcset="${escapeHtml(BRAND_PREFIX + skin.logo.webp)}" type="image/webp">` : '' };
  return html.replace(/\{\{\{(\w+)\}\}\}|\{\{([\w:.-]+)\}\}/g, (mark, markupKey, key) => {
    const found = markupKey ? markup[markupKey] : values[key];
    if (found === undefined) throw new Error(`index.html uses ${mark}, which the skin does not provide.`);
    return markupKey ? found : escapeHtml(found);
  });
}

/** A short fingerprint of the skin's settings and images, so a rebrand replaces what phones have cached. */
export async function skinStamp(skin = BRAND, from = root) {
  const hash = createHash('sha1').update(JSON.stringify(skin));
  for (const file of brandFiles(skin)) hash.update(await readFile(join(from, 'skins', skin.id, file)));
  return `${skin.id}-${hash.digest('hex').slice(0, 8)}`;
}
/** sw.js with the skin's files in its offline list and the skin's fingerprint in its cache name. */
export function renderWorker(source, skin, stamp) {
  const files = brandFiles(skin).filter(file => !ICON_FILES.includes(file) || /^icon-(192|512)\.png$/.test(file)).map(file => `, '${BRAND_PREFIX}${file}'`).join('');
  if (!source.includes("/*skin*/''") || !source.includes('/*brand-files*/')) throw new Error('sw.js changed; update renderWorker in lib/skin.mjs.');
  return source.replace("/*skin*/''", `'-${stamp}'`).replace('/*brand-files*/', files);
}

/**
 * The bytes for a public path that comes from the skin, or null when the path is an ordinary file.
 * The development server and the build both ask here, so they can't drift apart.
 */
export async function skinAsset(path, skin = BRAND, from = root) {
  if (path === 'skin.css') return Buffer.from(skinCss(skin));
  if (path === 'manifest.webmanifest') return Buffer.from(skinManifest(skin));
  if (path === 'index.html') return Buffer.from(renderPage(await readFile(join(from, path), 'utf8'), skin));
  if (path === 'sw.js') return Buffer.from(renderWorker(await readFile(join(from, path), 'utf8'), skin, await skinStamp(skin, from)));
  // Previewing another skin (`SKIN=example npm run dev`) points the browser's brand.js at it.
  if (path === 'brand.js' && skin.id !== BRAND.id) return Buffer.from((await readFile(join(from, path), 'utf8')).replace(`./skins/${BRAND.id}/skin.js`, `./skins/${skin.id}/skin.js`));
  if (path.startsWith(BRAND_PREFIX) && brandFiles(skin).includes(path.slice(BRAND_PREFIX.length))) return readFile(join(from, 'skins', skin.id, path.slice(BRAND_PREFIX.length)));
  return null;
}

export async function listSkins(from = root) {
  return (await readdir(join(from, 'skins'), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
}
export async function loadSkin(id) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(id))) throw new Error(`"${id}" is not a skin name. Skins are folders in skins/, named in lowercase letters, digits and dashes.`);
  try { return (await import(`../skins/${id}/skin.js`)).default; }
  catch (error) { throw new Error(`No skin named "${id}": skins/${id}/skin.js could not be read (${error.message}).`); }
}

const filled = value => typeof value === 'string' && value.trim().length > 0;
const webLink = value => filled(value) && /^https:\/\/[^\s"<>]+$/.test(value);
const imageFile = value => filled(value) && /^[\w.-]+\.(png|webp|svg|jpg)$/.test(value);
/**
 * What is wrong with a skin, as plain sentences; empty when it is ready to use. Checks the names and
 * links, the logo, that text stays readable on the colours, the offices and that every product has a
 * name and a price range. With `files: true` it also checks that the images exist.
 */
export async function skinProblems(skin, { folder = skin?.id, files = true, from = root } = {}) {
  const problems = [], need = (ok, message) => { if (!ok) problems.push(message); };
  if (!skin || typeof skin !== 'object') return ['The skin must export an object as its default.'];
  need(/^[a-z0-9][a-z0-9-]*$/.test(String(skin.id)) && skin.id === folder, `id: must be "${folder}", the name of the skin's folder.`);
  const { company = {}, app = {}, logo = {}, offices, catalog = {}, serviceArea, fonts } = skin;
  for (const key of ['name', 'short']) need(filled(company[key]), `company.${key}: add the company's ${key === 'short' ? 'short name' : 'name'}.`);
  for (const key of ['website', 'terms', 'privacy']) need(webLink(company[key]), `company.${key}: must be an https:// link.`);
  for (const key of ['name', 'shortName', 'title']) need(filled(app[key]), `app.${key}: add the app's ${key}.`);
  need(imageFile(logo.src), 'logo.src: name the logo file (PNG, WebP, SVG or JPEG) in the skin folder.');
  for (const key of ['webp', 'onDark']) need(logo[key] === undefined || imageFile(logo[key]), `logo.${key}: must name an image file in the skin folder.`);
  need(logo.width > 0 && logo.height > 0, 'logo.width and logo.height: add the logo image\'s size in pixels.');
  need(logo.compactCrop === undefined || (logo.compactCrop > .3 && logo.compactCrop <= 1), 'logo.compactCrop: must be between 0.3 and 1 (the share of the logo\'s height shown on phones).');
  need(logo.shine === undefined || /^polygon\([\d\s.%,]+\)$/.test(logo.shine), 'logo.shine: must be a CSS polygon() in percentages, or left out.');
  problems.push(...colorProblems(skin));
  need(Array.isArray(offices) && offices.length > 0, 'offices: add at least one office with a name and phone number.');
  for (const [at, office] of (Array.isArray(offices) ? offices : []).entries()) {
    need(filled(office.name) && filled(office.phone), `offices[${at}]: add a name and a phone number as shown to customers.`);
    need(/^\+?\d{7,15}$/.test(String(office.tel)), `offices[${at}].tel: the number to dial, digits only.`);
  }
  need(filled(catalog.version), 'catalog.version: add a version name; saved estimates record it.');
  for (const [trade, keys] of Object.entries(PRODUCT_KEYS)) for (const key of keys) {
    const product = catalog.products?.[trade]?.[key], [low, high] = product?.rates ?? [];
    need(filled(product?.name) && low > 0 && high >= low, `catalog.products.${trade}.${key}: add a name and rates as [low, high].`);
  }
  for (const [trade, lines] of Object.entries(catalog.products ?? {})) for (const key of Object.keys(lines)) need(PRODUCT_KEYS[trade]?.includes(key), `catalog.products.${trade}.${key}: the studio has no such choice; use ${PRODUCT_KEYS[trade]?.join(', ') ?? 'siding, windows, doors, roofing or gutters'}.`);
  if (serviceArea) need(filled(serviceArea.description), 'serviceArea.description: describe the area in a few words, or leave serviceArea out.');
  for (const stack of [fonts?.body, fonts?.accent]) need(stack === undefined || /^[\w\s,'-]+$/.test(stack), 'fonts: a font list may hold only names, commas and quotes.');
  for (const face of fonts?.faces ?? []) need(filled(face.family) && /^[\w.-]+\.woff2$/.test(String(face.file)), 'fonts.faces: each needs a family and a .woff2 file in the skin folder.');
  if (files && !problems.length) for (const file of brandFiles(skin)) {
    await access(join(from, 'skins', skin.id, file)).catch(() => problems.push(`${file}: missing from skins/${skin.id}/.${ICON_FILES.includes(file) ? ' Run `npm run build:icons`.' : ''}`));
  }
  return problems;
}
