/**
 * Reports whether the optional Google 3D view is configured. Both credentials are public by design:
 * restrict a Google key to this site's domains, the Map Tiles API and a daily quota; restrict a
 * Cesium ion token to assets:read and this site's URLs. A Google key wins when both are set.
 */
export function map3dConfig(env = process.env) {
  const key = String(env.GOOGLE_MAP_TILES_KEY ?? '').trim(), ionToken = String(env.CESIUM_ION_TOKEN ?? '').trim();
  if (/^[\w-]{20,120}$/.test(key)) return { configured: true, provider: 'Google Photorealistic 3D Tiles', key };
  // Cesium ion's free plan serves the same Google tiles for personal use and evaluation, not launch.
  if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(ionToken) && ionToken.length <= 2000) return { configured: true, provider: 'Google Photorealistic 3D Tiles via Cesium ion', ionToken };
  return { configured: false };
}
export function createMap3DHandler({ env = process.env } = {}) {
  return (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }); }
    return res.status(200).json(map3dConfig(env));
  };
}
export default createMap3DHandler();
