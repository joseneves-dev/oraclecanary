import 'dotenv/config';
import { Connection } from '@solana/web3.js';
import pg from 'pg';

import { fetchKaminoReserves } from './adapters/kamino.js';
import { fetchMarginfiBanks } from './adapters/marginfi.js';
import { saveReserveHealth, type ReserveHealthRow } from './db.js';
import { evaluate } from './health.js';
import { fetchPythPrices } from './oracles/pyth.js';
import { fetchScopeFeed, type ScopeFeed } from './oracles/scope.js';
import type { Protocol } from './types.js';

const RPC_URL = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const INTERVAL_SECONDS = Number(process.env.CHECK_INTERVAL_SECONDS ?? 60);
const RUN_ONCE = process.argv.includes('--once');
// getProgramAccounts over every Kamino reserve is the slowest call; a hung request must not stall the loop.
const RPC_TIMEOUT_MS = 60_000;

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (see .env.example)');

const connection = new Connection(RPC_URL, {
  commitment: 'confirmed',
  fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(RPC_TIMEOUT_MS) }),
});
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
// Idle connections can fail (e.g. the database restarts); without a listener that crashes the process.
pool.on('error', (e) => console.error('Database connection error:', e.message));

const nowSeconds = () => Math.floor(Date.now() / 1000);

async function checkKamino(): Promise<ReserveHealthRow[]> {
  const reserves = (await fetchKaminoReserves(connection)).filter((r) => r.status === 'active');

  const feeds = new Map<string, ScopeFeed>();
  for (const address of new Set(reserves.flatMap((r) => (r.feeds.scope ? [r.feeds.scope] : [])))) {
    try {
      feeds.set(address, await fetchScopeFeed(connection, address));
    } catch (e) {
      console.warn(`Scope account ${address} could not be read: ${(e as Error).message}`);
    }
  }

  const now = nowSeconds();
  return reserves.map((reserve) => ({
    reserve,
    health: evaluate(reserve, { scope: reserve.feeds.scope ? feeds.get(reserve.feeds.scope) : undefined }, now),
  }));
}

async function checkMarginfi(): Promise<ReserveHealthRow[]> {
  const banks = (await fetchMarginfiBanks(connection)).filter((b) => b.status === 'active');
  const prices = await fetchPythPrices(connection, banks.flatMap((b) => (b.feeds.pyth ? [b.feeds.pyth] : [])));

  const now = nowSeconds();
  return banks.map((reserve) => ({
    reserve,
    health: evaluate(reserve, { pyth: reserve.feeds.pyth ? prices.get(reserve.feeds.pyth) : undefined }, now),
  }));
}

const PROTOCOLS: [Protocol, () => Promise<ReserveHealthRow[]>][] = [
  ['kamino', checkKamino],
  ['marginfi', checkMarginfi],
];

/** Checks each protocol on its own, so one failing protocol does not stop the others from updating. */
async function runCheck(): Promise<boolean> {
  let allSucceeded = true;
  for (const [protocol, check] of PROTOCOLS) {
    const started = Date.now();
    try {
      const rows = await check();
      await saveReserveHealth(pool, protocol, rows, new Date(nowSeconds() * 1000));

      const listed = rows.filter((r) => r.reserve.marketName);
      const critical = listed.filter((r) => r.health.checks.some((c) => c.severity === 'critical')).length;
      const warning = listed.filter((r) => r.health.checks.some((c) => c.severity === 'warning')).length;
      console.log(
        `${new Date().toISOString()} ${protocol}: checked ${rows.length} reserves (${listed.length} in listed markets: ` +
          `${critical} critical, ${warning} warning) in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    } catch (e) {
      allSucceeded = false;
      console.error(`${protocol} check failed:`, e);
    }
  }
  return allSucceeded;
}

do {
  const ok = await runCheck();
  if (!ok && RUN_ONCE) process.exitCode = 1;
  if (!RUN_ONCE) await new Promise((resolve) => setTimeout(resolve, INTERVAL_SECONDS * 1000));
} while (!RUN_ONCE);

await pool.end();
