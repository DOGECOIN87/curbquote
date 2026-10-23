import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { brotliCompressSync, constants as zlib, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import handler from '../api/geocode.js';
import assistantHandler from '../api/assistant.js';
import propertyHandler from '../api/property.js';
import footprintHandler from '../api/footprint.js';
import map3dHandler from '../api/map3d.js';
import leadHandler from '../api/lead.js';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const PUBLIC_ASSETS = Object.freeze(['index.html', 'styles.css', 'main.js', 'estimate.js', 'address.js', 'summary.js', 'project.js', 'storage.js', 'photo-editor.js', 'planning.js', 'assistant-ui.js', 'property-data.js', 'property-ui.js', 'property-view.js', 'property-preview.js', 'property-3d.js', 'google-maps.js', 'address-suggest.js', 'cesium-runtime.js', 'exterior-catalog.js', 'property-exterior.js', 'assets/exteriors/neill-cochran/model.glb', 'assets/exteriors/neill-cochran/prior.glb', 'assets/exteriors/neill-cochran/manifest.json', 'wizard.js', 'property-map.js', 'map-style.js', 'config.js', 'census-jsonp.js', 'house-spec.js', 'intent.js', 'measure-overlay.js', 'osm-tiles.js', 'home-styles.js', 'footprint-client.js', 'lead-form.js', 'remodel-3d.js', 'assets/brand/alco-logo-white.png', 'assets/brand/favicon-32.png', 'assets/brand/apple-touch-icon.png', 'assets/fonts/poppins-latin-400-normal.woff2', 'assets/fonts/poppins-latin-500-normal.woff2', 'assets/fonts/poppins-latin-600-normal.woff2', 'assets/fonts/poppins-latin-700-normal.woff2', 'assets/fonts/poppins-latin-800-normal.woff2', 'assets/fonts/OFL.txt', 'assets/fonts/inter-latin-wght-normal.woff2', 'assets/fonts/instrument-serif-latin-400-italic.woff2', 'assets/fonts/OFL-Inter.txt', 'assets/fonts/OFL-InstrumentSerif.txt', 'assets/brand/alco-logo.png']);
export const MAPLIBRE_PREFIX = 'vendor/maplibre/';
export const MAPLIBRE_SOURCE = join(projectRoot, 'node_modules/maplibre-gl');
export const MAPLIBRE_FILES = Object.freeze(['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css', 'LICENSE.txt']);
export function isMapLibreFile(path) { return MAPLIBRE_FILES.includes(path); }
/** Three.js runtime for the Design studio's 3D remodel preview: lazy-loaded, same vendoring pattern as MapLibre. */
export const THREE_PREFIX = 'vendor/three/';
export const THREE_SOURCE = join(projectRoot, 'node_modules/three');
export const THREE_FILES = Object.freeze(['three.module.js', 'three.core.js', 'LICENSE.txt']);
export function isThreeFile(path) { return THREE_FILES.includes(path); }
/** CesiumJS runtime for the optional 3D view: read from node_modules in development, copied into dist/ by the build. */
export const CESIUM_PREFIX = 'vendor/cesium/';
export const CESIUM_SOURCE = join(projectRoot, 'node_modules/cesium/Build/Cesium');
export const CESIUM_FILES = Object.freeze(['index.js', 'Workers/', 'ThirdParty/', 'Assets/', 'Widgets/CesiumWidget/CesiumWidget.css']);
// Allow only the credit stylesheet CesiumJS injects, its pixelated-rendering probe and the style attributes of
// its Cesium ion and Google logo credits; tests/map3d.test.js recomputes each hash from the installed version.
export const CESIUM_CREDIT_STYLE = "'sha256-gM2CWYHXIHTu7Ts6ncwv0GMWZ9LXGrz2qqqjyuDojl8='";
export const CESIUM_ATTRIBUTE_STYLES = "'sha256-BVJq0J0CcoIBO7ikkmisQ5kYoOnqxRUC37ihQ3YWZQQ=' 'sha256-GU5zilGWFiRrmr4xJeDjQZKuKRcLO8ZT+o0Avfni8Sw=' 'sha256-zJ5DebQiNXIn0/eOUOc+t8ljUCmqg6GgEluhLTpcOWc='";
export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' ${CESIUM_CREDIT_STYLE}; style-src-attr 'unsafe-hashes' ${CESIUM_ATTRIBUTE_STYLES}; img-src 'self' data: blob: https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage https://assets.ion.cesium.com https://maps.googleapis.com/maps/api/streetview https://www.gstatic.com/aerialview/; media-src 'self' https://*.googlevideo.com; font-src 'self'; connect-src 'self' https://places.googleapis.com https://solar.googleapis.com https://aerialview.googleapis.com https://maps.googleapis.com/maps/api/streetview/metadata https://tile.googleapis.com https://api.cesium.com https://assets.ion.cesium.com https://tiles.openfreemap.org https://overpass-api.de https://api.earthdefine.com https://api.eagleview.com https://api.attomdata.com https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage; worker-src 'self' blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`,
  // Origin only, so a key restricted to this site's domains works with Google; USGS images still send none.
  'Referrer-Policy': 'strict-origin',
  // No page feature needs the camera, microphone, location, payments or USB; photos come from a file picker.
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
});
/** Static caching, mirrored in vercel.json: fonts never change, vendor runtimes and images change rarely. */
export const CACHE_RULES = Object.freeze([
  ['/assets/fonts/(.*)', 'public, max-age=31536000, immutable'],
  ['/assets/brand/(.*)', 'public, max-age=604800, stale-while-revalidate=86400'],
  ['/assets/exteriors/(.*)', 'public, max-age=604800, stale-while-revalidate=86400'],
  ['/vendor/(.*)', 'public, max-age=604800, stale-while-revalidate=86400']
]);
export function cacheControl(path) {
  const rule = CACHE_RULES.find(([source]) => path.startsWith(source.replace('(.*)', '')));
  return rule ? rule[1] : 'no-cache';
}
const compressed = new Map();
/** Brotli or gzip for text assets, cached per file version, so large runtimes like CesiumJS ship small. */
function encode(data, accept, key) {
  const encoding = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
  if (!encoding || data.length < 1024) return { body: data, encoding: null };
  const id = `${encoding}:${key}`;
  if (!compressed.has(id)) {
    if (compressed.size > 400) compressed.clear();
    compressed.set(id, encoding === 'br' ? brotliCompressSync(data, { params: { [zlib.BROTLI_PARAM_QUALITY]: 5 } }) : gzipSync(data, { level: 6 }));
  }
  return { body: compressed.get(id), encoding };
}
const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', svg: 'image/svg+xml', txt: 'text/plain', json: 'application/json', wasm: 'application/wasm', glb: 'model/gltf-binary', png: 'image/png', jpg: 'image/jpeg', woff2: 'font/woff2' };
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
export function createAppServer({ geocodeHandler = handler, agentHandler = assistantHandler, dataHandler = propertyHandler, dimensionsHandler = footprintHandler, mapHandler = map3dHandler, contactHandler = leadHandler, assetRoot = projectRoot } = {}) {
  return createServer(async (req, res) => {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { res.writeHead(400); res.end('Invalid URL'); return; }
    if (['/api/assistant', '/api/property', '/api/footprint', '/api/lead'].includes(url.pathname)) {
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
      const targetHandler = { '/api/property': dataHandler, '/api/footprint': dimensionsHandler, '/api/lead': contactHandler }[url.pathname] ?? agentHandler;
      return targetHandler(adapter, adapter);
    }
    if (url.pathname === '/api/geocode') {
      const addresses = url.searchParams.getAll('address');
      const adapter = {
        method: req.method, headers: req.headers, socket: req.socket,
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
    const three = file.startsWith(THREE_PREFIX) && isThreeFile(file.slice(THREE_PREFIX.length));
    if (!PUBLIC_ASSETS.includes(file) && !cesium && !maplibre && !three) { res.writeHead(404); res.end('Not found'); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end('Method not allowed'); return;
    }
    try {
      const fromSource = cesium && assetRoot === projectRoot;
      let path = fromSource ? join(CESIUM_SOURCE, file.slice(CESIUM_PREFIX.length)) : join(assetRoot, file);
      if (maplibre && assetRoot === projectRoot) { const name = file.slice(MAPLIBRE_PREFIX.length); path = join(MAPLIBRE_SOURCE, name === 'LICENSE.txt' ? name : `dist/${name}`); }
      if (three && assetRoot === projectRoot) { const name = file.slice(THREE_PREFIX.length); path = join(THREE_SOURCE, name === 'LICENSE.txt' ? 'LICENSE' : `build/${name}`); }
      const info = await stat(path), version = `${info.size}-${Math.round(info.mtimeMs)}`;
      const etag = `"${createHash('sha1').update(`${file}:${version}`).digest('base64url').slice(0, 20)}"`, extension = file.split('.').pop();
      const headers = { 'Content-Type': textTypes.has(extension) ? `${types[extension]}; charset=utf-8` : types[extension], 'Cache-Control': cacheControl(`/${file}`), ETag: etag, Vary: 'Accept-Encoding' };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
      const data = fromSource ? patchCesium(file.slice(CESIUM_PREFIX.length), await readFile(path)) : await readFile(path);
      const { body, encoding } = textTypes.has(extension) || extension === 'wasm' ? encode(data, String(req.headers['accept-encoding'] || ''), `${path}:${version}`) : { body: data, encoding: null };
      if (encoding) headers['Content-Encoding'] = encoding;
      headers['Content-Length'] = body.length;
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(500); res.end('Unable to read asset'); }
  });
}
