import { createAppServer } from '../lib/web.mjs';
const port = Number(process.env.PORT || 3000);
createAppServer().listen(port, '127.0.0.1', () => console.log(`CurbQuote at http://127.0.0.1:${port}`));
