import { z } from 'zod';
import { createHash } from 'node:crypto';
import { validateSnapshot } from '../planning.js';
import { runProjectAgent, agentAvailability, hasAgentCredentials } from '../lib/agent.mjs';

const requestSchema = z.object({
  snapshot: z.unknown(), prompt: z.string().trim().min(1).max(1800),
  budget: z.number().min(100).max(10000000).nullable().default(null),
  allowPhasing: z.boolean().default(false),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(1800) }).strict()).max(6).default([])
}).strict();

// A prototype guard per warm function instance. Keep Vercel deployment protection enabled.
export function createRequestLimiter({ now = Date.now, limit = 8, windowMs = 600000 } = {}) {
  const entries = new Map();
  return key => {
    const time = now();
    for (const [id, entry] of entries) if (entry.reset <= time) entries.delete(id);
    if (entries.size >= 1000 && !entries.has(key)) return false;
    const entry = entries.get(key) || { count: 0, reset: time + windowMs };
    entry.count++; entries.set(key, entry);
    return entry.count <= limit;
  };
}
const limiter = createRequestLimiter();

export function createAssistantHandler({ run = runProjectAgent, available = agentAvailability, configured = hasAgentCredentials, allow = limiter } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'GET') {
      // Configuration health never calls a model or exposes balances, tokens or addresses.
      return res.status(200).json(await available());
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed.' }); }
    if (req.headers?.origin) {
      let origin; try { origin = new URL(req.headers.origin).host; } catch { /* rejected below */ }
      if (origin !== req.headers.host) return res.status(403).json({ error: 'Use the assistant from the CurbQuote page.' });
    }
    if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) return res.status(415).json({ error: 'Send a JSON project request.' });
    if (+req.headers?.['content-length'] > 24000) return res.status(413).json({ error: 'Project request is too large.' });
    let request;
    try {
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
      if (Buffer.byteLength(raw) > 24000) return res.status(413).json({ error: 'Project request is too large.' });
      request = requestSchema.parse(JSON.parse(raw));
      request.snapshot = validateSnapshot(request.snapshot);
    } catch { return res.status(400).json({ error: 'Check your project details and enter a request of up to 1,800 characters.' }); }
    if (!configured()) return res.status(503).json({ code: 'AI_UNAVAILABLE', error: 'AI is not connected here. Use automatic planning below.' });
    const ip = String(req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'local');
    if (!allow(createHash('sha256').update(ip).digest('hex'))) { res.setHeader('Retry-After', '600'); return res.status(429).json({ code: 'RATE_LIMIT', error: 'Assistant request limit reached. Automatic planning is still available.' }); }
    try { return res.status(200).json(await run(request)); }
    catch {
      // Provider errors may contain prompts, billing details and authentication metadata.
      return res.status(503).json({ code: 'AI_UNAVAILABLE', error: 'AI could not complete this request. Automatic planning is still available.' });
    }
  };
}
export default createAssistantHandler();
