import { resolveAddress } from '../lib/geocode.mjs';
import { AddressLookupError } from '../address.js';
import { clientKey, createRequestLimiter } from '../lib/rate-limit.mjs';

// Typing pauses trigger lookups, so the guard is generous; it stops scripted loops, not homeowners.
const limiter = createRequestLimiter({ limit: 90 });

/** Vercel Node serverless endpoint; do not log or persist residential addresses. */
export function createGeocodeHandler(resolve = resolveAddress, { allow = limiter } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }); }
    const address = req.query?.address;
    if (typeof address !== 'string') return res.status(400).json({ error: 'Enter one U.S. street address.', code: 'INVALID_ADDRESS' });
    if (!allow(clientKey(req))) { res.setHeader('Retry-After', '600'); return res.status(429).json({ error: 'Address lookup limit reached. Wait a few minutes or continue with manual details.', code: 'RATE_LIMIT' }); }
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
