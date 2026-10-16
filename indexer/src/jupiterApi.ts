/**
 * Jupiter's HTTP API. Without a key, calls go to lite-api.jup.ag, which limits requests per IP and can
 * answer 429 to a server for hours; with JUPITER_API_KEY (free at https://portal.jup.ag) they go to
 * api.jup.ag, which limits them per key. Both serve the same paths.
 */
const KEYED_BASE = 'https://api.jup.ag';
const KEYLESS_BASE = 'https://lite-api.jup.ag';

/** GETs `path` (with its query) from Jupiter, with the API key when one is set. */
export function jupiterFetch(path: string, timeoutMs: number, fetchImpl: typeof fetch = fetch, key = process.env.JUPITER_API_KEY?.trim()): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  return key ? fetchImpl(KEYED_BASE + path, { signal, headers: { 'x-api-key': key } }) : fetchImpl(KEYLESS_BASE + path, { signal });
}
