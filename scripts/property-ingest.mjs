import { fileURLToPath } from 'node:url';
import { resolveProperty } from '../lib/property.mjs';

export async function ingestOne(address, { resolve = resolveProperty } = {}) {
  const record = await resolve(address);
  if (!record.source.permissions.mayExport || record.source.expiresAt !== null || record.source.retentionDays !== null) throw new Error('The configured grant does not permit this unmanaged CLI export. Use the temporary browser display.');
  return { provider: record.source.provider, retrieved_at: record.source.retrievedAt, facts: record.facts, source: record.source, warnings: record.warnings };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Supply one quoted U.S. street address.');
    process.stdout.write(JSON.stringify(await ingestOne(process.argv[2])) + '\n');
  } catch (error) {
    // resolveProperty exposes only safe errors; do not print a provider stack or environment.
    process.stderr.write(`error: ${error.message}\n`); process.exitCode = 2;
  }
}
