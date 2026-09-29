import type { IncomingMessage, ServerResponse } from 'node:http';

import { PublicKey } from '@solana/web3.js';

import type { WalletPositions } from './positions.js';

/**
 * The HTTP side of GET /api/wallets/{address}/positions, kept apart from the server and the RPC so
 * it can be tested with a fake lookup.
 *
 * The endpoint is public and every lookup spends RPC calls on the same key the indexer depends on,
 * so it is guarded on several levels: answers are cached per wallet, a wallet being looked up is not
 * looked up twice, only a few lookups run at once, each visitor gets a small number of new lookups a
 * minute, all visitors together a larger one, and a lookup that hangs is given up on.
 */

export interface PositionsHttpOptions {
  lookup(wallet: PublicKey): Promise<WalletPositions>;
  now?: () => number;
  cacheMs?: number;
  maxConcurrent?: number;
  /** New (uncached) lookups one visitor may start per minute. */
  perVisitorPerMinute?: number;
  /** New lookups all visitors together may start per minute. */
  globalPerMinute?: number;
  timeoutMs?: number;
}

const ROUTE = /^\/api\/wallets\/([^/]{1,64})\/positions\/?$/;
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MINUTE = 60_000;

class Timeout extends Error {}

export function createPositionsHandler(options: PositionsHttpOptions) {
  const now = options.now ?? Date.now;
  const cacheMs = options.cacheMs ?? 60_000;
  const maxConcurrent = options.maxConcurrent ?? 4;
  const perVisitor = options.perVisitorPerMinute ?? 10;
  const globalLimit = options.globalPerMinute ?? 120;
  const timeoutMs = options.timeoutMs ?? 15_000;

  const cache = new Map<string, { at: number; result: WalletPositions }>();
  const pending = new Map<string, Promise<WalletPositions>>();
  /** Start times of the new lookups in the last minute, per visitor and in total. */
  const visitorStarts = new Map<string, number[]>();
  let globalStarts: number[] = [];

  const recent = (times: number[]) => times.filter((t) => now() - t < MINUTE);

  function lookup(wallet: string): Promise<WalletPositions> {
    const inFlight = pending.get(wallet);
    if (inFlight) return inFlight;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Timeout(`lookup took over ${timeoutMs} ms`)), timeoutMs);
    });
    // A hung RPC call must not hold a slot forever: past the timeout the slot is freed.
    const promise = Promise.race([options.lookup(new PublicKey(wallet)), timeout]).finally(() => {
      clearTimeout(timer);
      pending.delete(wallet);
    });
    pending.set(wallet, promise);
    return promise;
  }

  /**
   * The visitor, as Cloudflare reports it; the web server passes the header through. Someone reaching
   * the server without Cloudflare can fake it, which the global limit still covers.
   */
  function visitor(req: IncomingMessage): string {
    const header = req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for'];
    const value = Array.isArray(header) ? header[0] : header;
    return value?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  }

  function send(req: IncomingMessage, res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body));
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?')[0];
    if (path === '/health') return send(req, res, 200, { ok: true, lookups: pending.size });

    const match = ROUTE.exec(path);
    if (!match) return send(req, res, 404, { error: 'Not found. Use GET /api/wallets/{address}/positions.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(req, res, 405, { error: 'Only GET is supported.' }, { Allow: 'GET, HEAD' });
    }

    let wallet: string;
    try {
      // Base58 of the right length can still be the wrong size once decoded.
      if (!BASE58_ADDRESS.test(match[1])) throw new Error('not base58');
      wallet = new PublicKey(match[1]).toBase58();
    } catch {
      return send(req, res, 400, { error: 'Not a Solana address.' });
    }

    // The data is public on-chain and keyed by the address, so shared caches may keep it briefly too.
    const cacheHeaders = { 'Cache-Control': 'public, max-age=30, s-maxage=30' };
    const cached = cache.get(wallet);
    if (cached && now() - cached.at < cacheMs) return send(req, res, 200, cached.result, cacheHeaders);

    if (!pending.has(wallet)) {
      const who = visitor(req);
      const mine = recent(visitorStarts.get(who) ?? []);
      globalStarts = recent(globalStarts);
      if (mine.length >= perVisitor) {
        return send(req, res, 429, { error: 'Too many wallets looked up from here. Wait a minute and try again.' }, { 'Retry-After': '60' });
      }
      if (globalStarts.length >= globalLimit || pending.size >= maxConcurrent) {
        return send(req, res, 503, { error: 'Busy looking up other wallets. Try again in a few seconds.' }, { 'Retry-After': '5' });
      }
      mine.push(now());
      visitorStarts.set(who, mine);
      globalStarts.push(now());
      // Keeps the per-visitor record from growing without bound.
      if (visitorStarts.size > 10_000) for (const [key, times] of visitorStarts) if (!recent(times).length) visitorStarts.delete(key);
    }

    try {
      const result = await lookup(wallet);
      // A partial answer (a source could not be read) is not kept, so the next visit tries again.
      if (result.failed?.length) return send(req, res, 200, result);
      cache.set(wallet, { at: now(), result });
      if (cache.size > 5_000) for (const [key, entry] of cache) if (now() - entry.at >= cacheMs) cache.delete(key);
      send(req, res, 200, result, cacheHeaders);
    } catch (e) {
      console.error(`Positions of ${wallet}: ${(e as Error).message}`);
      send(req, res, e instanceof Timeout ? 504 : 502, {
        error: 'Could not read this wallet from the Solana network right now. Try again shortly.',
      });
    }
  };
}
