import pg from 'pg';

import type { HealthResult } from './health.js';
import { checkKeys, detectTransitions, hourOf, type HealthTransition, type StoredHealth } from './history.js';
import type { MarketOracleConfig, Protocol } from './types.js';

export interface ReserveHealthRow {
  reserve: MarketOracleConfig;
  health: HealthResult;
}

// Rows per INSERT statement; keeps the parameter count well under PostgreSQL's 65535 limit.
const BATCH_SIZE = 200;

// Column lengths from the Symfony entities; longer on-chain values are cut instead of failing the run.
const ASSET_LENGTH = 64;
const MARKET_NAME_LENGTH = 120;

/** Tables have no time zone and the web app reads them as UTC; a Date would be written in local time. */
const utc = (date: Date) => date.toISOString().replace('Z', '');
const finite = (value: number) => (Number.isFinite(value) ? value : 0);
const asset = (r: MarketOracleConfig) => r.asset.slice(0, ASSET_LENGTH);
const marketName = (r: MarketOracleConfig) => r.marketName?.slice(0, MARKET_NAME_LENGTH) ?? null;

/** Inserts rows in batches: `INSERT INTO table (columns) VALUES (...), (...) <suffix>`. */
async function insertRows(client: pg.PoolClient, table: string, columns: readonly string[], rows: unknown[][], suffix = ''): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map((_, row) => `(${columns.map((_, c) => `$${row * columns.length + c + 1}`).join(', ')})`);
    await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders.join(', ')} ${suffix}`, batch.flat());
  }
}

const RESERVE_COLUMNS = [
  'address', 'protocol', 'market', 'market_name', 'asset', 'mint', 'status', 'total_supply_usd',
  'max_age_price_seconds', 'price_age_seconds', 'score', 'providers', 'checks', 'feeds', 'checked_at',
] as const;

const EVENT_COLUMNS = [
  'address', 'protocol', 'asset', 'market_name', 'occurred_at', 'previous_score', 'score', 'previous_checks', 'checks', 'total_supply_usd',
] as const;

const HOURLY_COLUMNS = ['address', 'hour', 'protocol', 'score', 'price_age_seconds', 'total_supply_usd', 'checks'] as const;

async function loadStoredHealth(client: pg.PoolClient, protocol: Protocol): Promise<Map<string, StoredHealth>> {
  const { rows } = await client.query<{ address: string; score: number; checks: { code: string; severity: string }[] }>(
    'SELECT address, score, checks FROM lending_reserve WHERE protocol = $1',
    [protocol],
  );
  return new Map(rows.map((r) => [r.address, { score: r.score, checks: checkKeys(Array.isArray(r.checks) ? r.checks : []) }]));
}

/**
 * Replaces the stored health of one protocol's reserves with this run's results, in the tables owned
 * by the Symfony app, and records history in the same transaction:
 * - an event for every reserve whose score or failed checks changed since the last run;
 * - one hourly sample per listed reserve, from the first run of each hour.
 * Reserves missing from `rows` (now obsolete, hidden or gone) are removed so they cannot keep showing
 * a stale "healthy" state.
 *
 * Returns the changes, for alerting.
 */
export async function saveReserveHealth(
  pool: pg.Pool,
  protocol: Protocol,
  rows: ReserveHealthRow[],
  checkedAt: Date,
): Promise<HealthTransition[]> {
  const client = await pool.connect();
  let failure: Error | undefined;
  try {
    await client.query('BEGIN');
    const transitions = detectTransitions(await loadStoredHealth(client, protocol), rows);

    const updates = RESERVE_COLUMNS.filter((c) => c !== 'address').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
    await insertRows(
      client,
      'lending_reserve',
      RESERVE_COLUMNS,
      rows.map(({ reserve: r, health: h }) => [
        r.reserve, r.protocol, r.market, marketName(r), asset(r), r.mint, r.status, finite(r.totalSupplyUsd),
        r.maxAgePriceSeconds, h.priceAgeSeconds, h.score, JSON.stringify(h.providers), JSON.stringify(h.checks),
        JSON.stringify({ ...r.feeds, scopeChain: r.scopeChain, oracle: r.oracle ?? null }), utc(checkedAt),
      ]),
      `ON CONFLICT (address) DO UPDATE SET ${updates}`,
    );

    await insertRows(
      client,
      'reserve_health_event',
      EVENT_COLUMNS,
      transitions.map(({ row: { reserve: r }, previous, current }) => [
        r.reserve, r.protocol, asset(r), marketName(r), utc(checkedAt), previous.score, current.score,
        JSON.stringify(previous.checks), JSON.stringify(current.checks), finite(r.totalSupplyUsd),
      ]),
    );

    // Unlisted markets hold arbitrary tokens and prices; their history is not worth keeping.
    await insertRows(
      client,
      'reserve_health_hourly',
      HOURLY_COLUMNS,
      rows
        .filter(({ reserve: r }) => r.marketName)
        .map(({ reserve: r, health: h }) => [
          r.reserve, utc(hourOf(checkedAt)), r.protocol, h.score, h.priceAgeSeconds, finite(r.totalSupplyUsd), JSON.stringify(checkKeys(h.checks)),
        ]),
      'ON CONFLICT (address, hour) DO NOTHING',
    );

    // An empty result more likely means a failed read than a protocol with no reserves; keep the old rows.
    if (rows.length) {
      await client.query('DELETE FROM lending_reserve WHERE protocol = $1 AND checked_at < $2', [protocol, utc(checkedAt)]);
    }
    await client.query('COMMIT');
    return transitions;
  } catch (e) {
    failure = e as Error;
    await client.query('ROLLBACK').catch(() => {
      // The connection itself is broken; the original error is the one worth reporting.
    });
    throw e;
  } finally {
    // Passing the error discards a possibly broken connection instead of returning it to the pool.
    client.release(failure);
  }
}
