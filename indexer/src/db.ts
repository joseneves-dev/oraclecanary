import pg from 'pg';

import type { HealthResult } from './health.js';
import type { MarketOracleConfig } from './types.js';

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

/** Writes the latest health state of each reserve into the table owned by the Symfony app. */
export async function saveReserveHealth(pool: pg.Pool, rows: ReserveHealthRow[], checkedAt: Date): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders = batch.map(({ reserve: r, health: h }, row) => {
        values.push(
          r.reserve, r.protocol, r.market, r.marketName, r.asset.slice(0, 64), r.mint, r.status,
          Number.isFinite(r.totalSupplyUsd) ? r.totalSupplyUsd : 0,
          r.maxAgePriceSeconds, h.priceAgeSeconds, h.score,
          JSON.stringify(h.providers), JSON.stringify(h.checks),
          JSON.stringify({ ...r.feeds, scopeChain: r.scopeChain }), checkedAt,
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
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
