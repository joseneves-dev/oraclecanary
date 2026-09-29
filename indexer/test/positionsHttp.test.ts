import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import type { PublicKey } from '@solana/web3.js';

import type { WalletPositions } from '../src/positions.js';
import { createPositionsHandler, type PositionsHttpOptions } from '../src/positionsHttp.js';

const WALLET = 'BKLBmxGDFrGK63QwhFgUcvqRQfWnTeJzUeMaoKcDGcvH';
const OTHER = 'AHtF8UD3SPAUpiTrwZXLxmJcsgdhDtSryKguyF3auZpS';

const positions = (wallet: PublicKey): WalletPositions => ({
  wallet: wallet.toBase58(),
  positions: [],
  notCovered: ['jupiter-lend'],
  failed: [],
  checkedAt: '2026-09-29T00:00:00.000Z',
});

/** Starts the handler on a random port; returns a request helper and a way to stop it. */
async function serve(options: Partial<PositionsHttpOptions> = {}) {
  let lookups = 0;
  const handle = createPositionsHandler({
    lookup: async (wallet) => {
      lookups++;
      return positions(wallet);
    },
    ...options,
  });
  const server: Server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    get: (path: string, init: RequestInit = {}) => fetch(base + path, init),
    lookups: () => lookups,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('positions endpoint', () => {
  let api: Awaited<ReturnType<typeof serve>>;
  before(async () => {
    api = await serve();
  });
  after(() => api.close());

  it('returns the positions and caches them for a minute', async () => {
    const first = await api.get(`/api/wallets/${WALLET}/positions`);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'public, max-age=30, s-maxage=30');
    assert.equal(((await first.json()) as WalletPositions).wallet, WALLET);

    await api.get(`/api/wallets/${WALLET}/positions?ignored=1`);
    assert.equal(api.lookups(), 1);
  });

  it('rejects what is not a Solana address, and unknown paths and methods', async () => {
    assert.equal((await api.get('/api/wallets/abc/positions')).status, 400);
    // Base58 of a valid length that does not decode to 32 bytes.
    assert.equal((await api.get(`/api/wallets/${'1'.repeat(44)}/positions`)).status, 400);
    assert.equal((await api.get('/')).status, 404);
    const post = await api.get(`/api/wallets/${WALLET}/positions`, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
  });
});

describe('positions endpoint limits', () => {
  it('limits new lookups per visitor, while cached answers stay free', async () => {
    const api = await serve({ perVisitorPerMinute: 1 });
    try {
      const as = { headers: { 'CF-Connecting-IP': '203.0.113.7' } };
      assert.equal((await api.get(`/api/wallets/${WALLET}/positions`, as)).status, 200);
      assert.equal((await api.get(`/api/wallets/${WALLET}/positions`, as)).status, 200, 'cached');
      const limited = await api.get(`/api/wallets/${OTHER}/positions`, as);
      assert.equal(limited.status, 429);
      assert.equal(limited.headers.get('retry-after'), '60');
      // Another visitor is not affected.
      assert.equal((await api.get(`/api/wallets/${OTHER}/positions`, { headers: { 'CF-Connecting-IP': '198.51.100.2' } })).status, 200);
    } finally {
      await api.close();
    }
  });

  it('gives up on a lookup that hangs and frees its slot', async () => {
    const api = await serve({ lookup: () => new Promise(() => {}), timeoutMs: 20, maxConcurrent: 1 });
    try {
      assert.equal((await api.get(`/api/wallets/${WALLET}/positions`)).status, 504);
      // The slot was freed: the next wallet is looked up (and times out) rather than refused as busy.
      assert.equal((await api.get(`/api/wallets/${OTHER}/positions`)).status, 504);
    } finally {
      await api.close();
    }
  });

  it('answers 503 while every slot is busy, and 502 when the lookup fails', async () => {
    let release: () => void = () => {};
    const api = await serve({
      maxConcurrent: 1,
      lookup: (wallet) =>
        wallet.toBase58() === WALLET ? new Promise((resolve) => (release = () => resolve(positions(wallet)))) : Promise.reject(new Error('rpc down')),
    });
    try {
      const slow = api.get(`/api/wallets/${WALLET}/positions`);
      await new Promise((r) => setTimeout(r, 20));
      const busy = await api.get(`/api/wallets/${OTHER}/positions`);
      assert.equal(busy.status, 503);
      assert.equal(busy.headers.get('retry-after'), '5');
      release();
      assert.equal((await slow).status, 200);
      assert.equal((await api.get(`/api/wallets/${OTHER}/positions`)).status, 502);
    } finally {
      await api.close();
    }
  });
});
