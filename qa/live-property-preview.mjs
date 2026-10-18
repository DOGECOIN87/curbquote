/** Opt-in network smoke: the public Census Bureau example address, never a homeowner address. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { X509Certificate, createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { createAppServer } from '../lib/web.mjs';

if (process.env.LIVE_PROPERTY_PREVIEW !== '1') throw new Error('Set LIVE_PROPERTY_PREVIEW=1 to contact Census and USGS with the public test address.');
const server = createAppServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
let browser;
const proxyUrl = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY) : null;
try {
  // Chromium has a separate trust store. Pin only a CA explicitly trusted by this runtime's proxy.
  // This is QA-only and does not turn off HTTPS verification for arbitrary certificates.
  const trustedProxyArgs = [];
  if (proxyUrl && process.env.NODE_EXTRA_CA_CERTS) {
    const bundle = await readFile(process.env.NODE_EXTRA_CA_CERTS, 'utf8');
    const pins = (bundle.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []).map(pem =>
      createHash('sha256').update(new X509Certificate(pem).publicKey.export({ type: 'spki', format: 'der' })).digest('base64'));
    if (pins.length) trustedProxyArgs.push(`--ignore-certificate-errors-spki-list=${pins.join(',')}`);
  }
  browser = await chromium.launch({
    headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: trustedProxyArgs,
    ...(proxyUrl ? { proxy: { server: proxyUrl.origin, bypass: 'localhost,127.0.0.1', ...(proxyUrl.username ? { username: decodeURIComponent(proxyUrl.username), password: decodeURIComponent(proxyUrl.password) } : {}) } } : {})
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [], responses = [], imageFailures = [], mapResponses = []; let started;
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => { if (request.url().startsWith('https://imagery.nationalmap.gov/')) imageFailures.push(request.failure()?.errorText); });
  page.on('response', response => {
    if (response.url().includes('/api/geocode?') || response.url().startsWith('https://imagery.nationalmap.gov/')) responses.push({ service: response.url().includes('/api/geocode?') ? 'Census via Node API' : 'USGS imagery', status: response.status(), contentType: response.headers()['content-type'] });
    if (response.url().startsWith('https://tiles.openfreemap.org/')) mapResponses.push({ path: new URL(response.url()).pathname.includes('.pbf') ? 'tile or glyph' : 'metadata', status: response.status() });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  started = Date.now();
  await page.locator('#property-address').fill('4600 Silver Hill Rd, Washington, DC 20233');
  try { await page.waitForFunction(() => document.querySelector('#aerial-images img')?.naturalWidth > 0, undefined, { timeout: 40000 }); }
  catch { throw new Error(`Live preview did not load: ${await page.locator('#address-status').textContent()} / ${await page.locator('#aerial-status').textContent()} / ${JSON.stringify({ responses, imageFailures })}`); }
  const elapsedMs = Date.now() - started;
  assert.equal(await page.locator('#aerial-controls').isVisible(), true);
  assert.equal(await page.locator('#lengthFt').inputValue(), '48');
  assert.match(await page.locator('#aerial-images img').getAttribute('src'), /^https:\/\/imagery\.nationalmap\.gov\//);
  assert.ok(responses.some(r => r.service === 'Census via Node API' && r.status === 200));
  assert.ok(responses.some(r => r.service === 'USGS imagery' && r.status === 200 && r.contentType.startsWith('image/')));
  await mkdir('qa-output', { recursive: true });
  await page.locator('.hero').screenshot({ path: 'qa-output/live-property-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.locator('.hero').screenshot({ path: 'qa-output/live-property-phone.png' });
  let mapLoaded = false;
  if (process.env.LIVE_PROPERTY_MAP === '1') {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const rasterLoaded = page.waitForResponse(response => {
      const url = new URL(response.url()); return url.hostname === 'imagery.nationalmap.gov' && url.searchParams.get('size') === '256,256' && response.status() === 200;
    }, { timeout: 35000 });
    // Attach a handler immediately so a timeout never becomes an unhandled rejection during map setup.
    rasterLoaded.catch(() => {});
    await page.locator('#aerial-map-toggle').click();
    try { await page.waitForFunction(() => document.querySelector('#aerial-status').textContent.includes('Tap a mapped building'), undefined, { timeout: 25000 }); }
    catch { throw new Error(`Live map did not load: ${await page.locator('#aerial-status').textContent()} / ${JSON.stringify(mapResponses)}`); }
    mapLoaded = true;
    const rasterResponse = await rasterLoaded; await rasterResponse.finished();
    await page.waitForFunction(() => document.querySelector('#aerial-status').textContent.startsWith('Hybrid view ready.'), undefined, { timeout: 60000 });
    await page.locator('.hero').screenshot({ path: 'qa-output/live-hybrid-desktop.png' });
    await page.locator('[data-map-mode="map"]').click();
    await page.locator('.hero').screenshot({ path: 'qa-output/live-map-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.hero').screenshot({ path: 'qa-output/live-map-phone.png' });
    assert.equal(await page.locator('#lengthFt').inputValue(), '48');
  }
  assert.deepEqual(errors, []);
  const evidence = { publicTestAddress: 'U.S. Census Bureau example', elapsedMs, responses, mapLoaded, mapResponses, errors, measurementsChanged: false };
  await writeFile('qa-output/live-property-check.json', JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2));
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
