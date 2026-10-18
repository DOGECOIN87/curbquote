/**
 * Census address lookup straight from the browser, for the static GitHub Pages demo. The Census API
 * sends no CORS headers but supports JSONP, so the answer arrives as a call to a one-off callback.
 */
import { parseCensusResult } from './address.js';

const ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
let counter = 0;

export function lookupCensus(address, signal) {
  return new Promise((resolve, reject) => {
    const name = `curbquoteCensus${Date.now()}_${counter++}`, script = document.createElement('script');
    // A late answer after a cancel still calls the callback, so it is replaced rather than deleted.
    const finish = () => { window[name] = () => { delete window[name]; }; script.remove(); signal?.removeEventListener('abort', aborted); };
    const aborted = () => { finish(); reject(new DOMException('Address lookup was cancelled.', 'AbortError')); };
    if (signal?.aborted) { reject(new DOMException('Address lookup was cancelled.', 'AbortError')); return; }
    window[name] = payload => { finish(); try { resolve(parseCensusResult(payload)); } catch (error) { reject(error); } };
    script.onerror = () => { finish(); reject(new TypeError('Address lookup could not connect.')); };
    signal?.addEventListener('abort', aborted, { once: true });
    script.src = `${ENDPOINT}?${new URLSearchParams({ address, benchmark: 'Public_AR_Current', format: 'jsonp', callback: name })}`;
    document.head.append(script);
  });
}
