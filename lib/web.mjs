import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import handler from '../api/geocode.js';
import assistantHandler from '../api/assistant.js';
import propertyHandler from '../api/property.js';
import map3dHandler from '../api/map3d.js';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const PUBLIC_ASSETS = Object.freeze(['index.html', 'styles.css', 'main.js', 'estimate.js', 'address.js', 'summary.js', 'project.js', 'storage.js', 'photo-editor.js', 'planning.js', 'assistant-ui.js', 'property-data.js', 'property-ui.js', 'property-view.js', 'property-preview.js', 'property-3d.js', 'property-map.js', 'map-style.js', 'config.js', 'census-jsonp.js', 'assets/brand/alco-lockup-header.png', 'assets/brand/alco-difference.png', 'assets/brand/favicon-32.png', 'assets/brand/apple-touch-icon.png', 'assets/fonts/montserrat-latin-wght-normal.woff2', 'assets/fonts/OFL.txt']);
export const MAPLIBRE_PREFIX = 'vendor/maplibre/';
export const MAPLIBRE_SOURCE = join(projectRoot, 'node_modules/maplibre-gl');
export const MAPLIBRE_FILES = Object.freeze(['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css', 'LICENSE.txt']);
export function isMapLibreFile(path) { return MAPLIBRE_FILES.includes(path); }
/** CesiumJS runtime for the optional 3D view: read from node_modules in development, copied into dist/ by the build. */
export const CESIUM_PREFIX = 'vendor/cesium/';
export const CESIUM_SOURCE = join(projectRoot, 'node_modules/cesium/Build/Cesium');
export const CESIUM_FILES = Object.freeze(['index.js', 'Workers/', 'ThirdParty/', 'Assets/', 'Widgets/CesiumWidget/CesiumWidget.css']);
// Allow only the credit stylesheet CesiumJS injects, its pixelated-rendering probe and the style attributes of
// its Cesium ion and Google logo credits; tests/map3d.test.js recomputes each hash from the installed version.
export const CESIUM_CREDIT_STYLE = "'sha256-gM2CWYHXIHTu7Ts6ncwv0GMWZ9LXGrz2qqqjyuDojl8='";
export const CESIUM_ATTRIBUTE_STYLES = "'sha256-BVJq0J0CcoIBO7ikkmisQ5kYoOnqxRUC37ihQ3YWZQQ=' 'sha256-GU5zilGWFiRrmr4xJeDjQZKuKRcLO8ZT+o0Avfni8Sw=' 'sha256-zJ5DebQiNXIn0/eOUOc+t8ljUCmqg6GgEluhLTpcOWc='";
export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' ${CESIUM_CREDIT_STYLE}; style-src-attr 'unsafe-hashes' ${CESIUM_ATTRIBUTE_STYLES}; img-src 'self' data: blob: https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage https://assets.ion.cesium.com; font-src 'self'; connect-src 'self' https://tile.googleapis.com https://api.cesium.com https://assets.ion.cesium.com https://tiles.openfreemap.org https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage; worker-src 'self' blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`,
  // Origin only, so a key restricted to this site's domains works with Google; USGS images still send none.
  'Referrer-Policy': 'strict-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
});
const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', svg: 'image/svg+xml', txt: 'text/plain', json: 'application/json', wasm: 'application/wasm', png: 'image/png', jpg: 'image/jpeg', woff2: 'font/woff2' };
const textTypes = new Set(['html', 'css', 'js', 'mjs', 'svg', 'txt', 'json']);
/** knockout, bundled into CesiumJS for its widgets, finds the global object with eval, which the CSP forbids. */
export function patchCesium(path, data) {
  if (path !== 'index.js') return data;
  const source = data.toString('utf8'), lookup = '(0,eval)("this")';
  if (source.split(lookup).length !== 2) throw new Error('The CesiumJS global lookup changed; review patchCesium before upgrading.');
  return Buffer.from(source.replace(lookup, 'globalThis'));
}
export function isCesiumFile(path) {
  if (!/^[\w./-]+$/.test(path) || path.split('/').some(part => part === '..' || part === '.' || part === '')) return false;
  if (!types[path.split('.').pop()]) return false;
  return CESIUM_FILES.some(entry => entry.endsWith('/') ? path.startsWith(entry) : path === entry);
}

/** Same geocoding handler as Vercel, plus only the explicit public browser assets. */
export function createAppServer({ geocodeHandler = handler, agentHandler = assistantHandler, dataHandler = propertyHandler, mapHandler = map3dHandler, assetRoot = projectRoot } = {}) {
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
    if (url.pathname === '/api/map3d') {
      const adapter = {
        method: req.method,
        setHeader: (key, value) => res.setHeader(key, value),
        status: code => { res.statusCode = code; return adapter; },
        json: data => { res.end(JSON.stringify(data)); return adapter; }
      };
      return mapHandler(adapter, adapter);
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const cesium = file.startsWith(CESIUM_PREFIX) && isCesiumFile(file.slice(CESIUM_PREFIX.length));
    const maplibre = file.startsWith(MAPLIBRE_PREFIX) && isMapLibreFile(file.slice(MAPLIBRE_PREFIX.length));
    if (!PUBLIC_ASSETS.includes(file) && !cesium && !maplibre) { res.writeHead(404); res.end('Not found'); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end('Method not allowed'); return;
    }
    try {
      const fromSource = cesium && assetRoot === projectRoot;
      let path = fromSource ? join(CESIUM_SOURCE, file.slice(CESIUM_PREFIX.length)) : join(assetRoot, file);
      if (maplibre && assetRoot === projectRoot) { const name = file.slice(MAPLIBRE_PREFIX.length); path = join(MAPLIBRE_SOURCE, name === 'LICENSE.txt' ? name : `dist/${name}`); }
      const data = fromSource ? patchCesium(file.slice(CESIUM_PREFIX.length), await readFile(path)) : await readFile(path), extension = file.split('.').pop();
      res.writeHead(200, { 'Content-Type': textTypes.has(extension) ? `${types[extension]}; charset=utf-8` : types[extension], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(500); res.end('Unable to read asset'); }
  });
}
