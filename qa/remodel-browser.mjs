import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createAppServer } from '../lib/web.mjs';
import { createMap3DHandler } from '../api/map3d.js';

const outputDir = resolve(process.env.QA_OUTPUT_DIR || 'qa-output');
await mkdir(outputDir, { recursive: true });
const server = createAppServer({
  mapHandler: createMap3DHandler({ env: {} }),
  dimensionsHandler: async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') return res.status(200).json({ openFallback: true });
    return res.status(200).json({
      areaSqFt: 1920,
      perimeterFt: 180,
      lengthFt: 54,
      widthFt: 35.5,
      stories: 2,
      roofPitch: '8:12',
      suggestedStyle: 'tudor-gable',
      source: { provider: 'OpenStreetMap / Overpass (ODbL)', license: 'ODbL-1.0', retrievedAt: '2026-10-22T12:00:00Z', approximate: true },
      warnings: ['Style variant — approximate, not your surveyed footprint.']
    });
  }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true }); await page.addInitScript(() => { try { localStorage.setItem('curbquote.property.view', 'photo'); } catch {} });
const errors = [], checks = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('request', request => requests.push(request.url()));
const canvasHash = () => page.evaluate(() => {
  const canvas = document.querySelector('#remodel-stage canvas, #step3-3d-stage canvas');
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
  // Step 1 shows the house as a floating welcome model once the page is idle; Steps 3 and 5 reuse that one canvas.
  await page.waitForFunction(() => document.querySelector('#welcome-stage canvas'), undefined, { timeout: 45000 });
  assert.ok(requests.some(url => url.includes('/vendor/three/three.module.js')));
  assert.equal(await page.locator('#welcome-stage canvas').getAttribute('tabindex'), '-1', 'the decorative welcome model stays out of the tab order');
  assert.equal(await page.locator('#turntable-toggle').isVisible(), false, 'with reduced motion the welcome model does not turn');
  checks.push('Step 1 shows the welcome house as a floating model, out of the tab order and still with reduced motion');
  await page.locator('[data-goto="2"]').click();
  await page.locator('[data-goto="3"]').click();
  await page.waitForFunction(() => document.querySelector('#step3-3d-stage')?.dataset.ready === 'true', undefined, { timeout: 45000 });
  assert.ok(requests.some(url => url.includes('/vendor/three/three.module.js')));
  assert.equal(await page.locator('#step3-3d-stage canvas').isVisible(), true);
  assert.match(await page.locator('#remodel-status').textContent(), /48 × 34 ft · 2 stories · 12 windows shown/);
  await page.locator('#step3-3d-stage').scrollIntoViewIfNeeded();
  await page.locator('[data-dock-split="50"]').click();
  assert.equal(await page.locator('#step3-3d-stage').getAttribute('data-split-active'), 'true');
  assert.equal(await page.locator('#step3-3d-stage .stage-corner-badges').isVisible(), true);
  assert.match(await page.locator('#step3-3d-stage .stage-corner-badges').textContent(), /Before · Existing/);
  const previewBox = await page.locator('#step3-3d-stage canvas').boundingBox();
  await page.mouse.move(0, 0);
  const idleReticle = await page.locator('#step3-3d-stage .thirds-grid').evaluate(grid => getComputedStyle(grid).opacity);
  assert.ok(Number(idleReticle) < .2, `reticle should be subtle at rest, got ${idleReticle}`);
  await page.mouse.move(previewBox.x + 22, previewBox.y + 24);
  const activeReticle = await page.locator('#step3-3d-stage .thirds-grid').evaluate(grid => getComputedStyle(grid).opacity);
  assert.ok(Number(activeReticle) > .8, `reticle should brighten on hover, got ${activeReticle}`);
  const startX = previewBox.x + previewBox.width * .5;
  const targetX = previewBox.x + previewBox.width * .31;
  const splitY = previewBox.y + previewBox.height * .5;
  for (const offset of [-18, 18]) {
    await page.mouse.move(startX + offset, splitY);
    assert.equal(await page.locator('#step3-3d-stage canvas').evaluate(canvas => getComputedStyle(canvas).cursor), 'ew-resize', `the seam hit area includes ${offset}px`);
  }
  await page.mouse.move(startX + 19, splitY);
  assert.equal(await page.locator('#step3-3d-stage canvas').evaluate(canvas => getComputedStyle(canvas).cursor), 'grab', 'outside the ±18px seam hit area remains an orbit cursor');
  await page.mouse.move(startX, splitY);
  assert.equal(await page.locator('#step3-3d-stage canvas').evaluate(canvas => getComputedStyle(canvas).cursor), 'ew-resize');
  const expectedPreviewSplit = await page.locator('#step3-3d-stage canvas').evaluate((canvas, x) => Math.round((1 - (x - canvas.getBoundingClientRect().left) / canvas.getBoundingClientRect().width) * 100), targetX);
  await page.mouse.down();
  await page.mouse.move(targetX, splitY, { steps: 6 });
  assert.equal(await page.locator('#remodel-split').inputValue(), String(expectedPreviewSplit), 'the range follows the seam during the drag');
  assert.equal(await page.locator('#remodel-split-readout').textContent(), `${100 - expectedPreviewSplit}% Before · ${expectedPreviewSplit}% After`);
  await page.mouse.up();
  assert.equal(await page.locator('#remodel-split').inputValue(), String(expectedPreviewSplit));
  assert.equal(await page.locator('#remodel-split-readout').textContent(), `${100 - expectedPreviewSplit}% Before · ${expectedPreviewSplit}% After`);
  assert.equal(await page.locator('#step3-3d-stage canvas').evaluate(canvas => canvas.classList.contains('is-orbiting')), false);
  for (const value of ['0','50','100']) assert.equal(await page.locator(`[data-dock-split="${value}"]`).getAttribute('aria-pressed'), 'false');
  const halfX = previewBox.x + previewBox.width * .5;
  await page.mouse.move(targetX, splitY); await page.mouse.down(); await page.mouse.move(halfX, splitY, { steps: 4 }); await page.mouse.up();
  assert.equal(await page.locator('#remodel-split').inputValue(), '50');
  assert.equal(await page.locator('[data-dock-split="50"]').getAttribute('aria-pressed'), 'true', 'dock quick choices follow a direct seam drag');
  const beforeOrbit = await canvasHash();
  const orbitStartX = previewBox.x + previewBox.width * .8;
  await page.mouse.move(orbitStartX, splitY); await page.mouse.down(); await page.mouse.move(orbitStartX + 32, splitY + 13, { steps: 4 }); await page.mouse.up();
  assert.notEqual(await canvasHash(), beforeOrbit, 'dragging away from the seam must continue to orbit the house');
  checks.push('Both stage corners label comparisons; live seam dragging synchronizes the range, readout and dock controls, with ±18px hit testing and orbit preserved elsewhere');
  await page.locator('[data-goto="5"]').click();
  await page.locator('#remodel-stage').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('#remodel-stage')?.dataset.ready === 'true', undefined, { timeout: 45000 });
  assert.equal(await page.locator('#remodel-stage canvas').isVisible(), true);
  assert.equal(await page.locator('#remodel-stage').getAttribute('data-split-active'), 'true');
  assert.equal(await page.locator('#remodel-stage .stage-corner-badges').isVisible(), true);
  const studioCanvas = page.locator('#remodel-stage canvas');
  const studioBox = await studioCanvas.boundingBox();
  const currentSplit = Number(await page.locator('#remodel-split').inputValue());
  const studioSeamX = studioBox.x + studioBox.width * (100 - currentSplit) / 100;
  const studioTargetX = studioBox.x + studioBox.width * .4;
  const studioY = studioBox.y + studioBox.height * .5;
  await page.mouse.move(studioSeamX, studioY);
  assert.equal(await studioCanvas.evaluate(canvas => getComputedStyle(canvas).cursor), 'ew-resize');
  const expectedStudioSplit = await studioCanvas.evaluate((canvas, x) => Math.round((1 - (x - canvas.getBoundingClientRect().left) / canvas.getBoundingClientRect().width) * 100), studioTargetX);
  await page.mouse.down(); await page.mouse.move(studioTargetX, studioY, { steps: 6 }); await page.mouse.up();
  assert.equal(await page.locator('#remodel-split').inputValue(), String(expectedStudioSplit));
  assert.equal(await page.locator('#remodel-split-readout').textContent(), `${100 - expectedStudioSplit}% Before · ${expectedStudioSplit}% After`);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#step3-3d-stage canvas, #remodel-stage canvas').length), 1, 'Step 3 and Step 5 share one WebGL canvas');
  assert.ok(await distinctColors() > 40, 'the 3D canvas should show a shaded scene, not a blank frame');
  assert.equal(await page.locator('#lengthFt').inputValue(), '48', 'rendering must not change estimate inputs');
  checks.push('3D remodel loads lazily on Step 3, shares one WebGL canvas with Step 5, and leaves the estimate untouched');

  const after = await canvasHash();
  await page.locator('#remodel-before').click();
  await page.waitForTimeout(250);
  const before = await canvasHash();
  assert.equal(await page.locator('#remodel-before').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#add-porch').isDisabled(), true);
  assert.notEqual(before, after, 'Before must repaint the house');
  await page.locator('#remodel-split-half').click();
  await page.waitForTimeout(250);
  const splitHalf = await canvasHash();
  assert.equal(await page.locator('#remodel-split-half').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#remodel-split').inputValue(), '50');
  assert.match(await page.locator('#remodel-split-readout').textContent(), /50% Before · 50% After/);
  assert.match(await page.locator('#remodel-compare-note').textContent(), /Split comparison \(50% Before on left, 50% After on right\)/);
  assert.notEqual(splitHalf, before, '50/50 split must differ from 100% Before');
  assert.notEqual(splitHalf, after, '50/50 split must differ from 100% After');
  await page.locator('#remodel-after').click();
  await page.waitForTimeout(250);
  const porchOff = await (async () => { await page.locator('#add-porch').click(); await page.waitForTimeout(250); return canvasHash(); })();
  assert.notEqual(porchOff, after, 'removing the porch must repaint the house');
  await page.locator('#add-porch').click();
  checks.push('Before, Split 50/50, After and the porch addition repaint the model, and additions stay locked in Before');

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

  // Verify North-American style picker + on-demand public footprint guardrail flow.
  await page.locator('[data-goto="1"]').click();
  await page.locator('#exterior-example').click();
  await page.locator('[data-goto="3"]').click();
  assert.equal(await page.locator('#home-style-picker [data-archetype]').count(), 16);
  assert.equal(await page.locator('#home-style-picker [data-archetype] svg.style-art').count(), 16, 'every style card shows its drawing');
  const preStyleHash = await canvasHash();
  await page.locator('[data-archetype="farmhouse-porch"]').click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('[data-archetype="farmhouse-porch"]').getAttribute('aria-pressed'), 'true');
  assert.notEqual(await canvasHash(), preStyleHash, 'selecting a North-American home style rebuilds the 3D silhouette');
  assert.equal(await page.locator('#step3-studio-badge').textContent(), 'Concept model');
  await page.locator('#measure-sources > summary').click();
  await page.locator('#footprint-consent').click();
  await page.locator('#fetch-footprint').click();
  await page.waitForFunction(() => document.querySelector('#step3-studio-badge')?.textContent?.includes('Style variant — approximate'), undefined, { timeout: 10000 });
  assert.equal(await page.locator('#studio-model-badge').textContent(), 'Style variant — approximate, not your surveyed footprint');
  checks.push('All 16 North-American style cards rebuild the 3D silhouette and public footprint lookup enforces approximate-model guardrails');

  await page.locator('[data-goto="5"]').click();
  await page.locator('.design-studio').screenshot({ path: resolve(outputDir, 'remodel-browser.png') });
  assert.deepEqual(errors, []);
  await writeFile(resolve(outputDir, 'remodel-checks.txt'), checks.map((check, i) => `${i + 1}. ${check}`).join('\n') + '\n');
  console.log(`${checks.length} 3D remodel browser checks passed.`);
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
