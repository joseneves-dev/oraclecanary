import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import pg from 'pg';

import { RATE_COLUMNS, RESERVE_COLUMNS, rateValues, reserveUpdates, saveEarnPools } from '../src/db.js';
import {
  aprToApy,
  attachRates,
  cachedKaminoRates,
  fetchJupiterEarn,
  kaminoRatesWithin,
  listedMarkets,
  marginfiRate,
  parseJupiterEarn,
  parseKaminoMetrics,
  resetRateCaches,
} from '../src/rates.js';
import type { MarketOracleConfig } from '../src/types.js';

// Trimmed answers of the live APIs (1 Oct 2026).
const KAMINO_METRICS = [
  {
    reserve: 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59',
    liquidityToken: 'USDC',
    liquidityTokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    maxLtv: '0.8',
    borrowApy: '0.05886980591573776',
    supplyApy: '0.043192191263740964',
    totalSupply: '121653429.1',
    totalBorrow: '98000000',
    totalBorrowUsd: '98000000',
    totalSupplyUsd: '121653429',
  },
  { reserve: '64AZMUHLB6NYvQSt41JTer4v8NAFDCz5sUPb7dYpCxa', liquidityToken: 'adraSOL', maxLtv: '0', borrowApy: '0.019', supplyApy: '0' },
  // Malformed entries are skipped, not fatal.
  { reserve: 'broken', supplyApy: 'n/a', borrowApy: '0.1' },
  { liquidityToken: 'no-address', supplyApy: '0.1', borrowApy: '0.1' },
];

const JUPITER_EARN = [
  {
    id: 1,
    address: '9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D',
    symbol: 'jlUSDC',
    decimals: 6,
    assetAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    asset: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', uiSymbol: 'USDC', decimals: 6, price: '0.9999' },
    totalAssets: '474906875000000',
    supplyRate: '408',
    rewardsRate: '38',
    totalRate: '446',
  },
  {
    id: 2,
    address: '2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU',
    decimals: 9,
    assetAddress: 'So11111111111111111111111111111111111111112',
    asset: { symbol: 'WSOL', uiSymbol: 'SOL', decimals: 9, price: '150' },
    totalAssets: '157187453000000',
    supplyRate: '398',
    rewardsRate: '0',
  },
  { id: 3, address: 'no-rate', assetAddress: 'x', asset: { symbol: 'X' } },
  // No price: skipped rather than stored at $0.
  { id: 4, address: 'no-price', assetAddress: 'y', asset: { symbol: 'Y', decimals: 6 }, totalAssets: '1000000', supplyRate: '400' },
];

const AT = new Date('2026-10-01T12:00:00Z');

function reserve(address: string, market: string, marketName: string | null): MarketOracleConfig {
  return {
    protocol: 'kamino',
    market,
    marketName,
    reserve: address,
    asset: 'USDC',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    status: 'active',
    maxAgePriceSeconds: 120,
    feeds: { pyth: null, switchboard: null, switchboardTwap: null, scope: 'prices' },
    scopeChain: [3],
    oracleSetup: null,
    lastPriceUpdateTs: 0,
    totalSupplyUsd: 1_000_000,
  };
}

