import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRAND, THEME, possessive } from '../brand.js';
import { colorProblems, contrast, themeTokens } from '../skin-theme.js';
import { BRAND_PREFIX, ICON_FILES, brandFiles, listSkins, loadSkin, renderPage, renderWorker, skinCss, skinManifest, skinProblems, skinStamp } from '../lib/skin.mjs';
import { createAppServer } from '../lib/web.mjs';
import { buildPublicAssets } from '../scripts/build.mjs';
import { defaultIconSvg, iconSvg } from '../scripts/build-icons.mjs';
import { DEFAULT_INPUT } from '../estimate.js';
import { CATALOG_VERSION, DEFAULT_PROJECT, PRODUCTS, catalogRates } from '../project.js';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
// What only Alco's skin may say: its names, product lines and phone numbers.
// Set by scripts while the page runs, so no stylesheet defines them.
const SCRIPT_SET = new Set(['--bearing', '--rise', '--swatch', '--plank', '--plank-shade', '--controls-bottom']);
const ALCO_ONLY = /\balco|james hardie|certainteed|marvin|provia|vytex|593-1691|534-3349|3015931691|7035343349/i;

test('every skin in skins/ is complete: names, links, logo files, readable colours, offices and a priced catalog', async () => {
  const skins = await listSkins();
  assert.ok(skins.includes(BRAND.id), 'brand.js points at a skin that exists');
  assert.ok(skins.length >= 2, 'a second skin proves the app is not tied to one brand');
  for (const id of skins) assert.deepEqual(await skinProblems(await loadSkin(id), { folder: id }), [], id);
  assert.match((await read('brand.js')).match(/from '\.\/skins\/([a-z0-9-]+)\/skin\.js';/)[1], new RegExp(`^${BRAND.id}$`), 'one line in brand.js names the skin in use');
  await assert.rejects(loadSkin('../secrets'), /not a skin name/);
  await assert.rejects(loadSkin('missing'), /No skin named "missing"/);
});

