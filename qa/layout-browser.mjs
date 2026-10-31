// Every step at device shapes from a 280 px fold cover screen to a 3440 px ultrawide: nothing scrolls
// sideways, no visible control is covered by another, the step's main action can be reached and pressed,
// and on Steps 2–4 the house keeps a usable share of the screen. `--report` lists problems without failing.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createAppServer } from '../lib/web.mjs';

export const SHAPES = Object.freeze([
  ['fold cover, narrow', 280, 653], ['small phone', 320, 568], ['fold cover', 344, 882], ['compact phone', 360, 640],
  ['tall phone', 360, 800], ['phone', 390, 844], ['large phone', 412, 915], ['max phone', 430, 932],
  ['small phone, sideways', 568, 320], ['phone, sideways', 667, 375], ['tall phone, sideways', 740, 360], ['large phone, sideways', 932, 430],
  ['fold open', 800, 1000], ['fold open, wide', 884, 1104], ['square window', 800, 800], ['tablet', 768, 1024],
  ['large tablet', 820, 1180], ['tablet pro', 1024, 1366], ['tablet, sideways', 1024, 768], ['large tablet, sideways', 1180, 820],
  ['short laptop', 1280, 600], ['laptop', 1280, 720], ['laptop', 1366, 768], ['desktop', 1440, 900],
  ['full HD', 1920, 1080], ['ultrawide', 2560, 1080], ['ultrawide QHD', 3440, 1440]
]);

// Everything in view that a person could press, with whatever sits on top of its centre.
function inspect() {
  const vw = innerWidth, vh = innerHeight, problems = [];
  const name = el => (el.id ? `#${el.id}` : '') + (el.getAttribute('aria-label') || el.textContent || el.value || el.className || el.tagName).toString().trim().replace(/\s+/g, ' ').slice(0, 40);
  const live = el => el.getClientRects().length && !el.closest('[hidden],[inert],[aria-hidden="true"],details:not([open])') && getComputedStyle(el).visibility === 'visible' && getComputedStyle(el).pointerEvents !== 'none';
  if (document.documentElement.scrollWidth > vw + 1) problems.push(`page scrolls sideways (${document.documentElement.scrollWidth} px wide)`);
  const modal = document.querySelector('dialog[open]');
  for (const el of document.querySelectorAll('button,a[href],input:not([type=hidden]):not([type=file]),select,textarea,summary,[role=tab]')) {
    if (!live(el) || (modal && !modal.contains(el)) || el.closest('.sr-only')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
    const target = el.matches('input[type=checkbox],input[type=radio]') ? el.closest('label') || el : el;
    const clear = () => {
      const box = target.getBoundingClientRect(), hit = document.elementFromPoint(Math.min(Math.max(box.left + box.width / 2, 1), vw - 1), Math.min(Math.max(box.top + box.height / 2, 1), vh - 1));
      return !hit || target.contains(hit) || hit.contains(target) || (el.labels && [...el.labels].some(label => label.contains(hit))) ? null : hit;
    };
    // Content passing under a sticky bar is fine as long as scrolling brings it out, the way a person would.
    let hit = clear();
    if (hit) { target.scrollIntoView({ block: 'center', inline: 'nearest' }); hit = clear(); }
    if (hit) problems.push(`"${name(el)}" is covered by "${name(hit)}"`);
    if (r.left < -1 || r.right > vw + 1) problems.push(`"${name(el)}" runs off the side of the screen`);
  }
  return problems;
}

// The step's main action: brought into view the way a person would scroll to it, then pressable.
async function mainAction(page) {
  return page.evaluate(() => {
    const live = el => el.getClientRects().length && !el.closest('[hidden],[inert]') && getComputedStyle(el).visibility === 'visible';
    const action = [...document.querySelectorAll('.panel-continue button,.sheet-continue button,#send-lead,.instant-actions .primary-button,#property-address')].find(live);
    if (!action) return 'no main action is visible';
    action.scrollIntoView({ block: 'nearest' });
    const r = action.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight + 1 || r.left < 0 || r.right > innerWidth + 1) return `"${action.textContent.trim()}" can't be scrolled fully into view`;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit && (action.contains(hit) || hit.contains(action)) ? null : `"${action.textContent.trim()}" is covered after scrolling to it`;
  });
}

// On Steps 2–4: how much of the screen shows the house before any scrolling.
async function houseShare(page) {
  return page.evaluate(() => {
    window.scrollTo(0, 0);
    const canvas = document.querySelector('#studio-canvas'), r = canvas?.getBoundingClientRect();
    if (!r || !canvas.getClientRects().length) return null;
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)), w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    return { height: Math.round(h), share: Math.round(100 * h * w / innerWidth / innerHeight) };
  });
}

export async function auditLayouts({ shapes = SHAPES, outputDir = null } = {}) {
  const server = createAppServer({ dimensionsHandler: async (req, res) => res.status(503).json({ error: 'Synthetic open footprint outage.', code: 'FOOTPRINT_UPSTREAM_UNAVAILABLE' }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--enable-unsafe-swiftshader'] });
  const report = [];
  try {
    for (const [label, width, height] of shapes) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce', hasTouch: width < 1024 });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const views = [['Step 1', null], ['Step 2', 2], ['Step 3', 3], ['Step 4', 4], ['Step 5', 5], ['project sheet', 'sheet'], ['saved projects', 'dialog']];
      for (const [view, go] of views) {
        if (typeof go === 'number') { await page.locator(`[data-goto="${go}"]`).first().click(); await page.waitForTimeout(go === 5 ? 300 : 600); }
        if (go === 'sheet') {
          await page.locator('[data-goto="2"]').first().click(); await page.waitForTimeout(300);
          if (!await page.locator('#open-project-sheet').isVisible()) continue;   // Wide layouts show the panel beside the house.
          await page.locator('#open-project-sheet').click(); await page.waitForTimeout(450);
        }
        if (go === 'dialog') { await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelector('#projects-dialog').showModal()); await page.waitForTimeout(200); }
        const problems = await page.evaluate(inspect);
        if (go !== 'sheet' && go !== 'dialog') { const action = await mainAction(page); if (action) problems.push(action); }
        if ([2, 3, 4].includes(go)) {
          const house = await houseShare(page);
          if (house && (house.height < 150 || house.share < 22)) problems.push(`the house gets ${house.height} px (${house.share}% of the screen)`);
        }
        if (outputDir) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: join(outputDir, `${width}x${height}-${view.replace(/\s+/g, '-')}.jpg`), type: 'jpeg', quality: 55 }); }
        for (const problem of problems) report.push({ shape: `${label} ${width}×${height}`, view, problem });
        if (go === 'dialog') await page.evaluate(() => document.querySelector('#projects-dialog').close());
        if (go === 'sheet') await page.keyboard.press('Escape');
      }
      await page.close();
    }
  } finally { await browser.close(); server.close(); }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const outputDir = resolve(process.env.QA_OUTPUT_DIR || 'qa-output', 'layouts');
  await mkdir(outputDir, { recursive: true });
  const report = await auditLayouts({ outputDir });
  if (process.argv.includes('--report')) console.log(JSON.stringify(report, null, 1));
  else {
    assert.deepEqual(report, [], 'Layout problems');
    console.log(`Layouts hold at ${SHAPES.length} device shapes: every step, the project sheet and the saved-projects dialog.`);
  }
}
