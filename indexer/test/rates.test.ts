import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  aprToApy,
  fetchJupiterEarn,
  fetchKaminoRates,
  marginfiRate,
  parseJupiterEarn,
  parseKaminoMetrics,
  resetRateCaches,
  withKaminoRates,
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

  it('has no rate for a bank that never updated', () => {
    assert.equal(marginfiRate({ lending_rate: 0, borrowing_rate: 0 }, 0, 0.8), null);
  });

  it('caps u32::MAX at 1000%', () => {
    assert.ok(Math.abs(marginfiRate({ lending_rate: U32_MAX, borrowing_rate: 0 }, 1, 0)!.supplyApy - aprToApy(10)) < 1e-6);
  });
});

describe('fetchKaminoRates', () => {
  beforeEach(() => resetRateCaches());
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('reads each market once, then reuses the rates until they are due again', async () => {
    mockFetch(() => KAMINO_METRICS);
    const now = AT.getTime();
    const first = await fetchKaminoRates(['m1', 'm2'], now);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].endsWith('/kamino-market/m1/reserves/metrics'));
    assert.equal(first.size, 2);

    await fetchKaminoRates(['m1', 'm2'], now + 60_000);
    assert.equal(calls.length, 2, 'no new call within the refresh interval');

    await fetchKaminoRates(['m1'], now + 3_600_000);
    assert.equal(calls.length, 3);
  });

  it('keeps the last rates of a market whose call fails', async () => {
    mockFetch(() => KAMINO_METRICS);
    await fetchKaminoRates(['m1'], AT.getTime());

    mockFetch(() => new Error('timeout'));
    const later = await fetchKaminoRates(['m1'], AT.getTime() + 3_600_000);
    assert.equal(calls.length, 1);
    assert.equal(later.get('D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59')?.at.toISOString(), AT.toISOString());
  });
});

describe('withKaminoRates', () => {
  beforeEach(() => resetRateCaches());
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('attaches rates to reserves of listed markets only', async () => {
    mockFetch(() => KAMINO_METRICS);
    const [listed, unlisted] = await withKaminoRates([
      reserve('D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59', 'main', 'Main Market'),
      reserve('D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59-copy', 'anyone', null),
    ]);
    assert.deepEqual(calls.length, 1);
    assert.equal(listed.rate?.supplyApy, 0.043192191263740964);
    assert.equal(unlisted.rate, undefined);
  });

  it('never fails the health run: without an answer the reserves come back unchanged', async () => {
    mockFetch(() => new Error('network down'));
    const reserves = [reserve('D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59', 'main', 'Main Market')];
    const result = await withKaminoRates(reserves);
    assert.deepEqual(result, reserves);
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