test('a skin that would be hard to read, or is missing parts, is reported in plain words', async () => {
  const example = await loadSkin('example'), change = patch => ({ ...example, ...patch });
  assert.match((await skinProblems(change({ colors: { dark: '#14213d', primary: '#f6e58d', accent: '#f6a821' } }))).join('\n'), /primary-coloured text on white is hard to read/);
  assert.match((await skinProblems(change({ colors: { dark: '#f4f4f4', primary: '#1d4e89', accent: '#f6a821' } }))).join('\n'), /light text on the dark colour is hard to read/);
  assert.match((await skinProblems(change({ colors: { dark: 'navy', primary: '#1d4e89', accent: '#f6a821' } }))).join('\n'), /"dark" must be a six-digit hex colour/);
  assert.match((await skinProblems(change({ company: { ...example.company, website: 'example.com' } }))).join('\n'), /company\.website: must be an https:\/\/ link/);
  assert.match((await skinProblems(change({ offices: [] }))).join('\n'), /offices: add at least one office/);
  assert.match((await skinProblems(change({ logo: { ...example.logo, src: 'missing.png' } }))).join('\n'), /missing\.png: missing from skins\/example\//);
  assert.match((await skinProblems(change({ logo: { ...example.logo, shine: 'url(evil)' } }))).join('\n'), /logo\.shine: must be a CSS polygon/);
  const noDoor = structuredClone(example.catalog); delete noDoor.products.doors.steel; noDoor.products.siding.stucco = { name: 'Stucco', rates: [1, 2] };
  const catalog = (await skinProblems(change({ catalog: noDoor }))).join('\n');
  assert.match(catalog, /catalog\.products\.doors\.steel: add a name and rates/);
  assert.match(catalog, /catalog\.products\.siding\.stucco: the studio has no such choice/);
  assert.match((await skinProblems(change({ id: 'other' }), { folder: 'example' })).join('\n'), /id: must be "example"/);
});

test('three colours make a full, readable theme, and a skin can pin any shade exactly', async () => {
  const alco = await loadSkin('alco'), derived = { colors: { dark: alco.colors.dark, primary: alco.colors.primary, accent: alco.colors.accent } };
  assert.deepEqual(colorProblems(derived), []);
  assert.deepEqual(Object.keys(themeTokens(derived)), Object.keys(themeTokens(alco)), 'the same tokens with or without pinned shades');
  // Alco's pinned shades are the ones the app has always used.
  const theme = themeTokens(alco);
  assert.equal(theme['--forest'], '#13241c'); assert.equal(theme['--studio-green'], '#2f6621'); assert.equal(theme['--lime'], '#89c63f');
  assert.equal(theme['--brand-900'], '#102303'); assert.equal(theme['--studio-lime'], '#8fcd4f'); assert.equal(theme['--on-primary'], '#ffffff'); assert.equal(theme['--on-accent'], '#13241c');
  // Text on the accent flips to white when the accent is dark.
  assert.equal(themeTokens({ colors: { dark: '#1a1a2e', primary: '#16213e', accent: '#7a1f3d' } })['--on-accent'], '#ffffff');
  assert.ok(contrast('#ffffff', '#000000') > 20.9 && contrast('#777777', '#777777') === 1);
  assert.equal(THEME['--lime'], themeTokens(BRAND)['--lime']);
  assert.equal(possessive('Alco'), "Alco's"); assert.equal(possessive('Alco Products'), "Alco Products'");
});

test('the skin stylesheet defines every colour the app\'s stylesheet and page ask for', async () => {
  const styles = await read('styles.css'), page = await read('index.html');
  for (const id of await listSkins()) {
    const skin = await loadSkin(id), css = skinCss(skin);
    const defined = new Set([...`${styles}\n${css}`.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
    for (const [, name] of styles.matchAll(/var\((--[\w-]+)/g)) assert.ok(defined.has(name) || SCRIPT_SET.has(name), `${id}: styles.css uses ${name}, which nothing defines`);
    for (const [, name] of page.matchAll(/\{\{color:([\w-]+)\}\}/g)) assert.ok(defined.has(`--${name}`), `${id}: index.html uses {{color:${name}}}`);
    assert.match(css, new RegExp(`--lime:${skin.colors.accent};--lime-rgb:\\d+,\\d+,\\d+`), 'each colour comes with an -rgb twin for see-through shades');
    assert.doesNotMatch(css, /[<>]|url\((?!assets\/brand\/)/, 'nothing but colours, the logo shape and the skin\'s own fonts');
  }
  // The brand colours live in the skin only: the app's stylesheet must not define them again.
  assert.doesNotMatch(styles, /--(?:forest|lime|studio-green|studio-lime|brand-\d+)\s*:\s*#/);
  assert.match(skinCss(await loadSkin('alco')), /--logo-crop:0\.8;--logo-shine:polygon\(0 66%,76% 54\.6%,0 81\.2%\)/);
  const example = skinCss(await loadSkin('example'));
  assert.match(example, /--logo-crop:1;--logo-shine:none;--serif:Georgia, 'Times New Roman', serif\}/); assert.match(example, /\.brand-swoosh\{display:none\}/, 'no light sweep without a shape for it');
});

test('the page is filled in from the skin: Alco\'s names for Alco, and none of them for another skin', async () => {
  const source = await read('index.html'), alco = renderPage(source, await loadSkin('alco')), example = renderPage(source, await loadSkin('example'));
  assert.doesNotMatch(source, ALCO_ONLY, 'index.html itself names no company');
  for (const page of [alco, example]) assert.doesNotMatch(page, /\{\{|\}\}/, 'every mark is filled in');
  assert.match(alco, /<title>CurbQuote by Alco Products — Know the scope before the quote<\/title>/);
  assert.match(alco, /<meta name="theme-color" content="#13241c">/);
  assert.match(alco, /<source srcset="assets\/brand\/logo\.webp" type="image\/webp"><img class="brand-logo" src="assets\/brand\/logo\.png" width="300" height="176" alt="Alco Products Company, Inc\. home">/);
  assert.match(alco, /href="tel:3015931691" data-brand-tel>Call Alco Products on <span data-brand-phone>\(301\) 593-1691<\/span>/);
  assert.match(alco, /I agree to Alco Products' <a href="https:\/\/www\.alcoproductsinc\.com\/terms"/);
  assert.match(alco, /<option value="fiber" selected>James Hardie fiber cement<\/option><option value="vinyl">CertainTeed vinyl siding<\/option>/);
  assert.match(alco, /id="sidingLowPerSqFt"[^>]*value="10">/); assert.match(alco, /id="doorHighEach"[^>]*value="4200">/);
  assert.match(alco, /data-change="James Hardie fiber cement siding">James Hardie siding<\/button>/);
  assert.match(alco, /Example rates, until Alco's own prices replace them/);
  assert.doesNotMatch(example, ALCO_ONLY);
  assert.match(example, /<title>Example Exteriors — Know the scope before the quote<\/title>/);
  assert.match(example, /<picture><img class="brand-logo" src="assets\/brand\/logo\.svg" width="360" height="80" alt="Example Exteriors Co\. home"><\/picture>/, 'no WebP source when the skin has none');
  assert.match(example, /data-send-lead>Send to Example Exteriors /); assert.match(example, /I agree to Example Exteriors' <a href="https:\/\/www\.example\.com\/terms"/);
  assert.match(example, /id="sidingLowPerSqFt"[^>]*value="9">/); assert.match(example, /<meta name="theme-color" content="#14213d">/);
  // Names are text, never markup, and a mark the skin can't fill is an error rather than a blank.
  const odd = await loadSkin('example'), tagged = { ...odd, company: { ...odd.company, name: 'A & B <Roofing>' } };
  assert.match(renderPage('<p>{{company}}</p>', tagged), /<p>A &amp; B &lt;Roofing&gt;<\/p>/);
  assert.throws(() => renderPage('<p>{{nothing}}</p>', odd), /index\.html uses \{\{nothing\}\}/);
});

test('the catalog and the default rates are the skin\'s, so a fresh estimate is never marked as edited', () => {
  assert.equal(CATALOG_VERSION, BRAND.catalog.version);
  assert.equal(PRODUCTS.siding.fiber.name, BRAND.catalog.products.siding.fiber.name);
  for (const [key, value] of Object.entries(catalogRates({ ...DEFAULT_PROJECT, roofing: true, gutters: true }))) assert.equal(DEFAULT_INPUT[key], value, key);
});

test('the app manifest, icons and offline list follow the skin, and a rebrand clears what phones have cached', async () => {
  const alco = await loadSkin('alco'), example = await loadSkin('example'), manifest = JSON.parse(skinManifest(example));
  assert.equal(manifest.name, 'Example Exterior Studio'); assert.equal(manifest.theme_color, '#14213d'); assert.equal(manifest.background_color, '#14213d');
  assert.deepEqual(manifest.icons.map(icon => icon.src), ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png'].map(file => BRAND_PREFIX + file));
  assert.equal(JSON.parse(skinManifest(alco)).name, 'Alco Exterior Studio');
  assert.deepEqual(brandFiles(alco), ['logo.png', 'logo.webp', 'logo-white.png', ...ICON_FILES]);
  const worker = await read('sw.js'), [alcoStamp, exampleStamp] = [await skinStamp(alco), await skinStamp(example)];
  assert.match(alcoStamp, /^alco-[0-9a-f]{8}$/); assert.notEqual(alcoStamp.split('-')[1], exampleStamp.split('-')[1]);
  const made = renderWorker(worker, example, exampleStamp);
  assert.match(made, new RegExp(`const CACHE = 'curbquote-v[\\d.]+' \\+ '-${exampleStamp}';`));
  assert.match(made, /'skin\.css', 'main\.js', 'brand\.js', 'manifest\.webmanifest', 'assets\/brand\/logo\.svg', 'assets\/brand\/logo-white\.svg', 'assets\/brand\/icon-192\.png', 'assets\/brand\/icon-512\.png'\];/);
  assert.throws(() => renderWorker('const CACHE = 1;', example, exampleStamp), /sw\.js changed/);
  // Icons: the maskable one shrinks the mark into Android's safe zone; a skin without icon.svg gets its logo on its dark colour.
  assert.match(iconSvg('<g id="mark" transform="translate(46 154)">', .76), /<g id="mark" transform="translate\(96\.4 178\.48\d*\) scale\(0\.76\)">/);
  assert.match(defaultIconSvg(example), /<rect width="512" height="512" fill="#14213d"\/><g id="mark" transform="translate\(46\.5 209\.5\)"><image href="logo-white\.svg" width="419" height="93"\/>/);
});

test('a build for another skin ships that skin only: no file names Alco, and Alco\'s skin is not served', async t => {
  const destination = await mkdtemp(join(tmpdir(), 'curbquote-skin-'));
  t.after(() => rm(destination, { recursive: true, force: true }));
  const example = await loadSkin('example');
  await buildPublicAssets(destination, example);
  for (const file of (await readdir(destination)).filter(name => /\.(html|js|css|webmanifest)$/.test(name))) {
    assert.doesNotMatch(await readFile(join(destination, file), 'utf8'), ALCO_ONLY, file);
  }
  assert.match(await readFile(join(destination, 'brand.js'), 'utf8'), /from '\.\/skins\/example\/skin\.js';/);
  assert.deepEqual(await readdir(join(destination, 'skins')), ['example']);
  assert.deepEqual((await readdir(join(destination, 'assets/brand'))).sort(), brandFiles(example).sort());
  assert.match(await readFile(join(destination, 'skin.css'), 'utf8'), /--lime:#f6a821/);
});

test('`SKIN=example npm run dev` previews another skin; the default server serves the skin in use', async t => {
  const serve = async options => {
    const server = createAppServer(options); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    return `http://127.0.0.1:${server.address().port}`;
  };
  const preview = await serve({ skin: await loadSkin('example') }), live = await serve();
  assert.match(await (await fetch(preview)).text(), /<title>Example Exteriors/);
  assert.match(await (await fetch(`${preview}/brand.js`)).text(), /from '\.\/skins\/example\/skin\.js';/);
  assert.equal((await fetch(`${preview}/skins/example/skin.js`)).status, 200);
  assert.equal((await fetch(`${preview}/skins/alco/skin.js`)).status, 404);
  assert.equal((await fetch(`${preview}/assets/brand/logo.svg`)).headers.get('content-type'), 'image/svg+xml; charset=utf-8');
  assert.equal((await fetch(`${preview}/assets/brand/logo.png`)).status, 404, 'only the previewed skin\'s files');
  assert.match(await (await fetch(`${preview}/skin.css`)).text(), /--forest:#14213d/);
  assert.equal(JSON.parse(await (await fetch(`${preview}/manifest.webmanifest`)).text()).name, 'Example Exterior Studio');
  assert.match(await (await fetch(`${preview}/sw.js`)).text(), /'-example-[0-9a-f]{8}'/);
  const page = await fetch(live);
  assert.match(await page.text(), new RegExp(`<title>${BRAND.app.title}</title>`));
  assert.equal(page.headers.get('cache-control'), 'no-cache');
  const css = await fetch(`${live}/skin.css`);
  assert.match(css.headers.get('content-type'), /^text\/css/); assert.match(await css.text(), new RegExp(`--forest:${BRAND.colors.dark}`));
  assert.equal((await fetch(`${live}/skin.css`, { headers: { 'If-None-Match': css.headers.get('etag') } })).status, 304);
  assert.equal((await fetch(`${live}/skins/example/skin.js`)).status, 404);
  assert.match(await (await fetch(`${live}/brand.js`)).text(), new RegExp(`from './skins/${BRAND.id}/skin.js';`));
});
