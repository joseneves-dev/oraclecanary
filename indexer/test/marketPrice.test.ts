import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  newSwapQuotes,
  rawUsdPrice,
  reference,
  SOL_MINT,
  swapPrices,
  swapSizeUsd,
  USDC_MINT,
  valueUnlisted,
  type MarketPrice,
} from '../src/oracles/marketPrice.js';
import type { MarketOracleConfig } from '../src/types.js';

const reserve = (marketName: string | null): MarketOracleConfig => ({
  protocol: 'kamino',
  market: 'm',
  marketName,
  reserve: 'r',
  asset: 'RUNNERV3',
  mint: 'mint',
  status: 'active',
  maxAgePriceSeconds: 120,
  feeds: { pyth: null, switchboard: null, switchboardTwap: null, scope: null },
  scopeChain: [],
  oracleSetup: null,
  lastPriceUpdateTs: 0,
  totalSupplyUsd: 2_060_298_084_188,
  supplyTokens: 1_000,
});

const prices = (entries: [string, MarketPrice][], failed: string[] = []) => ({ prices: new Map(entries), failed: new Set(failed) });

describe('valueUnlisted', () => {
  it('keeps the stored value when the price is unknown because Jupiter did not answer', () => {
    assert.equal(valueUnlisted(reserve(null), prices([], ['mint']), new Map([['r', 49_000_000]])).totalSupplyUsd, 49_000_000);
  });

  it('values an unlisted market at the market price, not at the price its creator set', () => {
    assert.equal(valueUnlisted(reserve(null), prices([['mint', { usdPrice: 0.5, liquidity: 10 }]]), new Map()).totalSupplyUsd, 500);
    assert.equal(valueUnlisted(reserve(null), prices([]), new Map()).totalSupplyUsd, 0);
  });

  it('keeps the protocol value in listed markets', () => {
    assert.equal(valueUnlisted(reserve('Main Market'), prices([]), new Map()).totalSupplyUsd, 2_060_298_084_188);
  });
});

describe('reference', () => {
  it('only trusts market prices with enough liquidity behind them', () => {
    assert.equal(reference({ usdPrice: 1, liquidity: 1_000 }), undefined);
    assert.deepEqual(reference({ usdPrice: 1, liquidity: 1_000_000 }), { usdPrice: 1, liquidity: 1_000_000 });
    assert.equal(reference(undefined), undefined);
  });
});

describe('rawUsdPrice', () => {
  it('uses the price per raw token for tokens with a UI multiplier (xStocks)', () => {
    assert.equal(rawUsdPrice({ usdPrice: 99.07, scaledUiConfig: { usdPricePrescaled: 107.63 } }), 107.63);
    assert.equal(rawUsdPrice({ usdPrice: 119.6 }), 119.6);
    assert.equal(rawUsdPrice({ usdPrice: 0 }), null);
  });
});

describe('reference', () => {
  it('does not trust a price that moved more than 50% in a day (dfdvSOL: +77% after two buys)', () => {
    assert.equal(reference({ usdPrice: 233.07, liquidity: 387_603_165, priceChange24h: 77.07 }), undefined);
    assert.equal(reference({ usdPrice: 1, liquidity: 1_000_000, priceChange24h: -60 }), undefined);
    assert.ok(reference({ usdPrice: 1, liquidity: 1_000_000, priceChange24h: -20 }));
  });
});

