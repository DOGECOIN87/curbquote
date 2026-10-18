import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';

export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19) || a === 192 && b === 0 && (c === 0 || c === 2) || a === 198 && b === 51 && c === 100 || a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) !== 6) return false;
  const v = new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase();
  return /^[23]/.test(v) && !v.startsWith('2001::') && !/^2001:(?:db8|0|10|20):/.test(v) && !v.startsWith('2002:') && !v.startsWith('3fff:');
}

/** DNS results are validated and pinned into HTTPS; redirects never receive the Bearer credential. */
export async function fetchPropertyJson(url, { apiKey, signal, maxBytes = 1048576, resolve = lookup, requestImpl = request } = {}) {
  const pending = resolve(url.hostname, { all: true, verbatim: true });
  let abort;
  const timeout = new Promise((_, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }); });
  let addresses;
  try { signal.throwIfAborted(); addresses = await Promise.race([pending, timeout]); }
  finally { signal.removeEventListener('abort', abort); }
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) throw new Error('Provider host is not public.');
  return new Promise((resolveResult, reject) => {
    const headers = { Accept: 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': 'CurbQuoteAuthorizedAdapter/1.0' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const req = requestImpl(url, { method: 'GET', headers, signal,
      lookup: (_hostname, options, done) => options.all ? done(null, addresses) : done(null, addresses[0].address, addresses[0].family)
    }, response => {
      const status = response.statusCode;
      if (status !== 200) { response.destroy(); resolveResult({ status }); return; }
      const type = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!(type === 'application/json' || /^application\/[a-z0-9.+-]+\+json$/.test(type)) || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(); reject(new Error('Provider did not return plain JSON.')); return; }
      if (+response.headers['content-length'] > maxBytes) { response.destroy(); reject(new Error('Provider response is too large.')); return; }
      const chunks = []; let bytes = 0;
      response.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) { response.destroy(); reject(new Error('Provider response is too large.')); } else chunks.push(chunk); });
      response.on('end', () => { try { resolveResult({ status, payload: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch { reject(new Error('Provider returned invalid JSON.')); } });
      response.on('error', reject);
    });
    req.on('error', reject); req.end();
  });
}
