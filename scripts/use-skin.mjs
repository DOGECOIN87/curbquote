import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectRoot } from '../lib/web.mjs';
import { listSkins, loadSkin, skinProblems } from '../lib/skin.mjs';
import { BRAND } from '../brand.js';

// `npm run skin` lists the skins and checks each one. `npm run skin -- <name>` switches the app to a
// skin by pointing brand.js at its folder, after checking it: the names and links, the logo files, that
// text stays readable on its colours and that every product has a name and a price range.
const [name] = process.argv.slice(2);
if (!name) {
  for (const id of await listSkins()) {
    const problems = await skinProblems(await loadSkin(id), { folder: id });
    console.log(`${id === BRAND.id ? '*' : ' '} ${id}${problems.length ? `: ${problems.length} problem${problems.length > 1 ? 's' : ''}` : ''}`);
    for (const problem of problems) console.log(`    ${problem}`);
  }
  console.log('\n* in use. Switch with: npm run skin -- <name>');
} else {
  const problems = await skinProblems(await loadSkin(name), { folder: name });
  if (problems.length) {
    console.error(`The "${name}" skin is not ready:\n${problems.map(problem => `  ${problem}`).join('\n')}`);
    process.exit(1);
  }
  const file = join(projectRoot, 'brand.js'), source = await readFile(file, 'utf8'), line = /from '\.\/skins\/[a-z0-9-]+\/skin\.js';/;
  if (!line.test(source)) throw new Error('brand.js changed; update scripts/use-skin.mjs.');
  await writeFile(file, source.replace(line, `from './skins/${name}/skin.js';`));
  console.log(name === BRAND.id ? `Already using the "${name}" skin.` : `Now using the "${name}" skin (was "${BRAND.id}"). Run npm run check, then build or deploy.`);
}
