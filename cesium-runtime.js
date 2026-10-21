/** One self-hosted Cesium runtime, shared by measured exteriors and Google tiles. */
const BASE = new URL('./vendor/cesium/', import.meta.url).href;
let renderer;
export function webgl2Available() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext(); return Boolean(gl);
  } catch { return false; }
}
export function loadCesium() {
  globalThis.CESIUM_BASE_URL = BASE;
  if (!document.querySelector('link[data-cesium]')) {
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `${BASE}Widgets/CesiumWidget/CesiumWidget.css` });
    link.dataset.cesium = ''; document.head.append(link);
  }
  renderer ??= import(`${BASE}index.js`).catch(error => { renderer = null; throw error; });
  return renderer;
}
