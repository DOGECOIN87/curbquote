import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createAppServer } from '../lib/web.mjs';
import { createMap3DHandler } from '../api/map3d.js';
import { EXTERIOR_EXAMPLE } from '../exterior-catalog.js';
import { syntheticTileset } from './fixtures/tiles3d.mjs';

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
  // Once a home is found the search box drops the example link; clearing the search brings it back.
  await page.locator('#property-address').fill('');
  await page.locator('#exterior-example').click(); await started;
  await page.locator('#property-address').fill('Another property'); release();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#exterior-model').isVisible(), false);
  assert.equal(await page.locator('#exterior-model canvas').count(), 0);
  checks.push('A delayed model response cannot reappear after an address edit');
  modelBehavior = 'fail'; await page.locator('#property-address').fill(''); await page.locator('#exterior-example').click();
  await page.waitForFunction(() => document.querySelector('#aerial-images img')?.complete);
  assert.equal(await page.locator('#exterior-model').isVisible(), false);
  modelBehavior = 'normal'; await page.locator('#aerial-3d-toggle').click(); await ready();
  checks.push('A failed model load falls back to aerial imagery and the exterior can be retried');

  // Google's view, with a synthetic tileset in place of Google's: a box-shaped house 12 m north of the
  // address point and a garage to its west.
  const point = { lat: 38.84, lon: -76.9 }, fixture = syntheticTileset(point), cors = { 'Access-Control-Allow-Origin': '*' };
  async function openGoogle({ outline }) {
    const view = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    view.on('pageerror', error => errors.push(error.message));
    view.on('console', message => { if (message.type() === 'error' && /Content Security Policy|unsafe-eval/i.test(message.text())) errors.push(message.text()); });
    await view.route('**/api/map3d', route => route.fulfill({ json: { configured: true, provider: 'Google Photorealistic 3D Tiles', key: 'AIzaSyQA-synthetic-key_0123456789' } }));
    await view.route('https://tile.googleapis.com/**', route => {
      const url = route.request().url();
      if (url.includes('/v1/3dtiles/root.json')) return route.fulfill({ headers: cors, json: fixture.tileset });
      if (url.includes('/v1/3dtiles/house.glb')) return route.fulfill({ headers: cors, contentType: 'model/gltf-binary', body: fixture.content });
      return route.fulfill({ status: 404, headers: cors, body: 'Not in the synthetic tileset' });
    });
    await view.route('**/api/geocode?**', route => route.fulfill({ json: { matchedAddress: '4600 SILVER HILL RD, WASHINGTON, DC, 20233', coordinates: point, source: 'Synthetic test address' } }));
    await view.route('**/api/footprint', route => outline
      ? route.fulfill({ json: { polygon: { type: 'Polygon', coordinates: [fixture.outline] }, areaSqFt: 1722, perimeterFt: 171, lengthFt: 52.5, widthFt: 32.8, stories: 2, source: { provider: 'OpenStreetMap / Overpass (ODbL)', license: 'ODbL-1.0', retrievedAt: '2026-10-23T12:00:00Z', approximate: true } } })
      : route.fulfill({ status: 404, json: { error: 'No mapped building outline was found within 35 m of this address.', code: 'FOOTPRINT_NO_MATCH' } }));
    await view.route('https://imagery.nationalmap.gov/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600"><rect width="960" height="600" fill="#ddd"/></svg>' }));
    await view.goto(base);
    await view.locator('#property-address').fill('4600 Silver Hill Rd, Washington, DC 20233');
    await view.locator('#verify-address').click();
    return view;
  }
  const labelsOf = view => view.locator('.measure-3d .measure-label').evaluateAll(els => els.map(el => ({ text: el.textContent, feet: Number(el.textContent.replace(/\D/g, '')), shown: el.classList.contains('is-shown') && !el.hidden, box: el.getBoundingClientRect().toJSON() })));
  const near = (actual, expected, slack, what) => assert.ok(Math.abs(actual - expected) <= slack, `${what}: ${actual} ft, expected about ${expected}`);

  const google = await openGoogle({ outline: true });
  await google.waitForFunction(() => /mapped outline and the 3D view/.test(document.querySelector('#measure-note')?.textContent || ''), null, { timeout: 45000 });
  await google.waitForTimeout(3200);
  const labels = () => labelsOf(google), shown = await labels();
  assert.equal(await google.locator('#aerial-width').textContent(), 'Google 3D · display only');
  assert.deepEqual([...shown.slice(0, 2).map(label => label.text).sort(), shown[2]?.text], ['≈ 33 ft', '≈ 52 ft', '≈ 28 ft'], 'sides from the mapped outline, height from the 3D surface');
  assert.ok(shown.every(label => label.shown), 'every label is on screen');
  const stage = await google.locator('#aerial-stage').boundingBox();
  assert.ok(shown.every(({ box }) => box.left >= stage.x && box.right <= stage.x + stage.width && box.top >= stage.y && box.bottom <= stage.y + stage.height), 'labels stay inside the view');
  assert.equal(await google.locator('#aerial-3d-orbit').getAttribute('aria-pressed'), 'true');
  await google.waitForTimeout(800);
  const turned = await labels();
  assert.ok(turned.some((label, i) => Math.hypot(label.box.x - shown[i].box.x, label.box.y - shown[i].box.y) > 2), 'the labels follow the circling camera');
  await google.locator('#aerial-stage').screenshot({ path: 'qa-output/google3d-measure.png' });
  const googleCanvas = await google.locator('.aerial-3d canvas').boundingBox();
  // A tap on open ground stops the circling and leaves the measurement where it is.
  await google.mouse.move(googleCanvas.x + googleCanvas.width * .85, googleCanvas.y + googleCanvas.height * .25); await google.mouse.down(); await google.mouse.up();
  assert.equal(await google.locator('#aerial-3d-orbit').getAttribute('aria-pressed'), 'false');
  const still = await labels(); await google.waitForTimeout(1200);
  assert.deepEqual((await labels()).map(label => label.box), still.map(label => label.box), 'touching the view stops the circling');
  await google.close();
  checks.push('Google 3D frames the mapped building, draws the measuring pass with its height from the 3D surface, and circles until touched');

  // No mapped outline: the roof is found in the 3D surface itself, and a tap on another roof measures that one.
  const surface = await openGoogle({ outline: false });
  await surface.waitForFunction(() => /measured in the 3D view/.test(document.querySelector('#measure-note')?.textContent || ''), null, { timeout: 45000 });
  await surface.waitForTimeout(3200);
  const found = await labelsOf(surface), [short, long] = found.slice(0, 2).map(label => label.feet).sort((a, b) => a - b);
  near(long, 52, 6, 'house length'); near(short, 33, 6, 'house depth'); near(found[2]?.feet, 28, 2, 'house height');
  // The size reaches the estimate only once the homeowner says it is their home; "Not my home" asks for a tap.
  assert.match(await surface.locator('#measure-confirm-text').textContent(), /^Is this your home\? It measures about \d+ × \d+ ft, \d+ ft tall\.$/);
  assert.equal(await surface.locator('#lengthFt').inputValue(), '48', 'nothing changes before confirming');
  await surface.locator('#measure-no').click();
  assert.match(await surface.locator('#measure-confirm-text').textContent(), /Tap your home’s roof/);
  await surface.locator('#aerial-3d-recenter').click(); await surface.waitForTimeout(1200);
  await surface.locator('#aerial-3d-top').click(); await surface.waitForTimeout(1500);
  // Straight down with north up: find the garage from the house's corner points and the known layout.
  const corners = await surface.locator('.measure-3d-corner').evaluateAll(dots => dots.map(dot => [Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy'))]));
  const xs = corners.map(([x]) => x), ys = corners.map(([, y]) => y), perMetre = (Math.max(...xs) - Math.min(...xs)) / 16;
  const centre = [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2], layer = await surface.locator('.measure-3d').boundingBox();
  await surface.mouse.click(layer.x + centre[0] - 16 * perMetre, layer.y + centre[1] + 10 * perMetre);
  await surface.waitForFunction(() => [...document.querySelectorAll('.measure-3d .measure-label')].some(el => /≈ (1[0-3]) ft/.test(el.textContent) && el.classList.contains('is-shown')), null, { timeout: 30000 });
  await surface.waitForTimeout(3200);
  const garage = await labelsOf(surface), [gShort, gLong] = garage.slice(0, 2).map(label => label.feet).sort((a, b) => a - b);
  near(gLong, 26, 5, 'garage length'); near(gShort, 20, 5, 'garage depth'); near(garage[2]?.feet, 11, 2, 'garage height');
  assert.match(await surface.locator('#measure-confirm-text').textContent(), /^Is this your home\?/, 'the tapped building is offered');
  await surface.locator('#measure-yes').click();
  const sized = { length: Number(await surface.locator('#lengthFt').inputValue()), width: Number(await surface.locator('#widthFt').inputValue()) };
  near(sized.length, gLong, 1, 'estimate length'); near(sized.width, gShort, 1, 'estimate width');
  assert.equal(await surface.locator('#stories').inputValue(), '1', 'an 11 ft building is one story');
  assert.match(await surface.locator('#instant-basis').textContent(), /sized from the 3D view, confirmed by you/);
  assert.match(await surface.locator('#measure-confirm-text').textContent(), /^Your estimate now uses \d+(\.5)? × \d+(\.5)? ft, 1-story\.$/);
  await surface.locator('#measure-undo').click();
  assert.deepEqual([await surface.locator('#lengthFt').inputValue(), await surface.locator('#widthFt').inputValue(), await surface.locator('#stories').inputValue()], ['48', '34', '2'], 'Undo restores the earlier size');
  assert.match(await surface.locator('#measure-confirm-text').textContent(), /^Is this your home\?/);
  await surface.locator('#aerial-stage').screenshot({ path: 'qa-output/google3d-surface.png' });
  await surface.close();
  checks.push('Without a mapped outline, Google 3D finds the nearest roof in its own surface and measures it; tapping another roof measures that building');
  checks.push('"Is this your home?" sizes the estimate only after the homeowner confirms, "Not my home" asks for a tap, and Undo restores the earlier size');
  assert.deepEqual(errors, []);
  await writeFile('qa-output/exterior-checks.json', JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { release?.(); await browser.close(); server.close(); server.closeAllConnections(); }