/** Replaces fetch with a function answering by URL; restores it after each test. */
const realFetch = globalThis.fetch;
let calls: string[] = [];
function mockFetch(answer: (url: string) => unknown) {
  calls = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const body = answer(url);
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

describe('parseKaminoMetrics', () => {
  it('reads supply and borrow APYs and max LTV by reserve address', () => {
    const rates = parseKaminoMetrics(KAMINO_METRICS, AT);
    assert.equal(rates.size, 2);
    const usdc = rates.get('D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59');
    assert.deepEqual(usdc, { supplyApy: 0.043192191263740964, borrowApy: 0.05886980591573776, maxLtv: 0.8, source: 'kamino-api', at: AT });
    assert.equal(rates.get('64AZMUHLB6NYvQSt41JTer4v8NAFDCz5sUPb7dYpCxa')?.maxLtv, 0);
  });

  it('rejects an answer that is not a list', () => {
    assert.throws(() => parseKaminoMetrics({ error: 'rate limited' }, AT));
  });
});

describe('parseJupiterEarn', () => {
  it('reads basis points as fractions and values deposits at the asset price', () => {
    const [usdc, sol, ...rest] = parseJupiterEarn(JUPITER_EARN, AT);
    assert.equal(rest.length, 0);
    assert.equal(usdc.address, '9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D');
    assert.equal(usdc.mint, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    assert.equal(usdc.asset, 'USDC');
    assert.equal(usdc.supplyApy, 0.0408);
    assert.equal(usdc.rewardsApy, 0.0038);
    assert.ok(Math.abs(usdc.totalSupplyUsd - 474_906_875 * 0.9999) < 1);
    assert.equal(usdc.source, 'jupiter-api');
    assert.equal(sol.asset, 'SOL');
    assert.ok(Math.abs(sol.totalSupplyUsd - 157_187.453 * 150) < 1);
  });
});

describe('marginfiRate', () => {
  const U32_MAX = 0xffff_ffff;

  it('reads the cached rates as fractions of 1000% and compounds them hourly', () => {
    // 6.41% APR, as the main group's USDC bank cached it on 1 Oct 2026.
    const rate = marginfiRate({ lending_rate: Math.round((0.0641 / 10) * U32_MAX), borrowing_rate: Math.round((0.0685 / 10) * U32_MAX) }, 1_790_862_962, 0.9);
    assert.ok(rate);
    assert.ok(Math.abs(rate.supplyApy - aprToApy(0.0641)) < 1e-9);
    assert.ok(Math.abs(rate.supplyApy - 0.06619) < 1e-4);
    assert.ok(Math.abs(rate.borrowApy - 0.07089) < 1e-4);
    assert.equal(rate.maxLtv, 0.9);
    assert.equal(rate.source, 'marginfi-onchain');
    assert.equal(rate.at.toISOString(), new Date(1_790_862_962_000).toISOString());
  });

  it('has no rate for a bank that never updated, or whose cache was never written', () => {
    assert.equal(marginfiRate({ lending_rate: 5, borrowing_rate: 9 }, 0, 0.8), null);
    assert.equal(marginfiRate({ lending_rate: 0, borrowing_rate: 0 }, 1_790_862_962, 0.8), null);
  });

  it('caps u32::MAX at 1000%', () => {
    assert.ok(Math.abs(marginfiRate({ lending_rate: U32_MAX, borrowing_rate: 0 }, 1, 0)!.supplyApy - aprToApy(10)) < 1e-6);
  });
});

describe('Kamino rates', () => {
  beforeEach(() => resetRateCaches());
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('reads each market once, then reuses the rates until they are due again', async () => {
    mockFetch(() => KAMINO_METRICS);
    const now = AT.getTime();
    const first = await kaminoRatesWithin(['m1', 'm2'], 1_000, now);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].endsWith('/kamino-market/m1/reserves/metrics'));
    assert.equal(first.size, 2);

    await kaminoRatesWithin(['m1', 'm2'], 1_000, now + 60_000);
    assert.equal(calls.length, 2, 'no new call within the refresh interval');

    await kaminoRatesWithin(['m1'], 1_000, now + 3_600_000);
    assert.equal(calls.length, 3);
  });

  it('keeps the last rates of a failed market and backs off before retrying it', async () => {
    const t0 = AT.getTime();
    mockFetch(() => KAMINO_METRICS);
    await kaminoRatesWithin(['m1'], 1_000, t0);

    mockFetch(() => new Error('timeout'));
    const later = await kaminoRatesWithin(['m1'], 1_000, t0 + 3_600_000);
    assert.equal(calls.length, 1);
    assert.equal(later.get('D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59')?.at.toISOString(), AT.toISOString());

    // Retried after 1 minute, then after 2 more.
    await kaminoRatesWithin(['m1'], 1_000, t0 + 3_600_000 + 30_000);
    assert.equal(calls.length, 1, 'backing off');
    await kaminoRatesWithin(['m1'], 1_000, t0 + 3_600_000 + 60_000);
    assert.equal(calls.length, 2, 'retried after the first back-off');
    await kaminoRatesWithin(['m1'], 1_000, t0 + 3_600_000 + 60_000 + 90_000);
    assert.equal(calls.length, 2, 'the second back-off is longer');
  });

  it('waits no longer than its budget; the slow call fills the cache for the next run', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    calls = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      await gate;
      return new Response(JSON.stringify(KAMINO_METRICS), { status: 200 });
    }) as typeof fetch;

    const started = Date.now();
    const rates = await kaminoRatesWithin(['m1'], 50, AT.getTime());
    assert.ok(Date.now() - started < 1_000, 'returned at the budget');
    assert.equal(rates.size, 0);

    // A run meanwhile does not start the same call again.
    await kaminoRatesWithin(['m1'], 10, AT.getTime() + 3_600_000);
    assert.equal(calls.length, 1);

    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(cachedKaminoRates(['m1']).size, 2);
  });

  it('attaches rates to the reserves of listed markets only', async () => {
    mockFetch(() => KAMINO_METRICS);
    const reserves = [
      reserve('D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59', 'main', 'Main Market'),
      reserve('D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59-copy', 'anyone', null),
    ];
    assert.deepEqual(listedMarkets(reserves), ['main']);
    const [listed, unlisted] = attachRates(reserves, await kaminoRatesWithin(listedMarkets(reserves), 1_000));
    assert.equal(calls.length, 1);
    assert.equal(listed.rate?.supplyApy, 0.043192191263740964);
    assert.equal(unlisted.rate, undefined);
  });

  it('never fails the health run: without an answer the reserves come back unchanged', async () => {
    mockFetch(() => new Error('network down'));
    const reserves = [reserve('D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59', 'main', 'Main Market')];
    assert.deepEqual(attachRates(reserves, await kaminoRatesWithin(listedMarkets(reserves), 1_000)), reserves);
  });
});

