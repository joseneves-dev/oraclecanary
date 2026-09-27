import pg from 'pg';

import type { HealthResult } from './health.js';
import type { MarketOracleConfig, Protocol } from './types.js';

export interface ReserveHealthRow {
  reserve: MarketOracleConfig;
  health: HealthResult;
}

const COLUMNS = [
  'address', 'protocol', 'market', 'market_name', 'asset', 'mint', 'status', 'total_supply_usd',
  'max_age_price_seconds', 'price_age_seconds', 'score', 'providers', 'checks', 'feeds', 'checked_at',
] as const;

// Rows per INSERT statement; keeps the parameter count well under PostgreSQL's 65535 limit.
const BATCH_SIZE = 200;

// Column lengths from the LendingReserve entity; longer on-chain values are cut instead of failing the run.
const ASSET_LENGTH = 64;
const MARKET_NAME_LENGTH = 120;

/**
 * Replaces the stored health of one protocol's reserves with this run's results, in the table owned
 * by the Symfony app. Reserves missing from `rows` (now obsolete, hidden or gone) are removed so they
 * cannot keep showing a stale "healthy" state.
 */
export async function saveReserveHealth(pool: pg.Pool, protocol: Protocol, rows: ReserveHealthRow[], checkedAt: Date): Promise<void> {
  // The column has no time zone and the web app reads it as UTC; passing a Date would make
  // node-postgres write it in the machine's local time.
  const checkedAtUtc = checkedAt.toISOString().replace('Z', '');

  const client = await pool.connect();
  let failure: Error | undefined;
  try {
    await client.query('BEGIN');
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders = batch.map(({ reserve: r, health: h }, row) => {
        values.push(
          r.reserve, r.protocol, r.market, r.marketName?.slice(0, MARKET_NAME_LENGTH) ?? null, r.asset.slice(0, ASSET_LENGTH), r.mint, r.status,
          Number.isFinite(r.totalSupplyUsd) ? r.totalSupplyUsd : 0,
          r.maxAgePriceSeconds, h.priceAgeSeconds, h.score,
          JSON.stringify(h.providers), JSON.stringify(h.checks),
          JSON.stringify({ ...r.feeds, scopeChain: r.scopeChain, oracle: r.oracle ?? null }), checkedAtUtc,
        );
        const base = row * COLUMNS.length;
        return `(${COLUMNS.map((_, c) => `$${base + c + 1}`).join(', ')})`;
      });
      const updates = COLUMNS.filter((c) => c !== 'address').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
      await client.query(
        `INSERT INTO lending_reserve (${COLUMNS.join(', ')}) VALUES ${placeholders.join(', ')}
         ON CONFLICT (address) DO UPDATE SET ${updates}`,
        values,
      );
    }
    // An empty result more likely means a failed read than a protocol with no reserves; keep the old rows.
    if (rows.length) {
      await client.query('DELETE FROM lending_reserve WHERE protocol = $1 AND checked_at < $2', [protocol, checkedAtUtc]);
    }
    await client.query('COMMIT');
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
