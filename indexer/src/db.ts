import pg from 'pg';

import type { CuratorVault } from './adapters/kaminoVaults.js';
import { configChanges, storedFeeds, type StoredConfig } from './configWatch.js';
import type { HealthResult } from './health.js';
import { checkKeys, hourOf, planIncidents, trackChanges, type AlertState, type HealthTransition } from './history.js';
import { US_STOCK_MINTS } from './marketHours.js';
import type { EarnPool } from './rates.js';
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
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
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

/** Written together from one source (see rates.ts); kept from the last run when no rate was read. */
const RATE_COLUMNS = ['supply_apy', 'borrow_apy', 'max_ltv', 'rate_source', 'rate_at'] as const;
const RATE_COLUMN_SET = new Set<string>(RATE_COLUMNS);

const RESERVE_COLUMNS = [
  'address', 'protocol', 'market', 'market_name', 'asset', 'mint', 'status', 'total_supply_usd',
  'max_age_price_seconds', 'price_age_seconds', 'score', 'providers', 'checks', 'feeds', 'checked_at',
  'borrow_mint', 'market_hours', ...RATE_COLUMNS,
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

const CONFIG_CHANGE_COLUMNS = [
  'address', 'protocol', 'asset', 'market_name', 'occurred_at', 'kind', 'detail', 'before_value', 'after_value', 'total_supply_usd',
] as const;

/** How each reserve of a protocol was priced at the last run, from lending_reserve. */
async function loadStoredConfigs(client: pg.PoolClient, protocol: Protocol): Promise<Map<string, StoredConfig>> {
  const { rows } = await client.query<{ address: string; market_name: string | null; status: string; feeds: unknown; max_age_price_seconds: number; providers: unknown }>(
    'SELECT address, market_name, status, feeds, max_age_price_seconds, providers FROM lending_reserve WHERE protocol = $1',
    [protocol],
  );
  return new Map(
    rows.map((r) => [
      r.address,
      {
        listed: r.market_name !== null && r.status === 'active',
        feeds: r.feeds && typeof r.feeds === 'object' ? (r.feeds as Record<string, unknown>) : {},
        maxAgeSeconds: r.max_age_price_seconds,
        providers: strings(
          r.feeds && typeof r.feeds === 'object' && Array.isArray((r.feeds as { knownProviders?: unknown }).knownProviders)
            ? (r.feeds as { knownProviders: unknown }).knownProviders
            : r.providers,
        ),
      },
    ]),
  );
}

const INCIDENT_COLUMNS = ['address', 'protocol', 'asset', 'market_name', 'started_at', 'start_estimated', 'checks', 'total_supply_usd'] as const;

/** Opens and closes incidents (see planIncidents) and records the largest supply exposed by open ones. */
async function saveIncidents(
  client: pg.PoolClient,
  protocol: Protocol,
  listed: ReserveHealthRow[],
  states: Map<string, AlertState>,
  transitions: HealthTransition[],
  checkedAt: Date,
): Promise<void> {
  const { rows: openRows } = await client.query<{ address: string }>(
    'SELECT address FROM reserve_incident WHERE protocol = $1 AND ended_at IS NULL',
    [protocol],
  );
  const plan = planIncidents(new Set(openRows.map((r) => r.address)), listed, states, transitions, checkedAt);

  if (plan.close.length) {
    await client.query(
      `UPDATE reserve_incident i SET ended_at = v.ended_at
         FROM unnest($1::text[], $2::timestamp[]) AS v(address, ended_at)
        WHERE i.address = v.address AND i.ended_at IS NULL`,
      [plan.close.map((c) => c.address), plan.close.map((c) => utc(c.endedAt))],
    );
  }
  await insertRows(
    client,
    'reserve_incident',
    INCIDENT_COLUMNS,
    plan.open.map(({ row: { reserve: r }, startedAt, estimated, checks }) => [
      r.reserve, r.protocol, asset(r), marketName(r), utc(startedAt), estimated, JSON.stringify(checks), finite(r.totalSupplyUsd),
    ]),
  );
  await client.query(
    `UPDATE reserve_incident i SET total_supply_usd = GREATEST(i.total_supply_usd, v.usd)
       FROM unnest($1::text[], $2::float8[]) AS v(address, usd)
      WHERE i.address = v.address AND i.ended_at IS NULL`,
    [listed.map((r) => r.reserve.reserve), listed.map((r) => finite(r.reserve.totalSupplyUsd))],
  );
}

/**
 * Replaces the stored health of one protocol's reserves with this run's results, in the tables owned
 * by the Symfony app, and records history in the same transaction:
 * - an event when the lasting failed checks of a listed reserve changed and the change was confirmed
 *   (see trackChanges);
 * - incidents: the periods a listed reserve was critical (see planIncidents);
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
    const alertStates = await loadAlertStates(client, protocol);
    const { transitions, states } = trackChanges(alertStates, listed, checkedAt, confirmSeconds);

    // Compared before the rows are replaced: how each listed reserve is priced now against last run.
    // Reserves with alert state were listed within the last week: not "newly listed" if they reappear.
    const stored = await loadStoredConfigs(client, protocol);
    const changes = configChanges(stored, rows.map(({ reserve, health }) => ({ reserve, providers: health.providers })), new Set(alertStates.keys()));
    await insertRows(
      client,
      'reserve_config_change',
      CONFIG_CHANGE_COLUMNS,
      changes.map((c) => [
        c.reserve.reserve, c.reserve.protocol, asset(c.reserve), marketName(c.reserve), utc(checkedAt), c.kind, c.detail,
        JSON.stringify(c.before), JSON.stringify(c.after), finite(c.reserve.totalSupplyUsd),
      ]),
    );

    const updates = RESERVE_COLUMNS.filter((c) => c !== 'address')
      .map((c) => (RATE_COLUMN_SET.has(c) ? `${c} = CASE WHEN EXCLUDED.rate_source IS NULL THEN lending_reserve.${c} ELSE EXCLUDED.${c} END` : `${c} = EXCLUDED.${c}`))
      .join(', ');
    await insertRows(
      client,
      'lending_reserve',
      RESERVE_COLUMNS,
      rows.map(({ reserve: r, health: h }) => [
        r.reserve, r.protocol, r.market, marketName(r), asset(r), r.mint, r.status, finite(r.totalSupplyUsd),
        r.maxAgePriceSeconds, h.priceAgeSeconds, h.score, JSON.stringify(h.providers), JSON.stringify(h.checks),
        // The last providers read, kept through a run where the oracle could not be read, so a change
        // made meanwhile is still compared against what was there before.
        JSON.stringify({ ...storedFeeds(r), knownProviders: h.providers.length ? h.providers : (stored.get(r.reserve)?.providers ?? []) }),
        utc(checkedAt),
        r.borrowMint ?? null, US_STOCK_MINTS.has(r.mint),
        r.rate ? finite(r.rate.supplyApy) : null, r.rate ? finite(r.rate.borrowApy) : null, r.rate?.maxLtv ?? null,
        r.rate?.source ?? null, r.rate ? utc(r.rate.at) : null,
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

    await saveIncidents(client, protocol, listed, states, transitions, checkedAt);

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
    await client.query('DELETE FROM reserve_incident WHERE protocol = $1 AND ended_at < $2', [protocol, daysBefore(checkedAt, EVENT_RETENTION_DAYS)]);
    await client.query('DELETE FROM reserve_config_change WHERE protocol = $1 AND occurred_at < $2', [protocol, daysBefore(checkedAt, EVENT_RETENTION_DAYS)]);
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

const VAULT_COLUMNS = ['address', 'name', 'curator', 'token_mint', 'token', 'total_usd', 'idle_usd', 'allocations', 'checked_at'] as const;
// Column lengths from the CuratorVault entity.
const VAULT_NAME_LENGTH = 80;

/** Last stored supply in USD of the given reserves, to fall back on when a price is unknown. */
export async function storedSupplyUsd(pool: pg.Pool, addresses: string[]): Promise<Map<string, number>> {
  if (!addresses.length) return new Map();
  const { rows } = await pool.query<{ address: string; total_supply_usd: number }>(
    'SELECT address, total_supply_usd FROM lending_reserve WHERE address = ANY($1)',
    [addresses],
  );
  return new Map(rows.map((r) => [r.address, Number(r.total_supply_usd)]));
}

/**
 * Replaces the stored curator vaults with this run's: vaults Kamino no longer lists, or that are now
 * worth nothing, are removed. Nothing is written when the list is empty, which more likely means the
 * vault API failed than that every vault closed.
 */
export async function saveVaults(pool: pg.Pool, vaults: CuratorVault[], checkedAt: Date): Promise<void> {
  if (!vaults.length) return;
  const client = await pool.connect();
  let failure: Error | undefined;
  try {
    await client.query('BEGIN');
    const updates = VAULT_COLUMNS.filter((c) => c !== 'address').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
    await insertRows(
      client,
      'curator_vault',
      VAULT_COLUMNS,
      vaults.map((v) => [
        v.address, v.name.slice(0, VAULT_NAME_LENGTH), v.curator, v.tokenMint, v.token?.slice(0, ASSET_LENGTH) ?? null,
        finite(v.totalUsd), finite(v.idleUsd), JSON.stringify(v.allocations.map((a) => ({ reserve: a.reserve, usd: finite(a.usd) }))), utc(checkedAt),
      ]),
      `ON CONFLICT (address) DO UPDATE SET ${updates}`,
    );
    await client.query('DELETE FROM curator_vault WHERE NOT (address = ANY($1))', [vaults.map((v) => v.address)]);
    await client.query('COMMIT');
  } catch (e) {
    failure = e as Error;
    await client.query('ROLLBACK').catch(() => {
      // The connection itself is broken; the original error is the one worth reporting.
    });
    throw e;
  } finally {
    client.release(failure);
  }
}

const EARN_COLUMNS = ['address', 'asset', 'mint', 'supply_apy', 'rewards_apy', 'total_supply_usd', 'rate_source', 'rate_at', 'checked_at'] as const;

/**
 * Replaces the stored Jupiter Lend Earn pools with this run's. Nothing is written when the list is
 * empty, which more likely means the API failed than that every pool closed.
 */
export async function saveEarnPools(pool: pg.Pool, pools: EarnPool[], checkedAt: Date): Promise<void> {
  if (!pools.length) return;
  const client = await pool.connect();
  let failure: Error | undefined;
  try {
    await client.query('BEGIN');
    await insertRows(
      client,
      'lending_earn_pool',
      EARN_COLUMNS,
      pools.map((p) => [
        p.address, p.asset.slice(0, ASSET_LENGTH), p.mint, finite(p.supplyApy), finite(p.rewardsApy), finite(p.totalSupplyUsd), p.source, utc(p.at), utc(checkedAt),
      ]),
      `ON CONFLICT (address) DO UPDATE SET ${EARN_COLUMNS.filter((c) => c !== 'address').map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
    );
    await client.query('DELETE FROM lending_earn_pool WHERE NOT (address = ANY($1))', [pools.map((p) => p.address)]);
    await client.query('COMMIT');
  } catch (e) {
    failure = e as Error;
    await client.query('ROLLBACK').catch(() => {
      // The connection itself is broken; the original error is the one worth reporting.
    });
    throw e;
  } finally {
    client.release(failure);
  }
}
