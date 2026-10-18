import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMap3DHandler } from '../api/map3d.js';
import { createAppServer, patchCesium, isCesiumFile, CESIUM_SOURCE, SECURITY_HEADERS } from '../lib/web.mjs';

const call = (handler, method = 'GET') => new Promise(resolve => {
  const headers = {}, res = { setHeader: (key, value) => { headers[key] = value; }, status: code => ({ json: body => resolve({ code, body, headers }) }) };
  handler({ method }, res);
});
const sha = text => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
async function withServer(t, options) {
  const server = createAppServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('3D configuration exposes the browser key only when one is set', async () => {
  for (const value of [undefined, '', '   ', 'short', 'has spaces in the middle of key']) {
    const { code, body, headers } = await call(createMap3DHandler({ env: { GOOGLE_MAP_TILES_KEY: value } }));
    assert.equal(code, 200); assert.deepEqual(body, { configured: false }); assert.equal(headers['Cache-Control'], 'no-store');
  }
  const { body } = await call(createMap3DHandler({ env: { GOOGLE_MAP_TILES_KEY: ' AIzaSyEXAMPLE-key_0123456789 ' } }));
  assert.deepEqual(body, { configured: true, provider: 'Google Photorealistic 3D Tiles', key: 'AIzaSyEXAMPLE-key_0123456789' });
  const ionToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzeW50aGV0aWMiOnRydWV9.c3ludGhldGljLXNpZ25hdHVyZQ';
  assert.deepEqual((await call(createMap3DHandler({ env: { CESIUM_ION_TOKEN: ionToken } }))).body, { configured: true, provider: 'Google Photorealistic 3D Tiles via Cesium ion', ionToken });
  assert.deepEqual((await call(createMap3DHandler({ env: { CESIUM_ION_TOKEN: 'not a token' } }))).body, { configured: false });
  // A Google key wins, and the ion token is then never sent to the browser.
  assert.deepEqual((await call(createMap3DHandler({ env: { CESIUM_ION_TOKEN: ionToken, GOOGLE_MAP_TILES_KEY: 'AIzaSyEXAMPLE-key_0123456789' } }))).body, { configured: true, provider: 'Google Photorealistic 3D Tiles', key: 'AIzaSyEXAMPLE-key_0123456789' });
  const post = await call(createMap3DHandler({ env: {} }), 'POST');
  assert.equal(post.code, 405); assert.equal(post.headers.Allow, 'GET');
});
test('the development server serves the allowlisted CesiumJS runtime with binary types and the CSP patch', async t => {
  const base = await withServer(t, { mapHandler: createMap3DHandler({ env: {} }) });
  assert.deepEqual(await (await fetch(`${base}/api/map3d`)).json(), { configured: false });
  const bundle = await fetch(`${base}/vendor/cesium/index.js`);
  assert.equal(bundle.status, 200); assert.equal(bundle.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.doesNotMatch(await bundle.text(), /\(0,eval\)/);
  const wasm = await fetch(`${base}/vendor/cesium/ThirdParty/draco_decoder.wasm`);
  assert.equal(wasm.status, 200); assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.equal((await fetch(`${base}/vendor/cesium/Widgets/CesiumWidget/CesiumWidget.css`)).status, 200);
  for (const path of ['Cesium.js', 'index.cjs', 'Widgets/Animation/Animation.css', '../package.json', 'Assets/../index.cjs', 'Workers/']) {
    assert.equal(isCesiumFile(path), false, path);
    assert.equal((await fetch(`${base}/vendor/cesium/${path}`)).status, 404, path);
  }
});
test('the CSP allows exactly the inline styles the installed CesiumJS uses, and no eval', async () => {
  const source = await readFile(join(CESIUM_SOURCE, 'index.js'), 'utf8'), csp = SECURITY_HEADERS['Content-Security-Policy'];
  // The credit stylesheet is a template literal; resolve its constants the way the browser would.
  const mark = source.indexOf('.cesium-credit-lightbox-overlay {');
  const css = source.slice(source.lastIndexOf('`', mark) + 1, source.indexOf('`', mark)).replace(/\$\{(\w+)\}/g, (_, name) => {
    const value = source.match(new RegExp(`[,;{\\s]${name}=("[^"]*"|\\d+(?:\\.\\d+)?)[,;]`))[1];
    return value.startsWith('"') ? JSON.parse(value) : value;
  });
  assert.match(csp, new RegExp(`style-src 'self' ${sha(css).replaceAll('+', '\\+')};`));
  for (const attribute of ['image-rendering: -moz-crisp-edges;image-rendering: pixelated;', 'vertical-align: -7px', 'vertical-align:-6px']) {
    assert.ok(source.includes(attribute), attribute);
    assert.ok(csp.split('style-src-attr')[1].split(';')[0].includes(sha(attribute)), attribute);
  }
  assert.doesNotMatch(csp, /'unsafe-eval'|'unsafe-inline'/);
  assert.equal(patchCesium('index.js', Buffer.from(source)).toString().includes('(0,eval)'), false);
  assert.throws(() => patchCesium('index.js', Buffer.from('no global lookup here')), /review patchCesium/);
});
