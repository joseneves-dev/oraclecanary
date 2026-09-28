import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rawUsdPrice, reference, valueUnlisted, type MarketPrice } from '../src/oracles/marketPrice.js';
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
