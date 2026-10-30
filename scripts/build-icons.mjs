import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { projectRoot } from '../lib/web.mjs';

// Every favicon and app icon is drawn by code from assets/brand/icon.svg: the original Alco logo file,
// unaltered, cropped above its tagline and centred on the logo's own green. Run `npm run build:icons`
// after changing either; the PNGs are committed because browsers and iOS need bitmaps. The maskable
// icon shrinks the mark into the central 80% safe zone that Android crops to a circle.
const brand = join(projectRoot, 'assets/brand');
export const ICONS = Object.freeze([
  ['favicon-32.png', 32, 1], ['apple-touch-icon.png', 180, 1], ['icon-192.png', 192, 1], ['icon-512.png', 512, 1], ['icon-maskable-512.png', 512, .76]
]);
export function iconSvg(source, scale = 1) {
  return scale === 1 ? source : source.replace(/<g id="mark" transform="translate\(([-\d.]+) ([-\d.]+)\)">/, (_, x, y) => `<g id="mark" transform="translate(${256 + (x - 256) * scale} ${256 + (y - 256) * scale}) scale(${scale})">`);
}
export async function buildIcons() {
  const logo = (await readFile(join(brand, 'alco-logo-white.png'))).toString('base64');
  const source = (await readFile(join(brand, 'icon.svg'), 'utf8')).replace('href="alco-logo-white.png"', `href="data:image/png;base64,${logo}"`);
  if (!source.includes('<g id="mark" transform="translate(')) throw new Error('icon.svg needs <g id="mark" transform="translate(x y)">.');
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    for (const [file, size, scale] of ICONS) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${iconSvg(source, scale)}`);
      await writeFile(join(brand, file), await page.screenshot({ type: 'png' }));
      await page.close();
    }
  } finally { await browser.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildIcons();
  console.log(`Drew ${ICONS.length} icons from assets/brand/icon.svg.`);
}
