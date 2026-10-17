import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import handler from '../api/geocode.js';
import assistantHandler from '../api/assistant.js';
import propertyHandler from '../api/property.js';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const PUBLIC_ASSETS = Object.freeze(['index.html', 'styles.css', 'main.js', 'estimate.js', 'address.js', 'summary.js', 'project.js', 'storage.js', 'photo-editor.js', 'planning.js', 'assistant-ui.js', 'property-data.js', 'property-ui.js', 'property-view.js', 'property-preview.js']);
export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
});
const types = { html: 'text/html', css: 'text/css', js: 'text/javascript' };

/** Same geocoding handler as Vercel, plus only the explicit public browser assets. */
export function createAppServer({ geocodeHandler = handler, agentHandler = assistantHandler, dataHandler = propertyHandler, assetRoot = projectRoot } = {}) {
  return createServer(async (req, res) => {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { res.writeHead(400); res.end('Invalid URL'); return; }
    if (url.pathname === '/api/assistant' || url.pathname === '/api/property') {
      let body = '', bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 24000) { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Project request is too large.' })); return; }
        body += chunk;
      }
      const adapter = {
        method: req.method, headers: req.headers, socket: req.socket, body,
        setHeader: (key, value) => res.setHeader(key, value),
        status: code => { res.statusCode = code; return adapter; },
        json: data => { res.end(JSON.stringify(data)); return adapter; }
      };
      return (url.pathname === '/api/property' ? dataHandler : agentHandler)(adapter, adapter);
    }
    if (url.pathname === '/api/geocode') {
      const addresses = url.searchParams.getAll('address');
      const adapter = {
        method: req.method,
        query: { address: addresses.length === 1 ? addresses[0] : addresses.length ? addresses : undefined },
        setHeader: (key, value) => res.setHeader(key, value),
        status: code => { res.statusCode = code; return adapter; },
        json: data => { res.end(JSON.stringify(data)); return adapter; }
      };
      return geocodeHandler(adapter, adapter);
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!PUBLIC_ASSETS.includes(file)) { res.writeHead(404); res.end('Not found'); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end('Method not allowed'); return;
    }
    try {
      const data = await readFile(join(assetRoot, file));
      res.writeHead(200, { 'Content-Type': `${types[file.split('.').pop()]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(500); res.end('Unable to read asset'); }
  });
}
