import { mkdir, copyFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_ASSETS, projectRoot } from '../lib/web.mjs';

export async function buildPublicAssets(destination = join(projectRoot, 'dist')) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const file of PUBLIC_ASSETS) await copyFile(join(projectRoot, file), join(destination, file));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPublicAssets();
  console.log(`Built ${PUBLIC_ASSETS.length} public browser assets in dist/. API remains in api/geocode.js.`);
}
