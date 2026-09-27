import pg from 'pg';

import type { HealthResult } from './health.js';
import { checkKeys, hourOf, trackChanges, type AlertState, type HealthTransition } from './history.js';
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

const STATE_COLUMNS = [
  'address', 'protocol', 'reported_score', 'reported_checks', 'pending_score', 'pending_checks', 'pending_since', 'last_seen_at',
] as const;

// History kept: hourly samples feed charts of the last weeks; events are the incident record.
const HOURLY_RETENTION_DAYS = 90;
const EVENT_RETENTION_DAYS = 365;
// Alert state of a reserve not seen for this long (closed, delisted) is dropped.
const STATE_RETENTION_DAYS = 7;

const daysBefore = (date: Date, days: number) => utc(new Date(date.getTime() - days * 86_400_000));

async function loadAlertStates(client: pg.PoolClient, protocol: Protocol): Promise<Map<string, AlertState>> {
  const { rows } = await client.query<{
    address: string;
    reported_score: number;
    reported_checks: unknown;
    pending_score: number | null;
    pending_checks: unknown;
    pending_since: Date | null;
  }>(
    // pg reads "timestamp without time zone" as local time; the column holds UTC.
    `SELECT address, reported_score, reported_checks, pending_score, pending_checks, pending_since AT TIME ZONE 'UTC' AS pending_since
       FROM reserve_health_state WHERE protocol = $1`,
    [protocol],
  );
  const keys = (checks: unknown) => (Array.isArray(checks) ? checks.filter((c): c is string => typeof c === 'string') : []);
  return new Map(
    rows.map((r) => [
      r.address,
      {
        reported: { score: r.reported_score, checks: keys(r.reported_checks) },
        pending: r.pending_score !== null ? { score: r.pending_score, checks: keys(r.pending_checks) } : null,
        pendingSince: r.pending_since,
      },
    ]),
  );
}

/**
 * Replaces the stored health of one protocol's reserves with this run's results, in the tables owned
 * by the Symfony app, and records history in the same transaction:
 * - an event when the lasting failed checks of a listed reserve changed and the change was confirmed
 *   (see trackChanges);
 * - one hourly sample per listed reserve, keeping the worst state seen in the hour;
 * - history older than the retention period is removed.
 * Reserves missing from `rows` (now obsolete, hidden or gone) are removed from lending_reserve so they
 * cannot keep showing a stale "healthy" state.
 *
 * Returns the confirmed changes, for alerting.
 */
export async function saveReserveHealth(
  pool: pg.Pool,
  protocol: Protocol,
  rows: ReserveHealthRow[],
  checkedAt: Date,
  confirmSeconds: number,
): Promise<HealthTransition[]> {
  const client = await pool.connect();
  let failure: Error | undefined;
  try {
    await client.query('BEGIN');
    // Two indexers running at once (e.g. a manual `npm run check`) would report every change twice.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`oraclecanary:${protocol}`]);

    // Unlisted markets hold arbitrary tokens and prices; their history is not worth keeping.
    const listed = rows.filter(({ reserve: r }) => r.marketName);
    const { transitions, states } = trackChanges(await loadAlertStates(client, protocol), listed, checkedAt, confirmSeconds);

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
      transitions.map(({ row: { reserve: r }, previous, current, since }) => [
        r.reserve, r.protocol, asset(r), marketName(r), utc(since), previous.score, current.score,
        JSON.stringify(previous.checks), JSON.stringify(current.checks), finite(r.totalSupplyUsd),
      ]),
    );

    await insertRows(
      client,
      'reserve_health_state',
      STATE_COLUMNS,
      [...states].map(([address, s]) => [
        address, protocol, s.reported.score, JSON.stringify(s.reported.checks), s.pending?.score ?? null,
        s.pending ? JSON.stringify(s.pending.checks) : null, s.pendingSince ? utc(s.pendingSince) : null, utc(checkedAt),
      ]),
      `ON CONFLICT (address) DO UPDATE SET ${STATE_COLUMNS.filter((c) => c !== 'address').map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
    );

    // A sample shows the worst state of its hour, so a reserve stale for most of an hour is not
    // charted as healthy because the first run of the hour happened to catch a fresh price.
    await insertRows(
      client,
      'reserve_health_hourly',
      HOURLY_COLUMNS,
      listed.map(({ reserve: r, health: h }) => [
        r.reserve, utc(hourOf(checkedAt)), r.protocol, h.score, h.priceAgeSeconds, finite(r.totalSupplyUsd), JSON.stringify(checkKeys(h.checks)),
      ]),
      `ON CONFLICT (address, hour) DO UPDATE SET
         checks = CASE WHEN EXCLUDED.score < reserve_health_hourly.score THEN EXCLUDED.checks ELSE reserve_health_hourly.checks END,
         score = LEAST(reserve_health_hourly.score, EXCLUDED.score),
         price_age_seconds = GREATEST(reserve_health_hourly.price_age_seconds, EXCLUDED.price_age_seconds),
         total_supply_usd = EXCLUDED.total_supply_usd`,
    );

    // An empty result more likely means a failed read than a protocol with no reserves; keep the old rows.
    if (rows.length) {
      await client.query('DELETE FROM lending_reserve WHERE protocol = $1 AND checked_at < $2', [protocol, utc(checkedAt)]);
    }
    await client.query('DELETE FROM reserve_health_hourly WHERE protocol = $1 AND hour < $2', [protocol, daysBefore(checkedAt, HOURLY_RETENTION_DAYS)]);
    await client.query('DELETE FROM reserve_health_event WHERE protocol = $1 AND occurred_at < $2', [protocol, daysBefore(checkedAt, EVENT_RETENTION_DAYS)]);
    await client.query('DELETE FROM reserve_health_state WHERE protocol = $1 AND last_seen_at < $2', [protocol, daysBefore(checkedAt, STATE_RETENTION_DAYS)]);
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
