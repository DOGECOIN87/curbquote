import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';
import handler from '../api/geocode.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
const port = Number(process.env.PORT || 3000);
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/geocode') {
    const adapter = {
      method: req.method, query: Object.fromEntries(url.searchParams),
      setHeader: (k, v) => res.setHeader(k, v),
      status: code => { res.statusCode = code; return adapter; },
      json: data => { res.end(JSON.stringify(data)); return adapter; }
    };
    return handler(adapter, adapter);
  }
  const allowed = new Set(['/', '/index.html', '/main.js', '/estimate.js', '/styles.css']);
  if (!allowed.has(url.pathname)) { res.writeHead(404); return res.end('Not found'); }
  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const data = await readFile(join(root, file.slice(1)));
    res.writeHead(200, { 'Content-Type': types[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  } catch { res.writeHead(500); res.end('Unable to read asset'); }
}).listen(port, '127.0.0.1', () => console.log(`CurbQuote at http://127.0.0.1:${port}`));
