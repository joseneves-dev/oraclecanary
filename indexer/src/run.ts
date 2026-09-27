import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Connection, PublicKey } from '@solana/web3.js';
import pg from 'pg';

import { decodeDataStreamsTimestamp, fetchJupiterLendVaults, ORACLE_PROGRAM as JUPITER_ORACLE_PROGRAM } from './adapters/jupiterLend.js';
import { fetchKaminoReserves } from './adapters/kamino.js';
import { fetchMarginfiBanks } from './adapters/marginfi.js';
import { saveReserveHealth, type ReserveHealthRow } from './db.js';
import { evaluate } from './health.js';
import { fetchChainlinkPrices } from './oracles/chainlink.js';
import { fetchPythPrices } from './oracles/pyth.js';
import { fetchScopeFeed, type ScopeFeed } from './oracles/scope.js';
import type { OracleSource, Protocol } from './types.js';

const RPC_URL = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const INTERVAL_SECONDS = Number(process.env.CHECK_INTERVAL_SECONDS ?? 60);
const RUN_ONCE = process.argv.includes('--once');
// A health change is recorded only once it has lasted this long, so a price that is late for one run
// does not become an alert.
const CONFIRM_SECONDS = Number(process.env.ALERT_CONFIRM_SECONDS ?? 180);
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

/**
 * Written after every run in which all protocols were saved; the container health check fails when
 * it gets old, so a stuck or failing loop shows up as "unhealthy".
 */
const HEARTBEAT_FILE = process.env.HEARTBEAT_FILE ?? join(tmpdir(), 'oraclecanary-indexer.heartbeat');

async function writeHeartbeat(): Promise<void> {
  try {
    await writeFile(HEARTBEAT_FILE, new Date().toISOString());
  } catch (e) {
    console.warn(`Could not write the heartbeat file: ${(e as Error).message}`);
  }
}

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

/** Last update time of each Jupiter Lend oracle source, read according to its type. */
async function fetchJupiterSourceTimes(sources: OracleSource[]): Promise<Map<string, number>> {
  const byType = (type: string) => sources.filter((s) => s.type === type).map((s) => s.account);
  const times = new Map<string, number>();

  for (const [account, price] of await fetchPythPrices(connection, byType('Pyth'))) times.set(account, price.publishTime);
  for (const [account, price] of await fetchChainlinkPrices(connection, byType('Chainlink'))) times.set(account, price.timestamp);

  const streams = [...new Set(byType('ChainlinkDataStreams'))];
  const infos = await connection.getMultipleAccountsInfo(streams.map((a) => new PublicKey(a)));
  infos.forEach((info, i) => {
    if (info?.owner.toBase58() === JUPITER_ORACLE_PROGRAM) times.set(streams[i], decodeDataStreamsTimestamp(Buffer.from(info.data)));
  });
  return times;
}

async function checkJupiterLend(): Promise<ReserveHealthRow[]> {
  const vaults = await fetchJupiterLendVaults(connection);
  const sourceTimes = await fetchJupiterSourceTimes(vaults.flatMap((v) => v.oracle?.sources ?? []));

  const now = nowSeconds();
  return vaults.map((reserve) => ({ reserve, health: evaluate(reserve, { sourceTimes }, now) }));
}

const PROTOCOLS: [Protocol, () => Promise<ReserveHealthRow[]>][] = [
  ['kamino', checkKamino],
  ['marginfi', checkMarginfi],
  ['jupiter-lend', checkJupiterLend],
];

/** Checks each protocol on its own, so one failing protocol does not stop the others from updating. */
async function runCheck(): Promise<boolean> {
  let allSucceeded = true;
  for (const [protocol, check] of PROTOCOLS) {
    const started = Date.now();
    try {
      const rows = await check();
      const changes = await saveReserveHealth(pool, protocol, rows, new Date(nowSeconds() * 1000), CONFIRM_SECONDS);

      const listed = rows.filter((r) => r.reserve.marketName);
      const critical = listed.filter((r) => r.health.checks.some((c) => c.severity === 'critical')).length;
      const warning = listed.filter((r) => r.health.checks.some((c) => c.severity === 'warning')).length;
      console.log(
        `${new Date().toISOString()} ${protocol}: checked ${rows.length} reserves (${listed.length} in listed markets: ` +
          `${critical} critical, ${warning} warning), ${changes.length} changed, in ${((Date.now() - started) / 1000).toFixed(1)}s`,
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
  if (ok) await writeHeartbeat();
  if (!ok && RUN_ONCE) process.exitCode = 1;
  if (!RUN_ONCE) await new Promise((resolve) => setTimeout(resolve, INTERVAL_SECONDS * 1000));
} while (!RUN_ONCE);

await pool.end();
