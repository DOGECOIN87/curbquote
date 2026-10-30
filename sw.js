/** Makes CurbQuote installable and usable offline once visited. Pages, scripts and styles come from the
    network first so a deploy shows at once; the cached copy answers only when the network fails. Fonts,
    brand images, models and vendor runtimes are served from the cache and refreshed in the background.
    API calls, other origins and anything but GET always go to the network. */
const CACHE = 'curbquote-v0.18.0';
const SHELL = ['./', 'styles.css', 'main.js', 'manifest.webmanifest', 'assets/brand/icon-192.png', 'assets/brand/icon-512.png', 'assets/brand/alco-logo.webp', 'assets/brand/alco-logo.png'];
const scope = new URL(self.registration.scope);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('curbquote-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

const stored = (request, response) => {
  if (response.ok && response.type === 'basic' && !response.headers.get('Cache-Control')?.includes('no-store')) {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
  }
  return response;
};
async function networkFirst(request, fallback) {
  try { return stored(request, await fetch(request)); }
  catch (error) { const hit = await caches.match(request, { ignoreSearch: request.mode === 'navigate' }) || (fallback && await caches.match(fallback)); if (hit) return hit; throw error; }
}
async function cacheFirst(request) {
  const hit = await caches.match(request), refresh = fetch(request).then(response => stored(request, response));
  if (hit) { refresh.catch(() => {}); return hit; }
  return refresh;
}

self.addEventListener('fetch', event => {
  const { request } = event, url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.has('range') || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length);
  // The Google 3D runtime is large and useless offline, so it is left to the HTTP cache.
  if (path.startsWith('api/') || path.startsWith('vendor/cesium/')) return;
  if (request.mode === 'navigate') event.respondWith(networkFirst(request, './'));
  else if (/^(assets|vendor)\//.test(path)) event.respondWith(cacheFirst(request));
  else event.respondWith(networkFirst(request));
});
