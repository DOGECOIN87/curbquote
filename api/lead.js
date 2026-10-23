/**
 * "Send to Alco Products": the homeowner's contact details and their estimate brief, posted as JSON
 * to `LEAD_WEBHOOK_URL` (a CRM form, Zapier, Make or a similar inbox). Nothing is stored here. With
 * no webhook, GET tells the page to offer an email to `LEAD_EMAIL` instead.
 */
import { z } from 'zod';
import { clientKey, createRequestLimiter } from '../lib/rate-limit.mjs';

const text = max => z.string().trim().max(max);
const requestSchema = z.object({
  contact: z.object({
    name: text(100).min(1),
    email: text(200).email(),
    phone: text(40).regex(/^[\d\s()+.-]*$/).optional(),
    notes: text(1000).optional()
  }).strict(),
  consent: z.literal(true),
  estimate: z.object({
    address: text(200).optional(),
    range: text(80).optional()
  }).strict(),
  brief: text(20000).min(1)
}).strict();

const limiter = createRequestLimiter({ limit: 5 });

/** Where requests go: a webhook (https) for direct delivery, an address for the email fallback. */
export function leadConfig(env = process.env) {
  const webhook = String(env.LEAD_WEBHOOK_URL ?? '').trim(), email = String(env.LEAD_EMAIL ?? '').trim();
  return {
    webhook: /^https:\/\/[^\s]+$/.test(webhook) ? webhook : null,
    email: /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i.test(email) ? email : null
  };
}

export function createLeadHandler({ env = process.env, fetchImpl = fetch, allow = limiter, now = () => new Date() } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const { webhook, email } = leadConfig(env);
    if (req.method === 'GET') return res.status(200).json({ configured: Boolean(webhook), email });
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
    }
    if (req.headers?.origin) {
      let origin;
      try { origin = new URL(req.headers.origin).host; } catch { /* rejected below */ }
      if (origin !== req.headers.host) return res.status(403).json({ error: 'Send your request from the Alco Products page.', code: 'ORIGIN_DENIED' });
    }
    if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) {
      return res.status(415).json({ error: 'Send a JSON request.', code: 'INVALID_REQUEST' });
    }
    let body;
    try {
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
      if (+req.headers?.['content-length'] > 24000 || Buffer.byteLength(raw) > 24000) return res.status(413).json({ error: 'The request is too large.', code: 'INVALID_REQUEST' });
      body = requestSchema.parse(JSON.parse(raw));
    } catch {
      return res.status(400).json({ error: 'Enter your name and a valid email, and agree to be contacted.', code: 'INVALID_REQUEST' });
    }
    if (!webhook) return res.status(503).json({ error: 'Sending is not set up yet.', code: 'LEAD_NOT_CONFIGURED', email });
    if (!allow(clientKey(req))) {
      res.setHeader('Retry-After', '600');
      return res.status(429).json({ error: 'Too many requests. Please call Alco Products instead.', code: 'RATE_LIMIT' });
    }
    try {
      const response = await fetchImpl(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'CurbQuote', submittedAt: now().toISOString(), contact: body.contact, estimate: body.estimate, brief: body.brief }),
        redirect: 'error',
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`);
      return res.status(200).json({ sent: true });
    } catch {
      return res.status(502).json({ error: 'Your request could not be delivered. Please try again or call Alco Products.', code: 'LEAD_DELIVERY_FAILED', email });
    }
  };
}

export default createLeadHandler();
