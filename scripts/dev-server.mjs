import { createAppServer } from '../lib/web.mjs';
import { loadSkin } from '../lib/skin.mjs';
const port = Number(process.env.PORT || 3000);
// `SKIN=example npm run dev` previews another skin's look without switching to it (docs/26-skins.md).
const skin = process.env.SKIN ? await loadSkin(process.env.SKIN) : undefined;
createAppServer({ skin }).listen(port, '127.0.0.1', () => console.log(`CurbQuote at http://127.0.0.1:${port}${skin ? ` (previewing the "${skin.id}" skin)` : ''}`));
