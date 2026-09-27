import 'dotenv/config';
import { Connection } from '@solana/web3.js';
import pg from 'pg';

import { fetchKaminoReserves } from './adapters/kamino.js';
import { saveReserveHealth } from './db.js';
import { evaluate } from './health.js';
import { fetchScopeFeed, type ScopeFeed } from './oracles/scope.js';

const RPC_URL = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const INTERVAL_SECONDS = Number(process.env.CHECK_INTERVAL_SECONDS ?? 60);
const RUN_ONCE = process.argv.includes('--once');

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (see .env.example)');

const connection = new Connection(RPC_URL, 'confirmed');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function runCheck(): Promise<void> {
  const started = Date.now();
  const reserves = (await fetchKaminoReserves(connection)).filter((r) => r.status === 'active');

  const feeds = new Map<string, ScopeFeed>();
  for (const address of new Set(reserves.flatMap((r) => (r.feeds.scope ? [r.feeds.scope] : [])))) {
    try {
      feeds.set(address, await fetchScopeFeed(connection, address));
    } catch (e) {
      console.warn(`Scope account ${address} could not be read: ${(e as Error).message}`);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const rows = reserves.map((reserve) => ({
    reserve,
    health: evaluate(reserve, reserve.feeds.scope ? feeds.get(reserve.feeds.scope) : undefined, now),
  }));
  await saveReserveHealth(pool, rows, new Date(now * 1000));

  const listed = rows.filter((r) => r.reserve.marketName);
  const critical = listed.filter((r) => r.health.checks.some((c) => c.severity === 'critical')).length;
  const warning = listed.filter((r) => r.health.checks.some((c) => c.severity === 'warning')).length;
  console.log(
    `${new Date().toISOString()} checked ${rows.length} reserves (${listed.length} in listed markets: ` +
      `${critical} critical, ${warning} warning) in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

do {
  try {
    await runCheck();
  } catch (e) {
    console.error('Check failed:', e);
    if (RUN_ONCE) process.exitCode = 1;
  }
  if (!RUN_ONCE) await new Promise((resolve) => setTimeout(resolve, INTERVAL_SECONDS * 1000));
} while (!RUN_ONCE);

await pool.end();