describe('lending_reserve rate columns', () => {
  it('keeps the stored rates when no rate was read this run', () => {
    const updates = reserveUpdates();
    for (const column of RATE_COLUMNS) {
      assert.ok(updates.includes(`${column} = CASE WHEN EXCLUDED.rate_source IS NULL THEN lending_reserve.${column} ELSE EXCLUDED.${column} END`), column);
    }
    assert.ok(updates.includes('score = EXCLUDED.score'));
    assert.ok(RATE_COLUMNS.every((c) => RESERVE_COLUMNS.includes(c)));
  });

  it('writes a rate as its columns, or nulls without one', () => {
    const r = reserve('a', 'main', 'Main Market');
    assert.deepEqual(rateValues(r), [null, null, null, null, null]);
    assert.deepEqual(rateValues({ ...r, rate: { supplyApy: 0.04, borrowApy: 0.06, maxLtv: 0.8, source: 'kamino-api', at: AT } }), [
      0.04, 0.06, 0.8, 'kamino-api', '2026-10-01T12:00:00.000',
    ]);
  });
});

// Against a real PostgreSQL only when TEST_DATABASE_URL points at a database migrated by the web app.
// Temporary tables shadow the real ones, so nothing stored there is touched.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
describe('rates in the database', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL is not set' }, () => {
  it('an upsert without a rate keeps the stored one; with a rate, replaces it', async () => {
    // One connection, so the temporary tables are seen by every query.
    const db = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
    try {
      await db.query('CREATE TEMP TABLE lending_reserve (LIKE public.lending_reserve INCLUDING ALL)');
      const columns = RESERVE_COLUMNS.join(', ');
      const params = RESERVE_COLUMNS.map((_, i) => `$${i + 1}`).join(', ');
      const row = (rates: (number | string | null)[], score: number) => {
        const base: Record<string, unknown> = {
          address: 'a', protocol: 'kamino', market: 'm', market_name: 'Main Market', asset: 'USDC', mint: 'x', status: 'active',
          total_supply_usd: 1, max_age_price_seconds: 60, price_age_seconds: 1, score, providers: '[]', checks: '[]', feeds: '{}',
          checked_at: '2026-10-01T12:00:00', borrow_mint: null, market_hours: false,
        };
        RATE_COLUMNS.forEach((c, i) => (base[c] = rates[i]));
        return RESERVE_COLUMNS.map((c) => base[c]);
      };
      const upsert = (values: unknown[]) => db.query(`INSERT INTO lending_reserve (${columns}) VALUES (${params}) ON CONFLICT (address) DO UPDATE SET ${reserveUpdates()}`, values);

      await upsert(row([0.04, 0.06, 0.8, 'kamino-api', '2026-10-01T12:00:00'], 100));
      await upsert(row([null, null, null, null, null], 90));
      let { rows } = await db.query('SELECT score, supply_apy, rate_source FROM lending_reserve');
      assert.deepEqual(rows, [{ score: 90, supply_apy: 0.04, rate_source: 'kamino-api' }]);

      await upsert(row([0.05, 0.07, 0.8, 'kamino-api', '2026-10-01T12:05:00'], 90));
      ({ rows } = await db.query('SELECT supply_apy FROM lending_reserve'));
      assert.deepEqual(rows, [{ supply_apy: 0.05 }]);
    } finally {
      await db.end();
    }
  });

  it('saveEarnPools replaces the pools, and an empty list changes nothing', async () => {
    const db = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
    try {
      await db.query('CREATE TEMP TABLE lending_earn_pool (LIKE public.lending_earn_pool INCLUDING ALL)');
      const [usdc, sol] = parseJupiterEarn(JUPITER_EARN, AT);
      await saveEarnPools(db, [usdc, sol], AT);
      await saveEarnPools(db, [{ ...usdc, supplyApy: 0.05 }], AT);
      await saveEarnPools(db, [], AT);
      const { rows } = await db.query('SELECT asset, supply_apy FROM lending_earn_pool');
      assert.deepEqual(rows, [{ asset: 'USDC', supply_apy: 0.05 }]);
    } finally {
      await db.end();
    }
  });
});


describe('fetchJupiterEarn', () => {
  beforeEach(() => resetRateCaches());
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('throws on a failed call (the stored pools stay) and keeps the last list on an empty answer', async () => {
    mockFetch(() => JUPITER_EARN);
    assert.equal((await fetchJupiterEarn(AT.getTime())).length, 2);

    mockFetch(() => new Error('down'));
    await assert.rejects(fetchJupiterEarn(AT.getTime() + 3_600_000));

    mockFetch(() => []);
    assert.equal((await fetchJupiterEarn(AT.getTime() + 7_200_000)).length, 2, 'an empty answer keeps the last list');
  });
});
