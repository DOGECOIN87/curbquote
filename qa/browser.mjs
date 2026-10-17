import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { createGeocodeHandler } from '../api/geocode.js';
import { resolveAddress } from '../lib/geocode.mjs';
import { createAppServer } from '../lib/web.mjs';
const live = process.env.LIVE_GEOCODE === '1';
const outputDir = resolve(process.env.QA_OUTPUT_DIR || 'qa-output');
const server = createAppServer(live ? {} : {
  geocodeHandler: createGeocodeHandler(value => resolveAddress(value, async url => {
    assert.equal(new URL(url).hostname, 'geocoding.geo.census.gov');
    return { ok: true, json: async () => ({ result: { addressMatches: [{
      matchedAddress: '4600 SILVER HILL RD, WASHINGTON, DC, 20233',
      coordinates: { x: -76.9, y: 38.84 }
    }] } }) };
  }))
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
const checks = [];
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && !message.text().includes('status of 404') && !message.text().includes('status of 503') && !message.text().includes('status of 500')) errors.push(message.text()); });
try {
  await page.goto(base);
  await page.locator('#calculate').click();
  assert.equal(await page.locator('#total-range').textContent(), '$19,020 – $53,453');
  checks.push('Default manual estimate reconciles with the tested calculation');
  await page.locator('#existingWindows').fill('2');
  assert.equal(await page.locator('#results').isVisible(), false);
  await page.locator('#existingWindows').fill('12');
  assert.equal(await page.locator('#results').isVisible(), true);
  checks.push('Correcting invalid counts automatically restores live estimates');
  await page.evaluate(() => { document.querySelector('#windowLowEach').value = '1900'; });
  await page.locator('#calculate').click();
  assert.equal(await page.locator('#price-details').getAttribute('open'), '');
  assert.equal(await page.locator('#windowLowEach').getAttribute('aria-invalid'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'windowLowEach');
  await page.locator('#windowLowEach').fill('600.25');
  assert.equal(await page.locator('#results').isVisible(), true);
  assert.match(await page.locator('#pricing-source').textContent(), /edited example rates/);
  checks.push('Hidden price errors open and focus the affected field; edits restore results');
  await page.locator('#yearBuilt').fill('1970');
  assert.equal(await page.locator('#lead-notice').isVisible(), true);
  await page.locator('#yearBuilt').fill('1998');
  assert.equal(await page.locator('#lead-notice').isVisible(), false);
  checks.push('Pre-1978 advisory follows the current year input');
  await page.locator('#lengthFt').fill('');
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  assert.match(await page.locator('#print-report-content').textContent(), /No valid estimate/);
  assert.doesNotMatch(await page.locator('#print-report-content').textContent(), /\$/);
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('#print-report').isVisible(), true);
  assert.equal(await page.locator('.page-shell').isVisible(), false);
  await page.emulateMedia({ media: 'screen' });
  await page.locator('#lengthFt').fill('48');
  checks.push('Browser-menu print cannot expose a stale estimate after invalid input');
  await page.locator('#property-address').fill('4600 Silver Hill Rd, Washington, DC 20233');
  await page.locator('#verify-address').click();
  await page.waitForFunction(() => !document.querySelector('#verify-address').disabled, undefined, { timeout: 12000 });
  assert.match(await page.locator('#address-status').textContent(), /Approximate location matched/);
  assert.equal(await page.locator('#lengthFt').inputValue(), '48');
  checks.push(`${live ? 'Live Census' : 'Fixture provider'} browser → Node API → matched-address display, without changing dimensions`);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#save-summary').click();
  const download = await downloadPromise;
  const exported = await readFile(await download.path(), 'utf8');
  assert.match(exported, /manual-geometry-v2/);
  assert.match(exported, /illustrative-usd-v1 \(edited\)/);
  assert.match(exported, /600.25–1300\/each/);
  assert.match(exported, /4600 SILVER HILL RD/);
  assert.equal(exported, await page.locator('#print-report-content').textContent());
  checks.push('Download and print share the full input, pricing, provenance and assumptions report');
  const valid = { matchedAddress: '999 TEST ST, AUSTIN, TX, 78701', coordinates: { lat: 30.2, lon: -97.7 }, source: 'U.S. Census Geocoder — address-range approximation' };
  await page.route('**/api/geocode?**', route => route.fulfill({ status: 500, contentType: 'text/html', body: '<h1>Unavailable</h1>' }));
  await page.locator('#verify-address').click();
  await page.waitForFunction(() => !document.querySelector('#verify-address').disabled);
  assert.match(await page.locator('#address-status').textContent(), /unreadable response/);
  assert.equal(await page.locator('#results').isVisible(), true);
  await page.unroute('**/api/geocode?**');
  await page.route('**/api/geocode?**', route => route.fulfill({ json: { matchedAddress: '', coordinates: { lat: null, lon: 0 } } }));
  await page.locator('#verify-address').click();
  await page.waitForFunction(() => !document.querySelector('#verify-address').disabled);
  assert.match(await page.locator('#address-status').textContent(), /incomplete location data/);
  await page.unroute('**/api/geocode?**');
  checks.push('Unreadable and malformed lookup responses leave manual estimates usable');
  let releaseOld, sawOld;
  const oldSeen = new Promise(resolve => { sawOld = resolve; });
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  await page.route('**/api/geocode?**', async route => {
    if (new URL(route.request().url()).searchParams.get('address').startsWith('123')) {
      sawOld(); await oldGate; await route.fulfill({ json: { ...valid, matchedAddress: '123 OLD ST, AUSTIN, TX, 78701' } }).catch(() => {});
    } else await route.fulfill({ json: valid });
  });
  await page.locator('#property-address').fill('123 Old St, Austin, TX 78701');
  await page.locator('#verify-address').click();
  await oldSeen;
  await page.locator('#property-address').fill('999 Test St, Austin, TX 78701');
  assert.equal(await page.locator('#verify-address').isDisabled(), false);
  await page.locator('#verify-address').click();
  await page.waitForFunction(() => document.querySelector('#address-status').textContent.includes('999 TEST ST'));
  releaseOld();
  await page.waitForTimeout(50);
  assert.doesNotMatch(await page.locator('#address-status').textContent(), /123 OLD ST/);
  checks.push('Editing an address cancels the pending lookup and late responses cannot overwrite the new match');
  await page.unroute('**/api/geocode?**');
  await page.route('**/api/geocode?**', async () => {});
  await page.clock.install();
  await page.locator('#verify-address').click();
  await page.clock.runFor(9100);
  await page.waitForFunction(() => document.querySelector('#address-status').textContent.includes('timed out'));
  assert.equal(await page.locator('#verify-address').isDisabled(), false);
  await page.unroute('**/api/geocode?**');
  checks.push('Client lookup deadline releases the button and displays a manual-estimate fallback');
  await page.locator('#windowLowEach').fill('500');
  await page.locator('#price-details > summary').click();
  await mkdir(outputDir, { recursive: true });
  const matrix = [[320,740],[360,800],[390,844],[560,800],[768,1024],[921,800],[1024,768],[1440,1000],[2560,1440],[844,390]];
  const overflows = [];
  for (const [width,height] of matrix) {
    await page.setViewportSize({ width, height });
    const result = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth,
      clipped: [...document.querySelectorAll('label,.total-range,.item-price,.result-heading,.section-label,.hero h1,.eyebrow')].filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 2).map(el => ({text:el.textContent,scroll:el.scrollWidth,width:el.clientWidth})) }));
    if (result.document > width + 1 || result.clipped.length) overflows.push(result);
    if (width === 390 || width === 1440) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(outputDir, `default-${width}.png`), fullPage: true });
    }
  }
  assert.deepEqual(overflows, [], 'Default layout overflow');
  await page.evaluate(() => {
    const values = {lengthFt:350,widthFt:350,stories:4,storyHeightFt:16,gables:12,gableRiseFt:20,masonryPercent:0,
      existingWindows:150,existingDoors:50,replaceWindows:150,replaceDoors:50,sidingLowPerSqFt:100,sidingHighPerSqFt:100,
      windowLowEach:20000,windowHighEach:20000,doorLowEach:30000,doorHighEach:30000};
    for (const [id,value] of Object.entries(values)) document.getElementById(id).value = value;
    document.getElementById('lengthFt').dispatchEvent(new Event('input',{bubbles:true}));
  });
  for (const [width,height] of matrix) {
    await page.setViewportSize({width,height});
    const result = await page.evaluate(() => ({ width:innerWidth, document:document.documentElement.scrollWidth,
      clipped:[...document.querySelectorAll('.total-range,.item-price,.result-heading,.scope-table dd')].filter(el=>el.getClientRects().length && el.scrollWidth>el.clientWidth+2).map(el=>({text:el.textContent,width:el.clientWidth,scroll:el.scrollWidth})) }));
    if(result.document>width+1||result.clipped.length) overflows.push(result);
  }
  assert.deepEqual(overflows, [], 'Maximum legal input values overflow');
  checks.push('No page overflow or clipped labels/ranges at 10 phone, tablet, desktop and landscape sizes, including maximum input values');
  await page.emulateMedia({media:'print'});
  await page.screenshot({path:join(outputDir,'print-report.png'),fullPage:true});
  assert.deepEqual(errors, []);
  checks.push('No JavaScript exceptions or CSP errors');
  await writeFile(join(outputDir,'checks.json'),JSON.stringify({checks,matrix},null,2));
  console.log(JSON.stringify({passed:checks.length,provider:live ? 'live Census' : 'fixture',checks,matrix},null,2));
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
