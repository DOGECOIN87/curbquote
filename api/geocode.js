import { resolveAddress } from '../lib/geocode.mjs';

/** Vercel Node serverless endpoint; do not log or persist residential addresses. */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed.' }); }
  const address = req.query?.address;
  if (typeof address !== 'string') return res.status(400).json({ error: 'Enter one U.S. street address.' });
  try { return res.status(200).json(await resolveAddress(address)); }
  catch (error) {
    const badInput = /^Enter|unsupported/.test(error.message);
    return res.status(badInput ? 400 : 422).json({ error: error.message });
  }
}
