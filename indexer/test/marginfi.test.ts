import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluate } from '../src/health.js';
import { decodePriceUpdate } from '../src/oracles/pyth.js';
import type { MarketOracleConfig } from '../src/types.js';

const NOW = 1_800_000_000;

function bank(oracleSetup: string, overrides: Partial<MarketOracleConfig> = {}): MarketOracleConfig {
  const isSwitchboard = oracleSetup.includes('Switchboard');
  const isFixedOrNone = oracleSetup.startsWith('Fixed') || oracleSetup === 'None';
  return {
    protocol: 'marginfi',
    market: 'group',
    marketName: 'marginfi Main',
    reserve: 'bank',
    asset: 'SOL',
    mint: 'mint',
    status: 'active',
    maxAgePriceSeconds: 70,
    feeds: {
      pyth: isSwitchboard || isFixedOrNone || oracleSetup === 'Scope' ? null : 'pyth-account',
      switchboard: isSwitchboard ? 'switchboard-account' : null,
      switchboardTwap: null,
      scope: oracleSetup === 'Scope' ? 'scope-account' : null,
    },
    scopeChain: [],
    oracleSetup,
    lastPriceUpdateTs: NOW,
    totalSupplyUsd: 1_000_000,
    ...overrides,
  };
}

const codes = (r: ReturnType<typeof evaluate>) => r.checks.map((c) => `${c.code}:${c.severity}`);

describe('evaluate marginfi banks', () => {
  it('reports a fresh single Pyth feed as having no fallback', () => {
    const result = evaluate(bank('PythPushOracle'), { pyth: { price: 122, confidence: 0, publishTime: NOW - 5 } }, NOW);
    assert.deepEqual(codes(result), ['NO_FALLBACK:warning']);
    assert.deepEqual(result.providers, ['Pyth']);
    assert.equal(result.priceAgeSeconds, 5);
  });

  it('names the exchange rate a setup multiplies the price by', () => {
    const result = evaluate(bank('KaminoPythPush'), { pyth: { price: 1, confidence: 0, publishTime: NOW - 5 } }, NOW);
    assert.deepEqual(result.providers, ['Pyth', 'Kamino exchange rate']);
  });

  it('flags a Pyth price older than the bank allows', () => {
    const result = evaluate(bank('PythPushOracle'), { pyth: { price: 122, confidence: 0, publishTime: NOW - 200 } }, NOW);
    assert.ok(codes(result).includes('STALE:critical'));
  });

  it('warns when the price is close to the limit', () => {
    const result = evaluate(bank('PythPushOracle', { maxAgePriceSeconds: 300 }), { pyth: { price: 1, confidence: 0, publishTime: NOW - 271 } }, NOW);
    assert.ok(codes(result).includes('NEAR_STALE:warning'));
  });

  it('is critical when the bank prices from Switchboard', () => {
    assert.deepEqual(codes(evaluate(bank('SwitchboardPull'), {}, NOW)), ['DEPRECATED_PROVIDER:critical']);
    assert.deepEqual(codes(evaluate(bank('KaminoSwitchboardPull'), {}, NOW)), ['DEPRECATED_PROVIDER:critical']);
  });

  it('reports fixed prices and missing oracles', () => {
    assert.deepEqual(codes(evaluate(bank('Fixed'), {}, NOW)), ['FIXED_PRICE:info']);
    assert.deepEqual(codes(evaluate(bank('FixedKamino'), {}, NOW)), ['FIXED_PRICE:info']);
    assert.deepEqual(codes(evaluate(bank('None'), {}, NOW)), ['NO_ORACLE:critical']);
  });

  it('does not guess when the Pyth account cannot be read', () => {
    assert.deepEqual(codes(evaluate(bank('PythPushOracle'), {}, NOW)), ['UNREADABLE_ORACLE:warning']);
  });

  it('warns when Pyth is unsure of the price', () => {
    const sure = evaluate(bank('PythPushOracle'), { pyth: { price: 100, confidence: 0.05, publishTime: NOW - 5 } }, NOW);
    const unsure = evaluate(bank('PythPushOracle'), { pyth: { price: 100, confidence: 3, publishTime: NOW - 5 } }, NOW);

    assert.ok(!codes(sure).includes('WIDE_CONFIDENCE:warning'));
    assert.ok(codes(unsure).includes('WIDE_CONFIDENCE:warning'));
    assert.match(unsure.checks.find((c) => c.code === 'WIDE_CONFIDENCE')!.message, /±3\.0%/);
  });

  it('checks a fixed price against the market, since it can never go stale', () => {
    const market = { usdPrice: 0.93, liquidity: 5_000_000 };
    const result = evaluate(bank('Fixed', { fixedPrice: 1 }), { market }, NOW);

    assert.deepEqual(codes(result), ['FIXED_PRICE:info', 'PRICE_DEVIATION:warning']);
    assert.match(result.checks[1].message, /The fixed price \$1\.00 is 7\.5% above the market price \(\$0\.93 on Jupiter\): collateral is overvalued/);
  });

  it('does not check a price that includes an exchange rate it cannot see', () => {
    const market = { usdPrice: 50, liquidity: 5_000_000 };
    const result = evaluate(bank('KaminoPythPush'), { pyth: { price: 100, confidence: 0, publishTime: NOW - 5 }, market }, NOW);
    assert.ok(!codes(result).some((c) => c.startsWith('PRICE_DEVIATION')));
  });
});

describe('decodePriceUpdate', () => {
  function priceUpdate(level: 0 | 1, price: bigint, exponent: number, publishTime: number, confidence = 0n): Buffer {
    const data = Buffer.alloc(134);
    data[40] = level;
    let offset = 40 + (level === 0 ? 2 : 1) + 32;
    data.writeBigInt64LE(price, offset);
    data.writeBigUInt64LE(confidence, offset + 8);
    offset += 16;
    data.writeInt32LE(exponent, offset);
    offset += 4;
    data.writeBigInt64LE(BigInt(publishTime), offset);
    return data;
  }

  it('reads price and publish time for both verification levels', () => {
    const full = decodePriceUpdate(priceUpdate(1, 12_273_400_000n, -8, NOW));
    assert.ok(full && Math.abs(full.price - 122.734) < 1e-9);
    assert.equal(full?.publishTime, NOW);

    const partial = decodePriceUpdate(priceUpdate(0, 100_000_000n, -8, NOW - 3));
    assert.ok(partial && Math.abs(partial.price - 1) < 1e-9);
    assert.equal(partial?.publishTime, NOW - 3);
  });

  it('reads the confidence interval in the price unit', () => {
    const decoded = decodePriceUpdate(priceUpdate(1, 12_273_400_000n, -8, NOW, 6_000_000n));
    assert.ok(decoded && Math.abs(decoded.confidence - 0.06) < 1e-9);
  });

  it('rejects data that is not a price update', () => {
    assert.equal(decodePriceUpdate(Buffer.alloc(200)), null);
    const bad = priceUpdate(1, 1n, 0, NOW);
    bad[40] = 7;
    assert.equal(decodePriceUpdate(bad), null);
  });
});
