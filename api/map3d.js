/**
 * Reports whether the optional Google 3D view is configured. The browser key is public by design:
 * restrict it in Google Cloud to this site's domains and to the Map Tiles API, with a daily quota.
 */
export function createMap3DHandler({ env = process.env } = {}) {
  return (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }); }
    const key = String(env.GOOGLE_MAP_TILES_KEY ?? '').trim();
    if (!/^[\w-]{20,120}$/.test(key)) return res.status(200).json({ configured: false });
    return res.status(200).json({ configured: true, provider: 'Google Photorealistic 3D Tiles', key });
  };
}
export default createMap3DHandler();
