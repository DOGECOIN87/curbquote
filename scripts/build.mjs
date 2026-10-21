import { mkdir, copyFile, cp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_ASSETS, CESIUM_FILES, CESIUM_PREFIX, CESIUM_SOURCE, MAPLIBRE_FILES, MAPLIBRE_PREFIX, MAPLIBRE_SOURCE, THREE_FILES, THREE_PREFIX, THREE_SOURCE, isCesiumFile, patchCesium, projectRoot } from '../lib/web.mjs';

export async function buildPublicAssets(destination = join(projectRoot, 'dist')) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const file of PUBLIC_ASSETS) {
    const target = join(destination, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(projectRoot, file), target);
  }
  await mkdir(join(destination, MAPLIBRE_PREFIX), { recursive: true });
  for (const file of MAPLIBRE_FILES) await copyFile(join(MAPLIBRE_SOURCE, file === 'LICENSE.txt' ? file : `dist/${file}`), join(destination, MAPLIBRE_PREFIX, file));
  await mkdir(join(destination, THREE_PREFIX), { recursive: true });
  for (const file of THREE_FILES) await copyFile(join(THREE_SOURCE, file === 'LICENSE.txt' ? 'LICENSE' : `build/${file}`), join(destination, THREE_PREFIX, file));
  // Only the CesiumJS runtime the 3D view loads; the same allowlist governs the development server.
  const keep = async source => (await stat(source)).isDirectory() || isCesiumFile(relative(CESIUM_SOURCE, source).split(sep).join('/'));
  for (const entry of CESIUM_FILES) {
    const target = join(destination, CESIUM_PREFIX, entry);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(CESIUM_SOURCE, entry), target, { recursive: true, filter: keep });
  }
  const bundle = join(destination, CESIUM_PREFIX, 'index.js');
  await writeFile(bundle, patchCesium('index.js', await readFile(bundle)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPublicAssets();
  console.log(`Built ${PUBLIC_ASSETS.length} public browser assets and self-hosted MapLibre/Cesium/Three.js runtimes in dist/. Node APIs remain in api/.`);
}
