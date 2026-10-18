import { resolveAddress } from '../lib/geocode.mjs';
import { AddressLookupError } from '../address.js';

/** Vercel Node serverless endpoint; do not log or persist residential addresses. */
export function createGeocodeHandler(resolve = resolveAddress) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }); }
    const address = req.query?.address;
    if (typeof address !== 'string') return res.status(400).json({ error: 'Enter one U.S. street address.', code: 'INVALID_ADDRESS' });
    try { return res.status(200).json(await resolve(address)); }
    catch (error) {
      if (error instanceof AddressLookupError) return res.status(error.status).json({ error: error.message, code: error.code });
      // Unexpected exceptions may contain residential addresses or internal details.
      return res.status(500).json({ error: 'Address lookup is unavailable. You can still estimate manually.', code: 'INTERNAL_ERROR' });
    }
  };
}

// Supported Vercel Node request/response signature; this project has no Next.js router.
export default createGeocodeHandler();
