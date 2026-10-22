import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AddressLookupError } from '../address.js';
import { FootprintLookupError, footprintAvailability, resolveFootprint } from '../lib/footprint.mjs';
import { createRequestLimiter } from '../lib/rate-limit.mjs';

const requestSchema = z.object({
  address: z.string().min(6).max(120).optional(),
  coordinates: z.object({
    lat: z.number().finite().min(-90).max(90),
    lon: z.number().finite().min(-180).max(180)
  }).strict(),
  styleId: z.string().max(48).optional(),
  consented: z.boolean()
}).strict();

const limiter = createRequestLimiter({ limit: 10 });

export function createFootprintHandler({ resolve = resolveFootprint, available = footprintAvailability, allow = limiter } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'GET') return res.status(200).json(available());
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
    }
    if (req.headers?.origin) {
      let origin;
      try { origin = new URL(req.headers.origin).host; } catch { /* rejected below */ }
      if (origin !== req.headers.host) return res.status(403).json({ error: 'Use footprint lookup from the Alco Products page.', code: 'ORIGIN_DENIED' });
    }
    if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) {
      return res.status(415).json({ error: 'Send a JSON footprint request.', code: 'INVALID_REQUEST' });
    }
    let body;
    try {
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
      if (+req.headers?.['content-length'] > 2000 || Buffer.byteLength(raw) > 2000) {
        return res.status(413).json({ error: 'Footprint request is too large.', code: 'INVALID_REQUEST' });
      }
      body = requestSchema.parse(JSON.parse(raw));
    } catch {
      return res.status(400).json({ error: 'Supply valid U.S. coordinates and confirmation to request building dimensions.', code: 'INVALID_REQUEST' });
    }
    const ip = String(req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'local');
    if (!allow(createHash('sha256').update(ip).digest('hex'))) {
      res.setHeader('Retry-After', '600');
      return res.status(429).json({ error: 'Footprint request limit reached. Enter measurements manually.', code: 'RATE_LIMIT' });
    }
    try {
      return res.status(200).json(await resolve(body));
    } catch (error) {
      if (error instanceof FootprintLookupError || error instanceof AddressLookupError) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      return res.status(500).json({ error: 'Building footprint lookup is unavailable. Enter measurements manually.', code: 'INTERNAL_ERROR' });
    }
  };
}

export default createFootprintHandler();
