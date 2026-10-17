/** Per warm-instance prototype guard; deployment protection and durable production limits remain necessary. */
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
