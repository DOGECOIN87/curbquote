import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { projectRoot } from '../lib/web.mjs';
import { ICON_FILES, loadSkin } from '../lib/skin.mjs';
import { BRAND } from '../brand.js';
import { themeTokens } from '../skin-theme.js';

// Every favicon and app icon is drawn by code, into the skin's own folder. A skin may bring an
// `icon.svg` (Alco's places its logo file, unaltered, cropped above its tagline on the logo's own
// green); without one, the skin's dark-background logo is centred on its dark colour. Run
// `npm run build:icons` (or `npm run build:icons -- <skin>`) after changing either; the PNGs are
// committed because browsers and iOS need bitmaps. The maskable icon shrinks the mark into the central
// 80% safe zone that Android crops to a circle.
const SIZES = Object.freeze({ 'favicon-32.png': [32, 1], 'apple-touch-icon.png': [180, 1], 'icon-192.png': [192, 1], 'icon-512.png': [512, 1], 'icon-maskable-512.png': [512, .76] });
export const ICONS = Object.freeze(ICON_FILES.map(file => [file, ...SIZES[file]]));
const MIME = { png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg' };
export function iconSvg(source, scale = 1) {
  return scale === 1 ? source : source.replace(/<g id="mark" transform="translate\(([-\d.]+) ([-\d.]+)\)">/, (_, x, y) => `<g id="mark" transform="translate(${256 + (x - 256) * scale} ${256 + (y - 256) * scale}) scale(${scale})">`);
}
/** The icon for a skin with no icon.svg: its logo for dark backgrounds, 420 px wide, centred on the dark colour. */
export function defaultIconSvg(skin) {
  const { logo } = skin, file = logo.onDark ?? logo.src, width = 420, height = Math.min(420, Math.round(width * logo.height / logo.width)), fitted = Math.round(height * logo.width / logo.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${themeTokens(skin)['--forest']}"/><g id="mark" transform="translate(${(512 - fitted) / 2} ${(512 - height) / 2})"><image href="${file}" width="${fitted}" height="${height}"/></g></svg>`;
}
export async function buildIcons(skin = BRAND) {
  const folder = join(projectRoot, 'skins', skin.id);
  let source = await readFile(join(folder, 'icon.svg'), 'utf8').catch(() => defaultIconSvg(skin));
  // Images the SVG names are read from the skin folder and carried inside it.
  for (const [, file] of [...source.matchAll(/href="([\w.-]+\.(?:png|webp|svg|jpg))"/g)]) {
    source = source.replaceAll(`href="${file}"`, `href="data:${MIME[file.split('.').pop()]};base64,${(await readFile(join(folder, file))).toString('base64')}"`);
  }
  if (!source.includes('<g id="mark" transform="translate(')) throw new Error('icon.svg needs <g id="mark" transform="translate(x y)">.');
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    for (const [file, size, scale] of ICONS) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${iconSvg(source, scale)}`);
      await writeFile(join(folder, file), await page.screenshot({ type: 'png' }));
      await page.close();
    }
  } finally { await browser.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const skin = process.argv[2] ? await loadSkin(process.argv[2]) : BRAND;
  await buildIcons(skin);
  console.log(`Drew ${ICONS.length} icons into skins/${skin.id}/.`);
}
