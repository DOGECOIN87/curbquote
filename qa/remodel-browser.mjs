import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createAppServer } from '../lib/web.mjs';
import { createMap3DHandler } from '../api/map3d.js';

const outputDir = resolve(process.env.QA_OUTPUT_DIR || 'qa-output');
await mkdir(outputDir, { recursive: true });
const server = createAppServer({ mapHandler: createMap3DHandler({ env: {} }) });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
const errors = [], checks = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('request', request => requests.push(request.url()));
const canvasHash = () => page.evaluate(() => {
  const canvas = document.querySelector('#remodel-stage canvas');
  if (!canvas) return '';
  const data = canvas.toDataURL('image/png');
  let hash = 0; for (let i = 0; i < data.length; i += 97) hash = (hash * 31 + data.charCodeAt(i)) >>> 0;
  return `${data.length}:${hash}`;
});
const distinctColors = () => page.evaluate(() => {
  const source = document.querySelector('#remodel-stage canvas');
  const probe = document.createElement('canvas'); probe.width = 64; probe.height = 48;
  probe.getContext('2d').drawImage(source, 0, 0, 64, 48);
  const pixels = probe.getContext('2d').getImageData(0, 0, 64, 48).data, seen = new Set();
  for (let i = 0; i < pixels.length; i += 16) seen.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
  return seen.size;
});
try {
  await page.goto(base);
  // The Three.js runtime stays undownloaded until the Design studio is on screen.
  assert.equal(requests.filter(url => url.includes('/vendor/three/')).length, 0);
  await page.locator('[data-goto="5"]').click();
  await page.locator('#remodel-stage').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('#remodel-stage')?.dataset.ready === 'true', undefined, { timeout: 45000 });
  assert.ok(requests.some(url => url.includes('/vendor/three/three.module.js')));
  assert.equal(await page.locator('#remodel-stage canvas').isVisible(), true);
  assert.ok(await distinctColors() > 40, 'the 3D canvas should show a shaded scene, not a blank frame');
  assert.match(await page.locator('#remodel-status').textContent(), /48 × 34 ft · 2 stories · 12 windows shown/);
  assert.equal(await page.locator('#lengthFt').inputValue(), '48', 'rendering must not change estimate inputs');
  checks.push('3D remodel loads lazily, renders a shaded house from the default measurements, and leaves the estimate untouched');

  const after = await canvasHash();
  await page.locator('#remodel-before').click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#remodel-before').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#add-porch').isDisabled(), true);
  assert.notEqual(await canvasHash(), after, 'Before must repaint the house');
  await page.locator('#remodel-after').click();
  await page.waitForTimeout(250);
  const porchOff = await (async () => { await page.locator('#add-porch').click(); await page.waitForTimeout(250); return canvasHash(); })();
  assert.notEqual(porchOff, after, 'removing the porch must repaint the house');
  await page.locator('#add-porch').click();
  checks.push('Before/After and the porch addition repaint the model, and additions stay locked in Before');

  await page.locator('[data-remodel-view="front"]').click(); await page.waitForTimeout(200);
  const front = await canvasHash();
  await page.locator('[data-remodel-view="top"]').click(); await page.waitForTimeout(200);
  assert.notEqual(await canvasHash(), front, 'camera view buttons must move the camera');
  const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
  await page.locator('#remodel-download').click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /curbquote-3d-remodel\.png/);
  checks.push('Corner, Front and Top move the camera, and the current view downloads as a PNG');

  // Restyle from step 4 and resize from step 3; the model follows both.
  await page.locator('[data-goto="4"]').click();
  await page.locator('[data-color="charcoal"]').click();
  await page.locator('[data-goto="3"]').click();
  await page.locator('#stories').selectOption('1');
  await page.locator('[data-goto="5"]').click();
  await page.locator('#remodel-stage').scrollIntoViewIfNeeded();
  await page.locator('[data-remodel-view="corner"]').click();
  await page.waitForFunction(() => document.querySelector('#remodel-stage')?.dataset.spec.includes('1 story'), undefined, { timeout: 10000 });
  assert.notEqual(await canvasHash(), front);
  checks.push('Siding color from step 4 and story count from step 3 rebuild the 3D house');

  await page.locator('.design-studio').screenshot({ path: resolve(outputDir, 'remodel-browser.png') });
  assert.deepEqual(errors, []);
  await writeFile(resolve(outputDir, 'remodel-checks.txt'), checks.map((check, i) => `${i + 1}. ${check}`).join('\n') + '\n');
  console.log(`${checks.length} 3D remodel browser checks passed.`);
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