describe('swapPrices', () => {
  const DFDVSOL = 'sctmB7GPi5L2Q5G9tUSzXvhZ4YiDMEGcRov9KfArQpx';
  type Answer = { outAmount: string; priceImpactPct: string } | 'error' | 'throw';

  /** A fetch answering Jupiter quotes by output mint, recording the URLs asked for. */
  function fakeFetch(answers: Record<string, Answer>) {
    const urls: URL[] = [];
    const impl = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      urls.push(url);
      const answer = answers[url.searchParams.get('outputMint')!];
      if (answer === 'throw') throw new Error('network down');
      if (!answer || answer === 'error') return new Response('{"error":"No routes found"}', { status: 400 });
      return Response.json(answer);
    }) as typeof fetch;
    return { impl, urls };
  }

  it('prices the dfdvSOL swap that showed the price API wrong (4 Oct 2026)', async () => {
    // Selling $10K at Kamino's $133.65: 74.82 dfdvSOL for 9,980 USDC, $133.4 each.
    const { impl, urls } = fakeFetch({ [USDC_MINT]: { outAmount: '9980700000', priceImpactPct: '0.004' } });
    const prices = await swapPrices([{ mint: DFDVSOL, decimals: 9, oraclePrice: 133.65, sizeUsd: 10_000 }], newSwapQuotes(), 121.18, impl);
    assert.equal(urls[0].searchParams.get('amount'), '74822297045');
    assert.equal(urls[0].searchParams.get('inputMint'), DFDVSOL);
    assert.equal(prices.get(DFDVSOL)!.usdPrice.toFixed(2), '133.39');
    assert.equal(prices.get(DFDVSOL)!.sizeUsd, 10_000);
  });

  it('leaves out a quote too thin to judge an oracle by', async () => {
    const { impl } = fakeFetch({ [USDC_MINT]: { outAmount: '9000000000', priceImpactPct: '0.05' } });
    const prices = await swapPrices([{ mint: 'thin', decimals: 6, oraclePrice: 1, sizeUsd: 10_000 }], newSwapQuotes(), 120, impl);
    assert.equal(prices.size, 0);
  });

  it('leaves out mints whose quotes fail, without throwing', async () => {
    for (const answer of ['error', 'throw'] as const) {
      const { impl } = fakeFetch({ [USDC_MINT]: answer, [SOL_MINT]: answer });
      assert.equal((await swapPrices([{ mint: 'm', decimals: 6, oraclePrice: 1, sizeUsd: 10_000 }], newSwapQuotes(), 120, impl)).size, 0);
    }
    const garbage = (async () => Response.json({ outAmount: 'abc' })) as unknown as typeof fetch;
    assert.equal((await swapPrices([{ mint: 'm', decimals: 6, oraclePrice: 1, sizeUsd: 10_000 }], newSwapQuotes(), 120, garbage)).size, 0);
  });

  it('sells into SOL when USDC has no route, valued at the SOL price', async () => {
    // 50 LST at an oracle price of $200, for 82.5 SOL at $121.18: $199.95 each.
    const { impl, urls } = fakeFetch({ [USDC_MINT]: 'error', [SOL_MINT]: { outAmount: '82500000000', priceImpactPct: '0.001' } });
    const prices = await swapPrices([{ mint: 'lst', decimals: 9, oraclePrice: 200, sizeUsd: 10_000 }], newSwapQuotes(), 121.18, impl);
    assert.equal(urls.length, 2);
    assert.equal(prices.get('lst')!.usdPrice.toFixed(2), '199.95');
    // Without a SOL price there is nothing to value the SOL at.
    assert.equal((await swapPrices([{ mint: 'lst', decimals: 9, oraclePrice: 200, sizeUsd: 10_000 }], newSwapQuotes(), undefined, impl)).size, 0);
  });

  it('quotes each mint once per run, and nothing once the time budget is spent', async () => {
    const { impl, urls } = fakeFetch({ [USDC_MINT]: { outAmount: '10000000000', priceImpactPct: '0' } });
    const quotes = newSwapQuotes();
    const request = { mint: 'm', decimals: 6, oraclePrice: 1, sizeUsd: 10_000 };
    await swapPrices([request, { ...request, oraclePrice: 1.01 }], quotes, 120, impl);
    const again = await swapPrices([request], quotes, 120, impl);
    assert.equal(urls.length, 1);
    assert.equal(again.get('m')!.usdPrice, 1);

    assert.equal((await swapPrices([{ ...request, mint: 'late' }], newSwapQuotes(0), 120, impl)).size, 0);
    assert.equal(urls.length, 1);
  });

  it('sizes the swap at $10K, or a tenth of a smaller reserve', () => {
    assert.equal(swapSizeUsd(48_800_000), 10_000);
    assert.equal(swapSizeUsd(20_000), 2_000);
    assert.equal(swapSizeUsd(1_000), 100);
  });
});
