import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createAppServer } from '../lib/web.mjs';
import { createMap3DHandler } from '../api/map3d.js';
import { EXTERIOR_EXAMPLE } from '../exterior-catalog.js';

const server = createAppServer({ mapHandler: createMap3DHandler({ env: {} }), dimensionsHandler: async (req, res) => { res.setHeader('Cache-Control', 'no-store'); return res.status(503).json({ error: 'Synthetic open footprint outage.', code: 'FOOTPRINT_UPSTREAM_UNAVAILABLE' }); } });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' }); await page.addInitScript(() => { try { localStorage.setItem('curbquote.property.view', 'photo'); } catch {} });
const errors = [], checks = [], requests = [];
let modelBehavior = 'normal', release, started, announce;
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && /Content Security Policy|unsafe-eval/i.test(message.text())) errors.push(message.text()); });
page.on('request', request => requests.push(request.url()));
await page.route('**/assets/exteriors/neill-cochran/model.glb', async route => {
  if (modelBehavior === 'hold') { announce?.(); await new Promise(resolve => { release = resolve; }); }
  if (modelBehavior === 'fail') await route.fulfill({ status: 503, body: 'Synthetic model outage' });
  else await route.continue().catch(() => {});
});
await page.route('**/api/geocode?**', route => route.fulfill({ json: { matchedAddress: '4600 SILVER HILL RD, WASHINGTON, DC, 20233', coordinates: { lat: 38.84, lon: -76.9 }, source: 'Synthetic test address' } }));
await page.route('https://imagery.nationalmap.gov/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600"><rect width="960" height="600" fill="#ddd"/><text x="20" y="50">Synthetic aerial fallback for QA</text></svg>' }));
const ready = () => page.waitForFunction(() => {
  const view = document.querySelector('#exterior-model');
  return !view.hidden && view.getAttribute('aria-busy') !== 'true' && view.querySelector('canvas');
}, undefined, { timeout: 30000 });
try {
  await page.goto(base);
  const dimensions = await page.locator('#lengthFt,#widthFt,#stories').evaluateAll(els => els.map(el => el.value));
  assert.equal(requests.some(url => url.includes('/vendor/cesium/')), false);
  await page.locator('#exterior-example').click(); await ready();
  assert.equal(await page.locator('#property-address').inputValue(), EXTERIOR_EXAMPLE.matchedAddress);
  assert.match(await page.locator('#address-status').textContent(), /example|prototype/i);
  assert.match(await page.locator('#aerial-width').textContent(), /2017/);
  assert.equal(await page.locator('#exterior-credit').isVisible(), true);
  assert.equal(requests.some(url => /tile.googleapis.com|api.cesium.com|assets.ion.cesium.com/.test(url)), false);
  assert.deepEqual(await page.locator('#lengthFt,#widthFt,#stories').evaluateAll(els => els.map(el => el.value)), dimensions);
  checks.push('The real bundled GLB renders with no map key, no external 3D requests and no changes to estimate dimensions');
  const canvas = page.locator('#exterior-model canvas');
  const before = await canvas.screenshot();
  await page.locator('#aerial-3d-rotate').click(); await page.waitForTimeout(100);
  assert.notDeepEqual(await canvas.screenshot(), before);
  await page.locator('#aerial-3d-top').click(); assert.equal(await page.locator('#aerial-3d-top').getAttribute('aria-pressed'), 'true');
  await canvas.focus(); await page.keyboard.press('ArrowDown'); assert.equal(await page.locator('#aerial-3d-top').getAttribute('aria-pressed'), 'false');
  const angled = await canvas.screenshot();
  await page.keyboard.press('+'); await page.waitForTimeout(100); assert.notDeepEqual(await canvas.screenshot(), angled);
  await page.keyboard.press('Home');
  checks.push('Rotate, top view, keyboard orbit, keyboard zoom and recenter change the real canvas');
  await mkdir('qa-output', { recursive: true });
  await page.locator('.hero').screenshot({ path: 'qa-output/exterior-desktop.png' });
  for (const [width,height] of [[320,740],[390,844],[768,1024],[1024,768],[1440,1050],[844,390]]) {
    await page.setViewportSize({ width,height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1), `Overflow at ${width}`);
    if (width === 390) await page.locator('.property-preview').screenshot({ path: 'qa-output/exterior-phone.png' });
  }
  checks.push('The model and controls fit six desktop, tablet, phone and landscape viewports');
  await page.locator('#property-address').fill('4600 Silver Hill Rd, Washington, DC 20233');
  assert.equal(await page.locator('#exterior-model').isVisible(), false);
  assert.equal(await page.locator('#exterior-model canvas').count(), 0);
  await page.locator('#verify-address').click();
  await page.waitForFunction(() => document.querySelector('#aerial-images img')?.complete);
  assert.notEqual(await page.locator('#aerial-3d-toggle').textContent(), 'Exterior model', 'only the reviewed property offers its exterior model');
  checks.push('Editing the address immediately destroys the previous model; unrelated properties retain the aerial fallback');
  modelBehavior = 'hold'; started = new Promise(resolve => { announce = resolve; });
  await page.locator('#exterior-example').click(); await started;
  await page.locator('#property-address').fill('Another property'); release();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#exterior-model').isVisible(), false);
  assert.equal(await page.locator('#exterior-model canvas').count(), 0);
  checks.push('A delayed model response cannot reappear after an address edit');
  modelBehavior = 'fail'; await page.locator('#exterior-example').click();
  await page.waitForFunction(() => document.querySelector('#aerial-images img')?.complete);
  assert.equal(await page.locator('#exterior-model').isVisible(), false);
  modelBehavior = 'normal'; await page.locator('#aerial-3d-toggle').click(); await ready();
  checks.push('A failed model load falls back to aerial imagery and the exterior can be retried');
  assert.deepEqual(errors, []);
  await writeFile('qa-output/exterior-checks.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { release?.(); await browser.close(); server.close(); server.closeAllConnections(); }
